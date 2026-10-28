import {
  AdditiveBlending,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";
import type { FeatureRow } from "../../sim/featureSnapshot";
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
 *  bridge disappears) and burning features carry flames. The static layers
 *  (ground, water) are not touched. */

/** Shortest time between two rebuilds of the same family, so a fire that
 *  changes the table every tick does not rebuild a forest every frame. */
const MIN_REBUILD_MS = 250;
const BRIDGE_BROKEN_STATE = 2;
const FLAME_OUTER = 0xff6a1a;
const FLAME_INNER = 0xffd23a;

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

  private readonly initial: FeatureInstance[];
  private readonly types: readonly FeatureTypeInfo[];
  private readonly ctx: FeatureContext;
  private readonly render: FamilyRenderer;
  /** The instance each row is drawn as now (parallel to the map features). */
  private readonly wanted: FeatureInstance[];
  private readonly alive: boolean[];
  private readonly burning = new Map<number, Group>();
  private readonly families = new Map<FeatureFamily, Object3D>();
  private readonly dirty = new Set<FeatureFamily>();
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
  ) {
    this.initial = [...initial];
    this.types = types;
    this.ctx = ctx;
    this.render = render;
    this.wanted = [...initial];
    this.alive = initial.map(() => true);
    this.object.name = "map-feature-families";
    for (const family of FEATURE_FAMILIES) this.dirty.add(family);
    this.rebuild(0);
  }

  /** Takes the feature table of a snapshot. */
  apply(rows: readonly FeatureRow[], nowMs: number): void {
    for (const row of rows) {
      this.adopt(row);
      const start = this.initial[row.index];
      const type = this.types[row.kind];
      const old = this.wanted[row.index];
      if (start === undefined || type === undefined || old === undefined) {
        continue;
      }
      const same =
        old.typeIndex === row.kind &&
        old.state === row.state &&
        this.alive[row.index] === row.alive;
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
      }
      this.setFire(row.index, row.alive && (row.burning || row.collapsing));
    }
    this.update(nowMs);
  }

  /** Rebuilds the changed families (rate limited) and animates the flames. */
  update(nowMs: number): void {
    if (this.dirty.size > 0 && nowMs - this.lastRebuildMs >= MIN_REBUILD_MS) {
      this.rebuild(nowMs);
    }
    for (const [index, flame] of this.burning) {
      const flicker = 1 + 0.25 * Math.sin(nowMs / 90 + index * 1.7);
      flame.scale.y = flame.userData.height * flicker;
    }
  }

  dispose(): void {
    for (const object of this.families.values()) disposeTree(object);
    for (const flame of this.burning.values()) this.object.remove(flame);
    this.burning.clear();
    this.flameGeometry.dispose();
    this.outer.dispose();
    this.inner.dispose();
  }

  /** Spec 35: a row dug during the match becomes an instance where it lies. */
  private adopt(row: FeatureRow): void {
    const type = this.types[row.kind];
    if (this.initial[row.index] !== undefined || row.at === undefined) return;
    if (type === undefined) return;
    const [width, height] = dimensions(type, row.at.rot);
    const instance: FeatureInstance = {
      type,
      typeIndex: row.kind,
      x: row.at.x,
      y: row.at.y,
      rot: row.at.rot,
      variant: 0,
      state: row.state,
      width,
      height,
    };
    this.initial[row.index] = instance;
    this.wanted[row.index] = instance;
    this.alive[row.index] = row.alive;
    this.dirty.add(type.family);
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
