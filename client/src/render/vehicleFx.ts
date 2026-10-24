import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DataTexture,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from "three";
import { typeDef } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import type { DeathCauses } from "./deaths";
import { angleToYaw } from "./heading";
import {
  BURN_OUT_MS,
  damageState,
  deathVariant,
  HULK_LIFE_MS,
  type Hulk,
  type HulkPose,
  hulkPose,
  hulkRates,
  isVehicle,
  type Kick,
  kickOf,
  NO_ROCK,
  ROCK_LIFE_MS,
  type Rock,
  rockAt,
  TURRET_POP_MS,
  type VehicleImpact,
} from "./vehicleDeaths";

/** Vehicle hit, damage and death effects (spec 27), in their own meshes so
 *  they never compete with the ground effects of `effects.ts`. */

export const PARTICLE_KINDS = [
  "spark",
  "flash",
  "fire",
  "smoke",
  "chunk",
] as const;
export type ParticleKind = (typeof PARTICLE_KINDS)[number];

const CAPACITY: Readonly<Record<ParticleKind, number>> = {
  spark: 512,
  flash: 128,
  fire: 1536,
  smoke: 1536,
  chunk: 256,
};

/** Gravity on sparks and chunks, tiles/s². */
const GRAVITY = 7;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Tiles/s² pulling down (negative rises: hot smoke). */
  gravity: number;
  /** Fraction of the velocity lost per second. */
  drag: number;
  size0: number;
  size1: number;
  startMs: number;
  lifeMs: number;
  color0: number;
  color1: number;
  opacity: number;
  roll: number;
  spin: number;
  /** Chunks: spin axis tilt and a ground bounce. */
  stretch: number;
}

/** Hulk drawing information for the entity renderer. */
export interface VehicleBodies {
  /** Rock of a living vehicle's hull after a hit. */
  rock(id: number, yaw: number, nowMs: number): Rock;
  /** Hulks still on the map. */
  hulks(nowMs: number): readonly Hulk[];
  /** Pose of a hulk for a model of turret `pivot` and `height` tiles. */
  pose(
    hulk: Hulk,
    nowMs: number,
    pivot: { x: number; y: number; z: number },
    height: number,
  ): HulkPose;
}

export interface VehicleFx extends VehicleBodies {
  readonly group: Group;
  readonly meshes: Readonly<Record<ParticleKind, InstancedMesh>>;
  /** Sparks or a blast on the armour, and the rock of the hull. */
  hit(impacts: readonly VehicleImpact[], nowMs: number): void;
  /** Sparks of bullets striking armour, hurt or not. */
  ricochet(impacts: readonly VehicleImpact[]): void;
  /** Turns dead vehicles into hulks and starts their death. */
  kill(
    dead: readonly EntityState[],
    causes: DeathCauses | null,
    nowMs: number,
  ): void;
  /** Emits damage smoke and fire of `living`, moves the particles. */
  update(
    living: readonly EntityState[],
    nowMs: number,
    camera: Quaternion,
  ): void;
  clear(): void;
  counts(): Record<ParticleKind, number>;
}

/** A soft round sprite in the alpha channel: a hot core for fire, a lumpy
 *  puff for smoke. */
