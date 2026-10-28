import {
  AdditiveBlending,
  Box3,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";
import type { FeatureRow } from "../../sim/featureSnapshot";
import {
  type FeatureBlaze,
  type FeatureEnd,
  FeatureFx,
  type FeatureParticles,
} from "./fx";
import {
  FEATURE_FAMILIES,
  type FeatureContext,
  type FeatureFamily,
  type FeatureInstance,
  type FeatureTypeInfo,
} from "./layers";

/** Spec 31 block 1: the map features as they are during a match. The families
 *  are drawn from the snapshot's feature table (a tree becomes a stump, a
 *  building passes through damaged and wrecked and ends as rubble, a broken
 *  bridge disappears). With particles, a damaged building smokes, a wrecked
 *  one burns, a collapsing one sinks into fire and dust before its rubble
 *  appears, ruins smoulder, and a felled tree topples before it leaves its
 *  stump (Zero Hour `W3DTreeBuffer` topple, `StructureCollapseUpdate` sink).
 *  Without particles burning features carry simple flames. The static layers
 *  (ground, water) are not touched. */

/** Shortest time between two rebuilds of the same family, so a fire that
 *  changes the table every tick does not rebuild a forest every frame. */
const MIN_REBUILD_MS = 250;
const BRIDGE_BROKEN_STATE = 2;
const FLAME_OUTER = 0xff6a1a;
const FLAME_INNER = 0xffd23a;
const STATE_DAMAGED = 1;
const STATE_WRECKED = 2;
/** A collapsing building sinks over this long (the sim's 60 ticks are 4 s). */
const COLLAPSE_MS = 3800;
/** A collapse whose rubble never arrives is dropped after this long. */
const COLLAPSE_GIVE_UP_MS = 12_000;
/** A felled tree falls, lies, then sinks out of sight. */
const TOPPLE_FALL_MS = 900;
const TOPPLE_LIE_MS = 2600;
const TOPPLE_END_MS = 3600;

/** A feature drawn on its own while it falls or sinks. */
interface Falling {
  readonly pivot: Group;
  readonly kind: "collapse" | "topple";
  readonly startMs: number;
  readonly height: number;
  /** Fall direction, radians around the vertical. */
  readonly heading: number;
}

export type FamilyRenderer = (
  family: FeatureFamily,
  instances: readonly FeatureInstance[],
) => Object3D | null;

/** Footprint of `type` turned `rot` quarter turns. */
function dimensions(type: FeatureTypeInfo, rot: number): [number, number] {
  return rot % 2 === 1
    ? [type.footprint[1], type.footprint[0]]
    : [type.footprint[0], type.footprint[1]];
}

function disposeTree(object: Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const material = child.material;
    for (const m of Array.isArray(material) ? material : [material]) {
      m.dispose();
    }
  });
}

export class LiveFeatures {
  /** Holds one object per family plus the flames. */
  readonly object = new Group();

