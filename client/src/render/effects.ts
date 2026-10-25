import ruleset from "@data/ruleset.json";
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { ISOMETRIC_ELEVATION } from "../camera";
import { typeDef, WEAPONS, type WeaponDef } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  type MatchSnapshot,
} from "../sim/matchSnapshot";
import { groundY } from "./elevation";
import { createPuffTexture, createSplatTexture } from "./splat";

/** Instances kept per effect kind; the oldest is recycled when full (spec 07 §3). */
export const EFFECT_CAPACITY = 512;

export const EFFECT_KINDS = [
  "muzzle",
  "backblast",
  "impact",
  "blast",
  "explosion",
  "wreck",
  "body",
  "blood",
  "droplet",
  "debris",
  "dust",
  "launchSmoke",
  "trail",
  "clod",
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

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

/** Gravity on a thrown droplet, tiles/s² (a soldier is 0.5 tiles tall). */
export const DROPLET_GRAVITY = 4;

/** A blood splat starts at this fraction of its size and spreads in this time. */
const BLOOD_SPREAD_START = 0.35;
const BLOOD_SPREAD_MS = 700;

const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

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
  // The flash out of the back of a launcher (spec 17 §7.2): a brief, hot
  // orange-white glow behind the shooter.
  backblast: {
    durationMs: 150,
    fadeMs: 150,
    size: [0.5, 0.5, 0.5],
    color: 0xffd9a0,
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
    // The splat texture carries the colour (spec 22 §4).
    color: 0xffffff,
    additive: false,
  },
  // A drop of blood thrown from a wound: a speck on a ballistic arc (spec 22 §6).
  droplet: {
    durationMs: 700,
    fadeMs: 0,
    size: [0.12, 0.012, 0.012],
    color: 0x3a0606,
    additive: false,
  },
  debris: {
    durationMs: 15_000,
    fadeMs: 3000,
    size: [0.3, 0.18, 0.3],
    color: 0x4a4038,
    additive: false,
  },
  // A soft camera-facing puff of soil kicked up by an impact (spec 29 §3).
  dust: {
    durationMs: 800,
    fadeMs: 800,
    size: [0.3, 0.3, 0.3],
    color: 0x8a6a48,
    additive: false,
  },
  // The smoke a rocket launch rolls out of its tube (spec 17 §7.2).
  launchSmoke: {
    durationMs: 2500,
    fadeMs: 1500,
    size: [0.6, 0.6, 0.6],
    color: 0x9a9a92,
    additive: false,
  },
  // The puff a flying missile leaves behind (spec 17 §7.3).
  trail: {
    durationMs: 1200,
    fadeMs: 900,
    size: [0.1, 0.1, 0.1],
    color: 0xd8d8d0,
    additive: false,
  },
  // A clod of soil thrown by a blast: flies, lands and shrinks away (spec 29).
  clod: {
    durationMs: 5000,
    fadeMs: 1500,
    size: [0.05, 0.035, 0.05],
    color: 0x2e2014,
    additive: false,
  },
};

/** Kinds drawn as camera-facing puffs that fade through per-instance opacity. */
const PUFF_KINDS: ReadonlySet<EffectKind> = new Set([
  "dust",
  "launchSmoke",
  "trail",
]);
/** Camera-facing kinds, including the additive backblast flash. */
const BILLBOARD_KINDS: ReadonlySet<EffectKind> = new Set([
  ...PUFF_KINDS,
  "backblast",
]);

/** Real ms debris slides before it rests (spec 17 §7.5). */
const DEBRIS_THROW_MS = 600;