function spriteTexture(lumpy: boolean): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) / size - 0.5;
      const v = (j + 0.5) / size - 0.5;
      const r = Math.hypot(u, v) * 2;
      const angle = Math.atan2(v, u);
      const edge = lumpy
        ? 0.8 + 0.12 * Math.sin(angle * 5 + 1.3) + 0.08 * Math.sin(angle * 9)
        : 1;
      const t = Math.max(0, 1 - r / edge);
      const alpha = lumpy ? t ** 1.1 : t ** 1.1;
      const k = (j * size + i) * 4;
      data[k] = 255;
      data[k + 1] = 255;
      data[k + 2] = 255;
      data[k + 3] = Math.round(Math.min(1, alpha * (lumpy ? 1.5 : 1.8)) * 255);
    }
  }
  const texture = new DataTexture(
    data,
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Seeded generator for the look of particles: visual only, never gameplay. */
function generator(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SPARK_COLOR = 0xffe7a0;
const FIRE_HOT = 0xd8701c;
const FIRE_COOL = 0x5a1004;
const SMOKE_LIGHT = 0x8c8a86;
const SMOKE_DARK = 0x1e1c1a;
const CHUNK_COLOR = 0x24201d;
/** The wind leans every smoke column the same way, tiles/s. */
const WIND = { x: 0.18, y: -0.08 };
/** Where the engine deck sits along the hull, share of its length (back). */
const ENGINE_DECK = -0.3;

export function createVehicleFx(seed = 0x7a11): VehicleFx {
  const group = new Group();
  const meshes = {} as Record<ParticleKind, InstancedMesh>;
  const pools = {} as Record<ParticleKind, Particle[]>;
  const opacity = {} as Partial<Record<ParticleKind, InstancedBufferAttribute>>;
  const fireTexture = spriteTexture(false);
  const smokeTexture = spriteTexture(true);
  const box = new BoxGeometry(1, 1, 1);
  const plane = new PlaneGeometry(1, 1);

  for (const kind of PARTICLE_KINDS) {
    let mesh: InstancedMesh;
    if (kind === "chunk") {
      mesh = new InstancedMesh(box, new MeshLambertMaterial(), CAPACITY[kind]);
      mesh.castShadow = true;
    } else if (kind === "spark") {
      mesh = new InstancedMesh(
        box,
        new MeshBasicMaterial({
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
        CAPACITY[kind],
      );
    } else {
      const additive = kind !== "smoke";
      const material = new MeshBasicMaterial({
        map: additive ? fireTexture : smokeTexture,
        transparent: true,
        blending: additive ? AdditiveBlending : NormalBlending,
        depthWrite: false,
      });
      if (!additive) {
        // Each puff fades on its own: a per-instance opacity.
        material.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              "#include <common>\nattribute float instanceOpacity;\nvarying float vOpacity;",
            )
            .replace(
              "#include <begin_vertex>",
              "#include <begin_vertex>\nvOpacity = instanceOpacity;",
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying float vOpacity;",
            )
            .replace(
              "#include <alphamap_fragment>",
              "#include <alphamap_fragment>\ndiffuseColor.a *= vOpacity;",
            );
        };
      }
      mesh = new InstancedMesh(plane, material, CAPACITY[kind]);
      if (!additive) {
        const attribute = new InstancedBufferAttribute(
          new Float32Array(CAPACITY[kind]),
          1,
        );
        mesh.geometry = plane.clone();
        mesh.geometry.setAttribute("instanceOpacity", attribute);
        opacity[kind] = attribute;
      }
      // Smoke under the flames, flames over the smoke.
      mesh.renderOrder = additive ? 3 : 2;
    }
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    meshes[kind] = mesh;
    pools[kind] = [];
    group.add(mesh);
  }

  const rnd = generator(seed);
  const between = (a: number, b: number) => a + (b - a) * rnd();
  const kicks = new Map<number, Kick[]>();
  let hulks: Hulk[] = [];
  /** Emission debt per source (fractional particles carried to next frame). */
  const debt = new Map<string, number>();
  let lastMs: number | null = null;

  function emit(
    kind: ParticleKind,
    p: Partial<Particle> & {
      x: number;
      y: number;
      z: number;
      startMs: number;
      lifeMs: number;
    },
  ): void {
    const pool = pools[kind];
    if (pool.length >= CAPACITY[kind]) pool.shift();
    pool.push({
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: 0,
      drag: 0,
      size0: 0.1,
      size1: 0.1,
      color0: 0xffffff,
      color1: 0xffffff,
      opacity: 1,
      roll: rnd() * Math.PI * 2,
      spin: 0,
      stretch: 1,
      ...p,
    });
  }

  function sparks(
    x: number,
    y: number,
    z: number,
    away: number,
    count: number,
    startMs: number,
    spread = 1.3,
    speed = 2.2,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = away + (rnd() - 0.5) * 2 * spread;
      const s = speed * between(0.6, 1.4);
      emit("spark", {
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: between(0.4, 2.2),
        gravity: GRAVITY,
        size0: between(0.05, 0.09),
        size1: 0.02,
        color0: SPARK_COLOR,
        color1: 0xff7a20,
        startMs: startMs + rnd() * 40,
        lifeMs: between(120, 320),
      });
    }
  }

  function flash(
    x: number,
    y: number,
    z: number,
    size: number,
    startMs: number,
    lifeMs: number,
  ): void {
    emit("flash", {
      x,
      y,
      z,
      size0: size * 0.5,
      size1: size,
      color0: 0xfff0c0,
      color1: 0xff5a10,
      startMs,
      lifeMs,
    });
  }

  function fire(
    x: number,
    y: number,
    z: number,
    size: number,
    startMs: number,
    rise = 0.9,
    lifeMs = between(450, 800),
  ): void {
    emit("fire", {
      x: x + between(-0.04, 0.04),
      y: y + between(-0.04, 0.04),
      z,
      vx: WIND.x * 0.5 + between(-0.1, 0.1),
      vy: WIND.y * 0.5 + between(-0.1, 0.1),
      vz: rise * between(0.7, 1.3),
      size0: size * between(0.8, 1.1),
      size1: size * 0.35,
      color0: FIRE_HOT,
      color1: FIRE_COOL,
      spin: between(-1.5, 1.5),
      startMs,
      lifeMs,
    });
  }

  function smoke(
    x: number,
    y: number,
    z: number,
    size: number,
    startMs: number,
    dark: number,
    lifeMs = between(2600, 3800),
    alpha = 0.7,
  ): void {
    const tone = new Color(SMOKE_LIGHT)
      .lerp(new Color(SMOKE_DARK), dark)
      .getHex();
    emit("smoke", {
      x: x + between(-0.05, 0.05),
      y: y + between(-0.05, 0.05),
      z,
      vx: WIND.x + between(-0.06, 0.06),
      vy: WIND.y + between(-0.06, 0.06),
      vz: between(0.45, 0.75),
      drag: 0.25,
      size0: size,
      size1: size * between(2.6, 3.6),
      color0: tone,
      color1: new Color(tone).lerp(new Color(SMOKE_LIGHT), 0.35).getHex(),
      opacity: alpha,
      spin: between(-0.4, 0.4),
      startMs,
      lifeMs,
    });
  }

  function chunks(
    x: number,
    y: number,
    z: number,
    count: number,
    startMs: number,
    power: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const s = power * between(0.6, 1.6);
      const size = between(0.05, 0.13);
      emit("chunk", {
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: power * between(1.2, 2.6),
        gravity: GRAVITY,
        size0: size,
        size1: size,
        color0: CHUNK_COLOR,
        color1: CHUNK_COLOR,
        spin: between(-12, 12),
        stretch: between(0.4, 0.9),
        startMs: startMs + rnd() * 30,
        lifeMs: between(7000, 10_000),
      });
    }
  }

  function hit(impacts: readonly VehicleImpact[], nowMs: number): void {
    for (const impact of impacts) {
      const list = (kicks.get(impact.id) ?? []).filter(
        (k) => nowMs - k.atMs < ROCK_LIFE_MS,
      );
      list.push(kickOf(impact, nowMs));
      kicks.set(impact.id, list);
    }
  }

  /** Where a hit lands on the armour of `entity`: its side facing the shooter. */
  function armourPoint(
    entity: EntityState,
    push: number,
  ): { x: number; y: number; z: number } {
    const [w, h, d] = typeDef(entity.kind).render.size.map((s) => s / 100) as [
      number,
      number,
      number,
    ];
    const r = Math.min(w, d) * 0.5;
    return {
      x: entity.x - Math.cos(push) * r,
      y: entity.y - Math.sin(push) * r,
      z: h * between(0.35, 0.7),
    };
  }

  function hitFx(
    entities: readonly EntityState[],
    impacts: readonly VehicleImpact[],
    nowMs: number,
  ): void {
    const byId = new Map<number, EntityState>();
    for (const e of entities) byId.set(e.id, e);
    for (const impact of impacts) {
      const entity = byId.get(impact.id);
      if (entity === undefined) continue;
      const at = armourPoint(entity, impact.push);
      // Bullets ricochet back toward the shooter's side.
      const back = impact.push + Math.PI;
      if (impact.kind === "shot") {
        sparks(at.x, at.y, at.z, back, 3 + Math.floor(rnd() * 4), nowMs);
        flash(at.x, at.y, at.z, 0.16, nowMs, 70);
        smoke(at.x, at.y, at.z, 0.08, nowMs, 0.1, 500, 0.45);
      } else {
        flash(at.x, at.y, at.z, 0.42, nowMs, 160);
        sparks(at.x, at.y, at.z, back, 10, nowMs, 1.6, 3);
        for (let i = 0; i < 2; i++)
          fire(at.x, at.y, at.z, 0.16, nowMs, 0.6, 350);
        for (let i = 0; i < 3; i++)
          smoke(at.x, at.y, at.z, 0.18, nowMs + i * 40, 0.75, 1600, 0.75);
        chunks(at.x, at.y, at.z, 2, nowMs, 0.6);
      }
    }
  }

  let lastImpacts: VehicleImpact[] = [];

  function kill(
    dead: readonly EntityState[],
    causes: DeathCauses | null,
    nowMs: number,
  ): void {
    for (const entity of dead) {
      const type = typeDef(entity.kind);
      if (!isVehicle(type)) continue;
      const cause = causes?.causeOf(entity, nowMs) ?? { kind: "shot", push: 0 };
      const variant = deathVariant(type, entity.id);
      const hulk: Hulk = {
        id: entity.id,
        kind: entity.kind,
        owner: entity.owner,
        x: entity.x,
        y: entity.y,
        yaw: angleToYaw(entity.heading),
        turretYaw: angleToYaw(entity.turretAngle),
        variant,
        push: cause.push,
        startMs: nowMs,
      };
      hulks.push(hulk);
      kicks.delete(entity.id);
      const [, h] = type.render.size.map((s) => s / 100) as [
        number,
        number,
        number,
      ];
      const { x, y } = entity;
      if (variant === "blast") {
        flash(x, y, h * 0.6, 2.6, nowMs, 520);
        flash(x, y, h * 0.4, 1.6, nowMs + 90, 420);
        for (let i = 0; i < 16; i++) {
          const a = rnd() * Math.PI * 2;
          const s = between(0.3, 0.6);
          fire(
            x + Math.cos(a) * s,
            y + Math.sin(a) * s,
            between(0.1, 0.6),
            between(0.4, 0.8),
            nowMs + rnd() * 120,
            1.6,
            between(500, 900),
          );
        }
        for (let i = 0; i < 10; i++)
          smoke(
            x,
            y,
            h * 0.5,
            between(0.35, 0.6),
            nowMs + 100 + rnd() * 250,
            0.95,
            between(2500, 3500),
            0.85,
          );
        sparks(x, y, h * 0.5, 0, 20, nowMs, Math.PI, 3.2);
        chunks(x, y, h * 0.6, 12, nowMs, 1.1);
      } else if (variant === "cookOff") {
        flash(x, y, h * 0.6, 1.3, nowMs, 300);
        for (let i = 0; i < 4; i++)
          smoke(x, y, h, 0.25, nowMs + rnd() * 100, 0.9, 2000, 0.8);
        const pop = nowMs + TURRET_POP_MS;
        flash(x, y, h * 1.1, 1.8, pop, 420);
        sparks(x, y, h, 0, 24, pop, Math.PI, 3.5);
        chunks(x, y, h, 5, pop, 1);
        for (let i = 0; i < 6; i++)
          smoke(x, y, h * 1.1, 0.3, pop + rnd() * 200, 0.95, 2800, 0.85);
      } else {
        // The fire grows first; the explosion follows (spec 27 §4).
        const boom = nowMs + BURN_OUT_MS;
        flash(x, y, h * 0.6, 1.6, boom, 420);
        for (let i = 0; i < 10; i++)
          fire(
            x + between(-0.3, 0.3),
            y + between(-0.3, 0.3),
            between(0.1, 0.5),
            between(0.35, 0.6),
            boom + rnd() * 100,
            1.4,
            between(500, 800),
          );
        sparks(x, y, h * 0.6, 0, 14, boom, Math.PI, 2.8);
        chunks(x, y, h * 0.6, 6, boom, 0.9);
        for (let i = 0; i < 6; i++)
          smoke(x, y, h * 0.6, 0.35, boom + rnd() * 200, 0.95, 3000, 0.85);
      }
    }
  }

  /** Fractional emission: `rate` per second over `dt` s for source `key`. */
  function due(key: string, rate: number, dt: number): number {
    const total = (debt.get(key) ?? 0) + rate * dt;
    const n = Math.floor(total);
    debt.set(key, total - n);
    return n;
  }

  function emitDamage(
    living: readonly EntityState[],
    nowMs: number,
    dt: number,
  ): void {
    for (const entity of living) {
      const type = typeDef(entity.kind);
      if (!isVehicle(type)) continue;
      const state = damageState(entity.hp, type.hp);
      if (state === "pristine") continue;
      const [, h, d] = type.render.size.map((s) => s / 100) as [
        number,
        number,
        number,
      ];
      const yaw = angleToYaw(entity.heading);
      const deckX = entity.x + Math.sin(yaw) * d * ENGINE_DECK;
      const deckY = entity.y + Math.cos(yaw) * d * ENGINE_DECK;
      const burning = state === "burning";
      for (let i = due(`s${entity.id}`, burning ? 8 : 4, dt); i > 0; i--) {
        smoke(
          deckX,
          deckY,
          h * 0.85,
          burning ? 0.2 : 0.13,
          nowMs,
          burning ? 0.9 : 0.35,
          burning ? 3000 : 2200,
          burning ? 0.75 : 0.5,
        );
      }
      if (!burning) continue;
      for (let i = due(`f${entity.id}`, 7, dt); i > 0; i--) {
        fire(
          deckX + between(-0.12, 0.12),
          deckY + between(-0.12, 0.12),
          h * 0.75,
          between(0.12, 0.2),
          nowMs,
          0.8,
          between(300, 550),
        );
      }
    }
  }

  function emitHulks(nowMs: number, dt: number): void {
    for (const hulk of hulks) {
      const t = (nowMs - hulk.startMs) / 1000;
      const rates = hulkRates(hulk.variant, t);
      const type = typeDef(hulk.kind);
      const [w, h, d] = type.render.size.map((s) => s / 100) as [
        number,
        number,
        number,
      ];
      const pose = hulkPose(hulk, nowMs, { x: 0, y: h * 0.6, z: 0 }, h);
      const top = h * 0.7 + pose.lift;
      const spot = () => {
        const a = between(-0.5, 0.5) * w * 0.5;
        const b = between(-0.5, 0.5) * d * 0.5;
        return {
          x: pose.x + a * Math.cos(hulk.yaw) + b * Math.sin(hulk.yaw),
          y: pose.y - a * Math.sin(hulk.yaw) + b * Math.cos(hulk.yaw),
        };
      };
      for (let i = due(`hf${hulk.id}`, rates.fire, dt); i > 0; i--) {
        const at = spot();
        fire(
          at.x,
          at.y,
          Math.max(0.05, top - 0.1),
          between(0.38, 0.62),
          nowMs,
          1.1,
          between(400, 800),
        );
      }
      for (let i = due(`hs${hulk.id}`, rates.smoke, dt); i > 0; i--) {
        const at = spot();
        smoke(
          at.x,
          at.y,
          Math.max(0.1, top + 0.1),
          between(0.3, 0.45),
          nowMs,
          0.95,
          between(3200, 4500),
          0.9,
        );
      }
      for (let i = due(`hj${hulk.id}`, rates.jet, dt); i > 0; i--) {
        // The flame jet of the cook-off, out of the open turret ring.
        fire(
          pose.x + between(-0.08, 0.08),
          pose.y + between(-0.08, 0.08),
          top,
          between(0.3, 0.45),
          nowMs,
          between(3.5, 5.5),
          between(300, 520),
        );
      }
      if (pose.turret !== null && t > 1.5 && t < 16) {
        for (let i = due(`ht${hulk.id}`, 1.6, dt); i > 0; i--) {
          smoke(
            pose.turret.x,
            pose.turret.y,
            pose.turret.z + 0.1,
            0.14,
            nowMs,
            0.8,
            2600,
            0.55,
          );
        }
      }
    }
  }

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const spinQ = new Quaternion();
  const axis = new Vector3();
  const color = new Color();
  const color1 = new Color();
  const X_AXIS = new Vector3(1, 0, 0);
  const Z_AXIS = new Vector3(0, 0, 1);

  function draw(nowMs: number, camera: Quaternion): void {
    for (const kind of PARTICLE_KINDS) {
      const pool = pools[kind];
      let live = 0;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i] as Particle;
        if (p.startMs + p.lifeMs > nowMs) pool[live++] = p;
      }
      pool.length = live;
      const mesh = meshes[kind];
      const alphas = opacity[kind];
      let n = 0;
      for (const p of pool) {
        if (p.startMs > nowMs) continue;
        const t = (nowMs - p.startMs) / 1000;
        const f = Math.min(1, t / (p.lifeMs / 1000));
        // Drag slows the drift: distance = v (1 - e^(-k t)) / k.
        const travel = p.drag > 0 ? (1 - Math.exp(-p.drag * t)) / p.drag : t;
        let z = p.z + p.vz * travel - 0.5 * p.gravity * t * t;
        let x = p.x + p.vx * travel;
        let y = p.y + p.vy * travel;
        if (kind === "chunk") {
          // Falls, lands and lies; it does not roll on.
          const tLand =
            (p.vz + Math.sqrt(p.vz * p.vz + 2 * p.gravity * p.z)) / p.gravity;
          const tt = Math.min(t, tLand);
          x = p.x + p.vx * tt;
          y = p.y + p.vy * tt;
          z = Math.max(
            p.size0 * 0.3,
            p.z + p.vz * tt - 0.5 * p.gravity * tt * tt,
          );
          const angle = p.spin * tt;
          axis.set(p.stretch, 1 - p.stretch, 0.3).normalize();
          rotation.setFromAxisAngle(axis, angle);
          const shrink = f > 0.8 ? 1 - (f - 0.8) / 0.2 : 1;
          scale.set(
            p.size0 * 1.4 * shrink,
            p.size0 * 0.6 * shrink,
            p.size0 * shrink,
          );
        } else if (kind === "spark") {
          // A streak along its velocity now.
          const vz = p.vz - p.gravity * t;
          axis.set(p.vx, vz, p.vy);
          rotation.setFromUnitVectors(
            X_AXIS,
            axis.lengthSq() > 0 ? axis.normalize() : X_AXIS,
          );
          const len = p.size0 + (p.size1 - p.size0) * f;
          scale.set(len * 2.4, 0.012, 0.012);
          z = Math.max(0.01, z);
        } else {
          // A billboard that faces the camera and slowly turns.
          spinQ.setFromAxisAngle(Z_AXIS, p.roll + p.spin * t);
          rotation.copy(camera).multiply(spinQ);
          const grow = kind === "smoke" ? 1 - (1 - f) ** 2 : f;
          const s = p.size0 + (p.size1 - p.size0) * grow;
          scale.set(s, s, s);
          z = Math.max(0.02, z);
        }
        position.set(x, z, y);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(n, matrix);
        color.setHex(p.color0).lerp(color1.setHex(p.color1), f);
        if (kind === "fire" || kind === "flash" || kind === "spark") {
          // Additive: fades to black.
          const fade =
            kind === "fire"
              ? Math.sin(Math.PI * Math.min(1, f * 1.15)) ** 0.7
              : 1 - f;
          color.multiplyScalar(Math.max(0, fade));
        }
        mesh.setColorAt(n, color);
        if (alphas !== undefined) {
          // Puffs appear quickly and thin out as they spread.
          const fadeIn = Math.min(1, f / 0.08);
          alphas.setX(n, p.opacity * fadeIn * (1 - f) ** 0.9);
        }
        n++;
      }
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      if (alphas !== undefined) alphas.needsUpdate = true;
    }
  }

  return {
    group,
    meshes,
    hit(impacts, nowMs) {
      hit(impacts, nowMs);
      // Bullets spark from `ricochet`, whether or not they hurt.
      lastImpacts = [
        ...lastImpacts,
        ...impacts.filter((impact) => impact.kind === "explosion"),
      ];
    },
    ricochet(impacts) {
      lastImpacts = [...lastImpacts, ...impacts];
    },
    kill,
    update(living, nowMs, camera) {
      const dt =
        lastMs === null
          ? 0
          : Math.min(0.1, Math.max(0, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      if (lastImpacts.length > 0) {
        hitFx(living, lastImpacts, nowMs);
        lastImpacts = [];
      }
      hulks = hulks.filter((hulk) => nowMs - hulk.startMs < HULK_LIFE_MS);
      for (const [id, list] of kicks) {
        const keep = list.filter((k) => nowMs - k.atMs < ROCK_LIFE_MS);
        if (keep.length === 0) kicks.delete(id);
        else kicks.set(id, keep);
      }
      // Debts of units long gone are dropped now and then.
      if (debt.size > 4096) debt.clear();
      emitDamage(living, nowMs, dt);
      emitHulks(nowMs, dt);
      draw(nowMs, camera);
    },
    rock(id, yaw, nowMs) {
      const list = kicks.get(id);
      return list === undefined ? NO_ROCK : rockAt(list, yaw, nowMs);
    },
    hulks(nowMs) {
      return hulks.filter((hulk) => nowMs - hulk.startMs < HULK_LIFE_MS);
    },
    pose: hulkPose,
    clear() {
      for (const kind of PARTICLE_KINDS) {
        pools[kind].length = 0;
        meshes[kind].count = 0;
        meshes[kind].visible = false;
      }
      hulks = [];
      kicks.clear();
      debt.clear();
    },
    counts() {
      const result = {} as Record<ParticleKind, number>;
      for (const kind of PARTICLE_KINDS) result[kind] = meshes[kind].count;
      return result;
    },
  };
}