  private readonly initial: readonly FeatureInstance[];
  private readonly types: readonly FeatureTypeInfo[];
  private readonly ctx: FeatureContext;
  private readonly render: FamilyRenderer;
  /** The instance each row is drawn as now (parallel to the map features). */
  private readonly wanted: FeatureInstance[];
  private readonly alive: boolean[];
  private readonly burning = new Map<number, Group>();
  private readonly families = new Map<FeatureFamily, Object3D>();
  private readonly dirty = new Set<FeatureFamily>();
  /** Rows drawn on their own (collapsing buildings), not in their family. */
  private readonly detached = new Set<number>();
  private readonly falling = new Map<number, Falling>();
  /** Toppling trees; keyed apart so a stump can stand while its tree falls. */
  private readonly toppling = new Map<number, Falling>();
  private readonly burnt: boolean[];
  private readonly fx: FeatureFx | null;
  private lastRebuildMs = Number.NEGATIVE_INFINITY;
  private readonly flameGeometry = new ConeGeometry(0.28, 0.9, 6, 1);
  private readonly outer = new MeshBasicMaterial({
    color: FLAME_OUTER,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly inner = new MeshBasicMaterial({
    color: FLAME_INNER,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  constructor(
    initial: readonly FeatureInstance[],
    types: readonly FeatureTypeInfo[],
    ctx: FeatureContext,
    render: FamilyRenderer,
    particles: FeatureParticles | null = null,
  ) {
    this.initial = initial;
    this.types = types;
    this.ctx = ctx;
    this.render = render;
    this.fx = particles === null ? null : new FeatureFx(particles);
    this.wanted = [...initial];
    this.alive = initial.map(() => true);
    this.burnt = initial.map(() => false);
    this.object.name = "map-feature-families";
    for (const family of FEATURE_FAMILIES) this.dirty.add(family);
    this.rebuild(0);
  }

  /** Takes the feature table of a snapshot. */
  apply(rows: readonly FeatureRow[], nowMs: number): void {
    let urgent = false;
    for (const row of rows) {
      const start = this.initial[row.index];
      const type = this.types[row.kind];
      const old = this.wanted[row.index];
      if (start === undefined || type === undefined || old === undefined) {
        continue;
      }
      const wasAlive = this.alive[row.index] === true;
      const same =
        old.typeIndex === row.kind &&
        old.state === row.state &&
        wasAlive === row.alive;
      if (!same) {
        this.dirty.add(old.type.family);
        this.dirty.add(type.family);
        const [width, height] =
          row.kind === start.typeIndex
            ? [start.width, start.height]
            : dimensions(type, start.rot);
        this.wanted[row.index] = {
          ...start,
          type,
          typeIndex: row.kind,
          variant: row.kind === start.typeIndex ? start.variant : 0,
          state: row.state,
          width,
          height,
        };
        this.alive[row.index] = row.alive;
        const gone = wasAlive && (!row.alive || old.typeIndex !== row.kind);
        if (gone) urgent = this.ended(row.index, old, nowMs) || urgent;
        const breaks =
          !gone &&
          type.family === "bridge" &&
          old.state < BRIDGE_BROKEN_STATE &&
          row.state >= BRIDGE_BROKEN_STATE;
        if (breaks) {
          // The deck drops into the river in dust and debris.
          this.startCollapse(row.index, nowMs);
          this.fx?.destroyed(row.index, old, "decor", false, nowMs);
          urgent = true;
        }
      }
      if (row.alive && row.collapsing && !this.detached.has(row.index)) {
        this.startCollapse(row.index, nowMs);
        urgent = true;
      }
      this.burnt[row.index] = row.alive && row.burning;
      const instance = this.wanted[row.index] as FeatureInstance;
      if (this.fx !== null) {
        this.fx.set(row.index, instance, blazeOf(instance, row));
      } else {
        this.setFire(row.index, row.alive && (row.burning || row.collapsing));
      }
    }
    if (urgent) this.rebuild(nowMs);
    this.update(nowMs);
  }

  /** Feature `index`, drawn as `old`, stopped being itself: its effects, a
   *  falling tree, the end of a collapse. Returns whether the families must
   *  be drawn again at once. */
  private ended(index: number, old: FeatureInstance, nowMs: number): boolean {
    const wasBurning = this.burnt[index] === true;
    const end = endOf(old);
    if (end === "tree") this.startTopple(index, old, nowMs);
    this.fx?.destroyed(index, old, end, wasBurning, nowMs);
    if (!this.detached.has(index)) return end === "tree";
    this.detached.delete(index);
    this.dropFalling(this.falling, index);
    return true;
  }

  /** Rebuilds the changed families (rate limited), moves what falls and
   *  emits the fire and smoke. */
  update(nowMs: number): void {
    if (this.dirty.size > 0 && nowMs - this.lastRebuildMs >= MIN_REBUILD_MS) {
      this.rebuild(nowMs);
    }
    this.animate(nowMs);
    this.fx?.update(nowMs);
    for (const [index, flame] of this.burning) {
      const flicker = 1 + 0.25 * Math.sin(nowMs / 90 + index * 1.7);
      flame.scale.y = flame.userData.height * flicker;
    }
  }

  /** Features falling or sinking now (for tests and the debug overlay). */
  fallingCount(): number {
    return this.falling.size + this.toppling.size;
  }

  dispose(): void {
    for (const object of this.families.values()) disposeTree(object);
    for (const index of [...this.falling.keys()]) {
      this.dropFalling(this.falling, index);
    }
    for (const index of [...this.toppling.keys()]) {
      this.dropFalling(this.toppling, index);
    }
    this.fx?.clear();
    for (const flame of this.burning.values()) this.object.remove(flame);
    this.burning.clear();
    this.flameGeometry.dispose();
    this.outer.dispose();
    this.inner.dispose();
  }

  private rebuild(nowMs: number): void {
    this.lastRebuildMs = nowMs;
    for (const family of [...this.dirty]) {
      const previous = this.families.get(family);
      if (previous !== undefined) {
        this.object.remove(previous);
        disposeTree(previous);
        this.families.delete(family);
      }
      const instances = this.wanted.filter(
        (instance, index) =>
          instance.type.family === family &&
          this.alive[index] === true &&
          !this.detached.has(index) &&
          !(family === "bridge" && instance.state >= BRIDGE_BROKEN_STATE),
      );
      if (instances.length === 0) continue;
      const object = this.render(family, instances);
      if (object === null) continue;
      this.object.add(object);
      this.families.set(family, object);
    }
    this.dirty.clear();
  }

  /** Draws building `index` on its own and starts sinking it. */
  private startCollapse(index: number, nowMs: number): void {
    const instance = this.wanted[index];
    if (instance === undefined) return;
    this.detached.add(index);
    this.dirty.add(instance.type.family);
    this.startFalling(this.falling, index, instance, "collapse", nowMs);
  }

  /** Draws the tree `old` on its own, falling away from its row. */
  private startTopple(
    index: number,
    old: FeatureInstance,
    nowMs: number,
  ): void {
    this.startFalling(this.toppling, index, old, "topple", nowMs);
  }

  private startFalling(
    into: Map<number, Falling>,
    index: number,
    instance: FeatureInstance,
    kind: Falling["kind"],
    nowMs: number,
  ): void {
    this.dropFalling(into, index);
    const object = this.render(instance.type.family, [instance]);
    if (object === null) return;
    const x = instance.x + instance.width / 2;
    const z = instance.y + instance.height / 2;
    const ground = this.ctx.elevation.at(x, z);
    const pivot = new Group();
    pivot.name = kind === "collapse" ? "feature-collapse" : "feature-topple";
    pivot.position.set(x, ground, z);
    object.position.set(-x, -ground, -z);
    pivot.add(object);
    const box = new Box3().setFromObject(object);
    const height = Number.isFinite(box.max.y - box.min.y)
      ? Math.max(0.5, box.max.y - box.min.y)
      : 1.5;
    this.object.add(pivot);
    into.set(index, {
      pivot,
      kind,
      startMs: nowMs,
      height,
      heading: ((index * 2654435761) % 6283) / 1000,
    });
  }

  private dropFalling(from: Map<number, Falling>, index: number): void {
    const falling = from.get(index);
    if (falling === undefined) return;
    this.object.remove(falling.pivot);
    disposeTree(falling.pivot);
    from.delete(index);
  }

  /** Sinks the collapsing buildings and topples the felled trees. */
  private animate(nowMs: number): void {
    for (const [index, falling] of this.falling) {
      const t = nowMs - falling.startMs;
      if (t > COLLAPSE_GIVE_UP_MS) {
        this.detached.delete(index);
        this.dirty.add((this.wanted[index] as FeatureInstance).type.family);
        this.dropFalling(this.falling, index);
        continue;
      }
      const f = Math.min(1, t / COLLAPSE_MS);
      // Slow at first, then down it goes; it shakes while it gives way.
      const sink = f * f * (3 - 2 * f);
      const shake = 0.04 * (1 - f) * Math.sin(t / 28 + index);
      const { pivot } = falling;
      pivot.position.y =
        this.ctx.elevation.at(pivot.position.x, pivot.position.z) -
        falling.height * 0.85 * sink;
      pivot.rotation.set(
        shake + 0.07 * sink * Math.cos(falling.heading),
        0,
        0.07 * sink * Math.sin(falling.heading),
      );
    }
    for (const [index, falling] of this.toppling) {
      const t = nowMs - falling.startMs;
      if (t >= TOPPLE_END_MS) {
        this.dropFalling(this.toppling, index);
        continue;
      }
      const fall = Math.min(1, t / TOPPLE_FALL_MS);
      const angle = (Math.PI / 2) * 0.96 * fall * fall;
      const { pivot } = falling;
      pivot.rotation.set(
        angle * Math.cos(falling.heading),
        0,
        angle * Math.sin(falling.heading),
      );
      const sink =
        t <= TOPPLE_LIE_MS
          ? 0
          : (t - TOPPLE_LIE_MS) / (TOPPLE_END_MS - TOPPLE_LIE_MS);
      pivot.position.y =
        this.ctx.elevation.at(pivot.position.x, pivot.position.z) - 0.5 * sink;
    }
  }

  private setFire(index: number, on: boolean): void {
    const existing = this.burning.get(index);
    if (!on) {
      if (existing !== undefined) {
        this.object.remove(existing);
        this.burning.delete(index);
      }
      return;
    }
    if (existing !== undefined) return;
    const instance = this.wanted[index];
    if (instance === undefined) return;
    const x = instance.x + instance.width / 2;
    const z = instance.y + instance.height / 2;
    const flame = new Group();
    flame.name = "feature-fire";
    const size = Math.max(0.5, Math.min(instance.width, instance.height) * 0.6);
    const outer = new Mesh(this.flameGeometry, this.outer);
    outer.scale.set(size, 1, size);
    outer.position.y = 0.45;
    const inner = new Mesh(this.flameGeometry, this.inner);
    inner.scale.set(size * 0.55, 0.7, size * 0.55);
    inner.position.y = 0.32;
    flame.add(outer, inner);
    const treeHeight = Number(instance.type.render.height);
    flame.userData.height = Number.isFinite(treeHeight)
      ? Math.max(0.6, treeHeight * 0.55)
      : 1.2;
    flame.position.set(x, this.ctx.elevation.at(x, z), z);
    this.object.add(flame);
    this.burning.set(index, flame);
  }
}

/** What a standing feature shows for `row` (see `FeatureBlaze`). */
function blazeOf(instance: FeatureInstance, row: FeatureRow): FeatureBlaze {
  if (!row.alive) return "none";
  if (row.collapsing) return "collapse";
  if (row.burning) return "burning";
  if (instance.type.family !== "building") return "none";
  if (row.state >= STATE_WRECKED) return "fire";
  if (row.state >= STATE_DAMAGED) return "smoke";
  return "none";
}

/** How `old` went: a building, a tree (vegetation that blocks movement) or
 *  a piece of decor. */
function endOf(old: FeatureInstance): FeatureEnd {
  if (old.type.family === "building") return "building";
  if (old.type.family === "vegetation" && old.type.blocks !== "none") {
    return "tree";
  }
  return "decor";
}