/** Gravity on a thrown clod, tiles/s²: heavier-looking than blood drops. */
const CLOD_GRAVITY = 7;
/** Tumble of a flying clod, radians per second. */
const CLOD_SPIN = 9;
/** A dust puff starts at this share of its size and grows to full. */
const DUST_GROWTH_START = 0.35;
/** Direction from the ground towards the fixed isometric camera (camera.ts). */
const TO_CAMERA = new Vector3(
  Math.cos(ISOMETRIC_ELEVATION) / Math.SQRT2,
  Math.sin(ISOMETRIC_ELEVATION),
  Math.cos(ISOMETRIC_ELEVATION) / Math.SQRT2,
).normalize();
const Z_AXIS = new Vector3(0, 0, 1);
/** Turns a +Z facing plane towards the camera. */
const FACE_CAMERA = new Quaternion().setFromUnitVectors(Z_AXIS, TO_CAMERA);

function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) * (1 - c);
}

/** Seconds until a body thrown up at `vz` from `height` over the ground
 *  lands under `CLOD_GRAVITY`. */
function landingTime(vz: number, height: number): number {
  const lift = Math.max(0, height);
  return (vz + Math.sqrt(vz * vz + 2 * CLOD_GRAVITY * lift)) / CLOD_GRAVITY;
}

/** Adds a per-instance opacity (`instanceAlpha`) to a basic material. */
function withInstanceAlpha(material: MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vInstanceAlpha;",
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.a *= vInstanceAlpha;",
      );
  };
}

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
  /** Fade-out time in ms; defaults to the kind's. */
  fadeMs?: number;
  /** Droplet only: launch velocity in tiles/s (x, y over the ground, up). Its
   *  life should be the flight time; gravity is `DROPLET_GRAVITY`. */
  velocity?: readonly [number, number, number];
  /** Height the droplet starts at, tiles. */
  height?: number;
  /** Blood only: ms a splat takes to spread to full size (a burst of drops
   *  is quick, a pool slow); defaults to `BLOOD_SPREAD_MS`. */
  spreadMs?: number;
  /** Dust and clods: tint (defaults to the kind's colour). */
  color?: number;
  /** Dust: peak opacity 0..1 (default 1). */
  alpha?: number;
  /** Clods: ground height they land on, tiles (default 0). */
  ground?: number;
  /** Height above the ground, tiles (puffs); defaults to half the size. */
  z?: number;
  /** Horizontal velocity, tiles per second (puffs); defaults to 0. */
  vx?: number;
  vy?: number;
  /** Final uniform size, tiles; the instance grows to it over its life. */
  growTo?: number;
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
  /** Ground height where it spawned (spec 30): heights are relative to it,
   *  except dust and clods, whose callers give world heights. */
  base: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  rotationY: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  fadeMs: number;
  spreadMs: number;
  /** Launch velocity and start height of a droplet, tiles/s and tiles. */
  vx: number;
  vy: number;
  vz: number;
  /** Tint, or -1 for the kind's colour. */
  color: number;
  alpha: number;
  ground: number;
  /** Final uniform size in tiles, or -1 for no growth target. */
  growTo: number;
  /** Drawn in at least one frame; an effect is never dropped unseen. */
  shown: boolean;
}

