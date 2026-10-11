import ruleset from "@data/ruleset.json";
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  NormalBlending,
  Quaternion,
  Vector3,
} from "three";
import { typeDef } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  type MatchSnapshot,
} from "../sim/matchSnapshot";

/** Instances kept per effect kind; the oldest is recycled when full (spec 07 §3). */
export const EFFECT_CAPACITY = 512;

export const EFFECT_KINDS = [
  "muzzle",
  "impact",
  "blast",
  "explosion",
  "wreck",
  "body",
  "blood",
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/** Weapon fields used to pick and size a shot effect; `data/` is the source. */
interface WeaponDef {
  damageType: number;
  splashCenti: number;
  projectileTicks: number;
}

const WEAPONS = ruleset.weapons as readonly WeaponDef[];
const DAMAGE_TYPES = ruleset.damageTypes as readonly string[];

/** Tiles from the shooter to the muzzle flash (spec 07 §3). */
const MUZZLE_OFFSET = 0.3;
/** Simulation ticks per second, for `projectileTicks / 15` s delays. */
const TICKS_PER_SECOND = 15;
/** Tiles of explosion under this splash size (spec 07 §3). */
const MIN_EXPLOSION_SIZE = 0.6;
const THERMOBARIC_SCALE = 1.5;
/** The explosion grows in its first half (spec 07 AC-07-01). */
const EXPLOSION_GROWTH_START = 0.5;

const Y_AXIS = new Vector3(0, 1, 0);

/** Wreck fire flicker period and tint (spec 07 §3). */
const WRECK_FLICKER_MS = 180;
const WRECK_FIRE_COLOR = new Color(0xff6a00);
const WRECK_FIRE_MIX = 0.3;

interface EffectStyle {
  readonly durationMs: number;
  /** Portion of the life spent fading out; the rest is opaque. */
  readonly fadeMs: number;
  readonly size: readonly [number, number, number];
  readonly color: number;
  readonly additive: boolean;
}

const EFFECT_STYLES: Readonly<Record<EffectKind, EffectStyle>> = {
  muzzle: {
    durationMs: 80,
    fadeMs: 80,
    size: [0.15, 0.15, 0.15],
    color: 0xfff2a8,
    additive: true,
  },
  impact: {
    durationMs: 200,
    fadeMs: 200,
    size: [0.2, 0.2, 0.2],
    color: 0xb8a184,
    additive: true,
  },
  blast: {
    durationMs: 450,
    fadeMs: 450,
    size: [0.5, 0.5, 0.5],
    color: 0xff7a1a,
    additive: true,
  },
  explosion: {
    durationMs: 900,
    fadeMs: 900,
    size: [0.6, 0.6, 0.6],
    color: 0xff8c1a,
    additive: true,
  },
  wreck: {
    durationMs: 12_000,
    fadeMs: 2000,
    size: [1, 1, 1],
    color: 0x1a1a1a,
    additive: false,
  },
  body: {
    durationMs: 20_000,
    fadeMs: 3000,
    size: [0.25, 0.08, 0.12],
    color: 0x222222,
    additive: false,
  },
  blood: {
    durationMs: 30_000,
    fadeMs: 5000,
    size: [0.5, 0.02, 0.5],
    color: 0x5a0a0a,
    additive: false,
  },
};

export interface EffectSpawn {
  /** World tiles. */
  x: number;
  y: number;
  /** Per-axis size in tiles; defaults to the kind's size. */
  sizeXYZ?: readonly [number, number, number];
  /** Uniform size in tiles; overrides `sizeXYZ`. */
  size?: number;
  /** Rotation around Y in radians. */
  rotationY?: number;
  /** Absolute start time in ms; defaults to 0. */
  startMs?: number;
  /** Life in ms; defaults to the kind's duration. */
  durationMs?: number;
}

export interface Effects {
  readonly group: Group;
  /** One `InstancedMesh` per kind (spec 07 §3). */
  readonly meshes: Readonly<Record<EffectKind, InstancedMesh>>;
  spawn(kind: EffectKind, init: EffectSpawn): void;
  /** Removes the live instances of `kind`, or of every kind when omitted. */
  clear(kind?: EffectKind): void;
  /** Recomputes the visible instances at `nowMs`: expiry, scale and fade. */
  update(nowMs: number): void;
  /** Visible instance count per kind (the meshes' `count`). */
  counts(): Record<EffectKind, number>;
}

interface Instance {
  x: number;
  y: number;
  z: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  rotationY: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  fadeMs: number;
}

/** Pooled, instanced combat effects (spec 07 §3). */
export function createEffects(): Effects {
  const meshes = {} as Record<EffectKind, InstancedMesh>;
  const pools = {} as Record<EffectKind, Instance[]>;
  const group = new Group();

  for (const kind of EFFECT_KINDS) {
    const style = EFFECT_STYLES[kind];
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: style.additive,
      blending: style.additive ? AdditiveBlending : NormalBlending,
      depthWrite: !style.additive,
    });
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      material,
      EFFECT_CAPACITY,
    );
    mesh.count = 0;
    mesh.visible = false;
    // Instances move every frame; bounds computed at creation would cull them.
    mesh.frustumCulled = false;
    meshes[kind] = mesh;
    pools[kind] = [];
    group.add(mesh);
  }

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const color = new Color();

  function spawn(kind: EffectKind, init: EffectSpawn): void {
    const style = EFFECT_STYLES[kind];
    const pool = pools[kind];
    const size: readonly [number, number, number] =
      init.size !== undefined
        ? [init.size, init.size, init.size]
        : (init.sizeXYZ ?? style.size);
    const durationMs = init.durationMs ?? style.durationMs;
    const startMs = init.startMs ?? 0;
    if (pool.length >= EFFECT_CAPACITY) pool.shift();
    pool.push({
      x: init.x,
      y: init.y,
      z: size[1] / 2,
      sizeX: size[0],
      sizeY: size[1],
      sizeZ: size[2],
      rotationY: init.rotationY ?? 0,
      startMs,
      endMs: startMs + durationMs,
      durationMs,
      fadeMs: Math.min(style.fadeMs, durationMs),
    });
  }

  function update(nowMs: number): void {
    for (const kind of EFFECT_KINDS) {
      const pool = pools[kind];
      const style = EFFECT_STYLES[kind];
      const mesh = meshes[kind];

      let live = 0;
      for (let i = 0; i < pool.length; i++) {
        const instance = pool[i] as Instance;
        if (instance.endMs > nowMs) {
          if (live !== i) pool[live] = instance;
          live++;
        }
      }
      pool.length = live;

      let visible = 0;
      for (const instance of pool) {
        if (instance.startMs > nowMs) continue;
        const elapsed = nowMs - instance.startMs;
        const progress =
          instance.durationMs > 0 ? elapsed / instance.durationMs : 1;
        const fadeStart = instance.durationMs - instance.fadeMs;
        const fade =
          elapsed >= fadeStart && instance.fadeMs > 0
            ? Math.max(0, 1 - (elapsed - fadeStart) / instance.fadeMs)
            : 1;
        const growth =
          kind === "explosion"
            ? EXPLOSION_GROWTH_START + (1 - EXPLOSION_GROWTH_START) * progress
            : 1;
        // Additive tints fade to black; opaque decals shrink away instead.
        const shrink = style.additive ? 1 : fade;
        const grow = growth * shrink;

        position.set(instance.x, instance.z, instance.y);
        rotation.setFromAxisAngle(Y_AXIS, instance.rotationY);
        scale.set(
          instance.sizeX * grow,
          instance.sizeY * grow,
          instance.sizeZ * grow,
        );
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(visible, matrix);
        color.setHex(style.color);
        if (style.additive) {
          color.multiplyScalar(fade);
        } else if (kind === "wreck") {
          // Looping fire flicker on the wreck (spec 07 §3).
          const phase =
            nowMs / WRECK_FLICKER_MS + instance.x * 7.3 + instance.y * 3.1;
          const flicker = 0.5 + 0.5 * Math.sin(phase);
          color.lerp(WRECK_FIRE_COLOR, WRECK_FIRE_MIX * flicker);
        }
        mesh.setColorAt(visible, color);
        visible++;
      }

      mesh.count = visible;
      mesh.visible = visible > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  }

  function clear(kind?: EffectKind): void {
    const kinds: readonly EffectKind[] =
      kind === undefined ? EFFECT_KINDS : [kind];
    for (const target of kinds) {
      pools[target].length = 0;
      const mesh = meshes[target];
      mesh.count = 0;
      mesh.visible = false;
    }
  }

  return {
    group,
    meshes,
    spawn,
    clear,
    update,
    counts() {
      const result = {} as Record<EffectKind, number>;
      for (const kind of EFFECT_KINDS) result[kind] = meshes[kind].count;
      return result;
    },
  };
}