/** Pooled, instanced combat effects (spec 07 §3). */
export function createEffects(): Effects {
  const meshes = {} as Record<EffectKind, InstancedMesh>;
  const pools = {} as Record<EffectKind, Instance[]>;
  const group = new Group();

  for (const kind of EFFECT_KINDS) {
    const style = EFFECT_STYLES[kind];
    const decal = kind === "blood";
    const puff = PUFF_KINDS.has(kind);
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: style.additive || decal || puff,
      blending: style.additive ? AdditiveBlending : NormalBlending,
      depthWrite: !style.additive && !decal && !puff,
      // A blood splat is a flat textured quad lying on the ground.
      ...(decal
        ? {
            map: createSplatTexture(),
            polygonOffset: true,
            polygonOffsetFactor: -2,
          }
        : {}),
      ...(puff ? { map: createPuffTexture() } : {}),
    });
    let geometry = decal
      ? new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
      : new BoxGeometry(1, 1, 1);
    if (puff) {
      // Camera-facing puffs fade out through a per-instance opacity.
      geometry = new PlaneGeometry(1, 1);
      geometry.setAttribute(
        "instanceAlpha",
        new InstancedBufferAttribute(new Float32Array(EFFECT_CAPACITY), 1),
      );
      withInstanceAlpha(material);
    }
    const mesh = new InstancedMesh(geometry, material, EFFECT_CAPACITY);
    mesh.count = 0;
    mesh.visible = false;
    // Instances move every frame; bounds computed at creation would cull them.
    mesh.frustumCulled = false;
    // Only wrecks and debris enter the shadow pass (spec 10 §3).
    mesh.castShadow = kind === "wreck" || kind === "debris";
    // Dust is drawn after the ground marks and solid effects.
    if (puff) mesh.renderOrder = 2;
    meshes[kind] = mesh;
    pools[kind] = [];
    group.add(mesh);
  }

  /** Per-instance opacity of a puff kind, null for solid kinds. */
  function puffAlpha(kind: EffectKind): InstancedBufferAttribute | null {
    const attribute = meshes[kind].geometry.getAttribute("instanceAlpha");
    return attribute === undefined
      ? null
      : (attribute as InstancedBufferAttribute);
  }
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const streak = new Vector3();
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
      z: init.z ?? init.height ?? size[1] / 2,
      base: groundY(init.x, init.y),
      sizeX: size[0],
      sizeY: size[1],
      sizeZ: size[2],
      rotationY: init.rotationY ?? 0,
      startMs,
      endMs: startMs + durationMs,
      durationMs,
      fadeMs: Math.min(init.fadeMs ?? style.fadeMs, durationMs),
      spreadMs: init.spreadMs ?? BLOOD_SPREAD_MS,
      vx: init.vx ?? init.velocity?.[0] ?? 0,
      vy: init.vy ?? init.velocity?.[1] ?? 0,
      vz: init.velocity?.[2] ?? 0,
      color: init.color ?? -1,
      alpha: init.alpha ?? 1,
      ground: init.ground ?? 0,
      growTo: init.growTo ?? -1,
      shown: false,
    });
  }

  function update(nowMs: number): void {
    for (const kind of EFFECT_KINDS) {
      const pool = pools[kind];
      const style = EFFECT_STYLES[kind];
      const mesh = meshes[kind];
      const puff = PUFF_KINDS.has(kind);

      let live = 0;
      for (let i = 0; i < pool.length; i++) {
        const instance = pool[i] as Instance;
        // A slow frame must not drop an effect before it was ever drawn.
        const unseen = !instance.shown && instance.startMs <= nowMs;
        if (instance.endMs > nowMs || unseen) {
          if (live !== i) pool[live] = instance;
          live++;
        }
      }
      pool.length = live;

      let visible = 0;
      for (const instance of pool) {
        if (instance.startMs > nowMs) continue;
        // An effect first drawn after its lifetime is shown once at full
        // strength, as if the frame had come in time.
        const elapsed = instance.shown
          ? nowMs - instance.startMs
          : Math.min(
              nowMs - instance.startMs,
              Math.max(0, instance.durationMs - instance.fadeMs),
            );
        instance.shown = true;
        const progress =
          instance.durationMs > 0 ? elapsed / instance.durationMs : 1;
        const fadeStart = instance.durationMs - instance.fadeMs;
        const fade =
          elapsed >= fadeStart && instance.fadeMs > 0
            ? Math.max(0, 1 - (elapsed - fadeStart) / instance.fadeMs)
            : 1;
        let growth = 1;
        if (instance.growTo >= 0) {
          // A puff grows from its spawn size to an explicit target (spec 17 §7.2).
          const start = instance.sizeX;
          growth =
            start > 0
              ? (start + (instance.growTo - start) * progress) / start
              : 1;
        } else if (kind === "explosion") {
          growth =
            EXPLOSION_GROWTH_START + (1 - EXPLOSION_GROWTH_START) * progress;
        } else if (kind === "blood") {
          // A splat spreads when it appears, fast at first.
          const spread = Math.min(1, elapsed / instance.spreadMs);
          growth =
            BLOOD_SPREAD_START +
            (1 - BLOOD_SPREAD_START) * (1 - (1 - spread) ** 2);
        } else if (kind === "dust") {
          growth =
            DUST_GROWTH_START + (1 - DUST_GROWTH_START) * easeOut(progress);
        }
        // Additive tints fade to black; opaque decals shrink away instead,
        // and puffs fade through their own opacity.
        const shrink = style.additive || puff ? 1 : fade;
        const grow = growth * shrink;

        if (kind === "dust") {
          // Kicked out and up, slowing down as it spreads.
          const travel = (instance.durationMs / 1000) * easeOut(progress);
          position.set(
            instance.x + instance.vx * travel,
            instance.z + instance.vz * travel,
            instance.y + instance.vy * travel,
          );
          rotation.setFromAxisAngle(Z_AXIS, instance.rotationY);
          rotation.premultiply(FACE_CAMERA);
          puffAlpha("dust")?.setX(
            visible,
            instance.alpha * (1 - progress) ** 1.5,
          );
        } else if (
          kind === "launchSmoke" ||
          kind === "trail" ||
          kind === "backblast"
        ) {
          // Launch puffs drift with their velocity and fade in place
          // (spec 17 §7.2–7.3).
          const age = elapsed / 1000;
          position.set(
            instance.x + instance.vx * age,
            instance.base + instance.z,
            instance.y + instance.vy * age,
          );
          rotation.setFromAxisAngle(Z_AXIS, instance.rotationY);
          rotation.premultiply(FACE_CAMERA);
          if (kind !== "backblast") {
            puffAlpha(kind)?.setX(visible, instance.alpha * fade);
          }
        } else if (kind === "clod") {
          // Thrown on a ballistic arc; it rests where it lands.
          const flight = Math.min(
            elapsed / 1000,
            landingTime(instance.vz, instance.z - instance.ground),
          );
          position.set(
            instance.x + instance.vx * flight,
            Math.max(
              instance.ground,
              instance.z +
                instance.vz * flight -
                0.5 * CLOD_GRAVITY * flight * flight,
            ),
            instance.y + instance.vy * flight,
          );
          rotation.setFromAxisAngle(
            X_AXIS,
            instance.rotationY + CLOD_SPIN * flight,
          );
        } else if (kind === "droplet") {
          // Thrown from the wound: a ballistic arc until it lands.
          const flight = elapsed / 1000;
          const px = instance.x + instance.vx * flight;
          const pz = instance.y + instance.vy * flight;
          const floor = groundY(px, pz);
          position.set(
            px,
            Math.max(
              floor,
              instance.base +
                instance.z +
                instance.vz * flight -
                0.5 * DROPLET_GRAVITY * flight * flight,
            ),
            pz,
          );
        } else {
          // Effects sit on the ground where they spawned (spec 30 §4). Debris
          // kicked by a death slides a short way and rests (spec 17 §7.5).
          const travel =
            (DEBRIS_THROW_MS / 1000) * easeOut(elapsed / DEBRIS_THROW_MS);
          position.set(
            instance.x + instance.vx * travel,
            instance.base + instance.z,
            instance.y + instance.vy * travel,
          );
        }
        if (kind === "droplet") {
          // A thin streak lying along the way it flies (its velocity now).
          const flight = elapsed / 1000;
          streak.set(
            instance.vx,
            instance.vz - DROPLET_GRAVITY * flight,
            instance.vy,
          );
          rotation.setFromUnitVectors(
            X_AXIS,
            streak.lengthSq() > 0 ? streak.normalize() : X_AXIS,
          );
        } else if (!BILLBOARD_KINDS.has(kind) && kind !== "clod") {
          rotation.setFromAxisAngle(Y_AXIS, instance.rotationY);
        }
        scale.set(
          instance.sizeX * grow,
          instance.sizeY * grow,
          instance.sizeZ * grow,
        );
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(visible, matrix);
        color.setHex(instance.color >= 0 ? instance.color : style.color);
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
      const alpha = puffAlpha(kind);
      if (alpha !== null) alpha.needsUpdate = true;
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

/** The spec 07 explosion of `weapon` at (x, y): its splash size, 1.5× for a
 *  thermobaric warhead. Returns the size in tiles. */
function spawnExplosion(
  effects: Effects,
  weapon: WeaponDef,
  x: number,
  y: number,
  startMs: number,
): number {
  const damageType = DAMAGE_TYPES[weapon.damageType] ?? "";
  const base = Math.max(MIN_EXPLOSION_SIZE, weapon.splashCenti / 100);
  const size = damageType === "thermobaric" ? base * THERMOBARIC_SCALE : base;
  effects.spawn("explosion", { x, y, size, startMs });
  return size;
}

/** The spec 07 shot effect of a detonation at the event position (spec 17
 *  §7.4): an impact, a blast or an explosion, with no delay. A ballistic miss
 *  explodes on the ground where it landed. */
export function spawnDetonationEffect(
  effects: Effects,
  weaponIndex: number,
  x: number,
  y: number,
  nowMs = 0,
): void {
  const weapon = WEAPONS[weaponIndex];
  if (weapon === undefined) return;
  const damageType = DAMAGE_TYPES[weapon.damageType] ?? "";
  if (damageType === "smallArms" || damageType === "autocannon") {
    effects.spawn("impact", { x, y, startMs: nowMs });
  } else if (damageType === "antiTank") {
    effects.spawn("blast", { x, y, startMs: nowMs });
  } else if (damageType === "highExplosive" || damageType === "thermobaric") {
    spawnExplosion(effects, weapon, x, y, nowMs);
  }
}

/** One shot effect per `fired` entity with a hit-scan weapon: a muzzle flash
 *  plus an impact, a blast or an explosion sized by the shooter weapon's damage
 *  type (spec 07 §3, AC-07-02). Projectile weapons draw nothing here: their
 *  launch effects and detonations come from the combat snapshot (spec 17
 *  §7.4, §7.6). A target missing from the snapshot draws only the muzzle. */
export function spawnShotEffects(
  snapshot: MatchSnapshot,
  effects: Effects,
  nowMs = 0,
  onExplosion?: (x: number, y: number, size: number, startMs: number) => void,
  weapons: readonly WeaponDef[] = WEAPONS,
): void {
  const byId = new Map<number, EntityState>();
  for (const entity of snapshot.entities) byId.set(entity.id, entity);

  for (const shooter of snapshot.entities) {
    if (!hasFlag(shooter, ENTITY_FLAGS.fired)) continue;
    const weapon = weapons[typeDef(shooter.kind).weapon];
    if (weapon === undefined) continue;
    if (weapon.speedCenti !== 0 || weapon.projectileTicks !== 0) continue;
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

    const damageType = DAMAGE_TYPES[weapon.damageType] ?? "";
    if (damageType === "smallArms" || damageType === "autocannon") {
      effects.spawn("impact", { x: target.x, y: target.y, startMs: nowMs });
    } else if (damageType === "antiTank") {
      effects.spawn("blast", { x: target.x, y: target.y, startMs: nowMs });
    } else if (damageType === "highExplosive" || damageType === "thermobaric") {
      const delayMs = (weapon.projectileTicks / TICKS_PER_SECOND) * 1000;
      const size = spawnExplosion(
        effects,
        weapon,
        target.x,
        target.y,
        nowMs + delayMs,
      );
      onExplosion?.(target.x, target.y, size, nowMs + delayMs);
    }
  }
}