/** One shot effect per `fired` entity: a muzzle flash plus an impact, a blast
 *  or a delayed explosion sized by the shooter weapon's damage type
 *  (spec 07 §3, AC-07-02). A target missing from the snapshot draws only the
 *  muzzle. */
export function spawnShotEffects(
  snapshot: MatchSnapshot,
  effects: Effects,
  nowMs = 0,
): void {
  const byId = new Map<number, EntityState>();
  for (const entity of snapshot.entities) byId.set(entity.id, entity);

  for (const shooter of snapshot.entities) {
    if (!hasFlag(shooter, ENTITY_FLAGS.fired)) continue;
    const target =
      shooter.target === null ? null : (byId.get(shooter.target) ?? null);

    let offsetX = 0;
    let offsetY = 0;
    if (target !== null) {
      const dx = target.x - shooter.x;
      const dy = target.y - shooter.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        offsetX = (dx / length) * MUZZLE_OFFSET;
        offsetY = (dy / length) * MUZZLE_OFFSET;
      }
    }
    effects.spawn("muzzle", {
      x: shooter.x + offsetX,
      y: shooter.y + offsetY,
      startMs: nowMs,
    });
    if (target === null) continue;

    const weapon = WEAPONS[typeDef(shooter.kind).weapon];
    if (weapon === undefined) continue;
    const damageType = DAMAGE_TYPES[weapon.damageType];
    if (damageType === "smallArms" || damageType === "autocannon") {
      effects.spawn("impact", { x: target.x, y: target.y, startMs: nowMs });
    } else if (damageType === "antiTank") {
      effects.spawn("blast", { x: target.x, y: target.y, startMs: nowMs });
    } else if (damageType === "highExplosive" || damageType === "thermobaric") {
      const delayMs = (weapon.projectileTicks / TICKS_PER_SECOND) * 1000;
      const base = Math.max(MIN_EXPLOSION_SIZE, weapon.splashCenti / 100);
      const size =
        damageType === "thermobaric" ? base * THERMOBARIC_SCALE : base;
      effects.spawn("explosion", {
        x: target.x,
        y: target.y,
        size,
        startMs: nowMs + delayMs,
      });
    }
  }
}
