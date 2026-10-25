/**
 * Projectile renderer (spec 17 §7.1): one instanced mesh per procedural model,
 * placed every frame along the weapon's flight profile from the combat
 * snapshot. Projectiles are presentation only; the simulation already decided
 * where and when each one lands.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { typeDef, WEAPONS } from "../rules";
import type { ProjectileState } from "../sim/combatSnapshot";
import type { MatchSnapshot } from "../sim/matchSnapshot";
import type { Effects } from "./effects";
import { groundY } from "./elevation";
import { FLIGHT_PROFILES, type FlightProfile, flightPoint } from "./flight";

export const PROJECTILE_MODELS = [
  "tracer",
  "tracerHeavy",
  "shell",
  "rpg",
  "atgm",
  "rocket",
] as const;
export type ProjectileModel = (typeof PROJECTILE_MODELS)[number];

/** Per model; extra projectiles are not drawn. */
export const PROJECTILE_CAPACITY = 1024;
/** Real milliseconds between two puffs of a smoke trail (spec 17 §7.3). */
export const TRAIL_INTERVAL_MS = 40;
/** Muzzle height when the shooter is not in the snapshot (tiles). */
const DEFAULT_MUZZLE = 0.5;
/** Muzzle height as a share of the shooter's render height. */
const MUZZLE_SHARE = 0.7;
/** Tiles in front of the shooter where the muzzle flash sits (spec 17 §7.2). */
const MUZZLE_OFFSET = 0.3;
const FIN_COUNT = 4;
const FIN_THICKNESS = 0.006;
const TAIL_LENGTH = 0.03;
/** Models are built along +Z, nose forward. */
const FORWARD = new Vector3(0, 0, 1);

/** A glowing box: tracers and shells. */
interface GlowLook {
  readonly glow: { size: [number, number, number]; color: number };
}

/** Body, fins and nose with an emissive tail: rockets and missiles. */
interface MissileLook {
  readonly missile: {
    radius: number;
    length: number;
    /** Nose cone; the rpg's is a wider warhead. */
    nose: { radius: number; length: number };
    fin: number;
    body: number;
    tail: number;
  };
}

type ProjectileLook = GlowLook | MissileLook;

const LOOKS: Record<ProjectileModel, ProjectileLook> = {
  tracer: { glow: { size: [0.03, 0.03, 0.45], color: 0xfff2b0 } },
  tracerHeavy: { glow: { size: [0.05, 0.05, 0.6], color: 0xffd27a } },
  shell: { glow: { size: [0.07, 0.07, 0.3], color: 0xffb347 } },
  rpg: {
    missile: {
      radius: 0.025,
      length: 0.25,
      nose: { radius: 0.05, length: 0.12 },
      fin: 0.06,
      body: 0x4a4f3a,
      tail: 0xff9a3a,
    },
  },
  atgm: {
    missile: {
      radius: 0.035,
      length: 0.4,
      nose: { radius: 0.035, length: 0.08 },
      fin: 0.06,
      body: 0x55604a,
      tail: 0xffcf7a,
    },
  },
  rocket: {
    missile: {
      radius: 0.05,
      length: 0.75,
      nose: { radius: 0.05, length: 0.15 },
      fin: 0.1,
      body: 0x8a8f86,
      tail: 0xffb04a,
    },
  },
};

export interface Projectiles {
  readonly group: Group;
  readonly meshes: Readonly<Record<ProjectileModel, InstancedMesh>>;
  /** Places every flying projectile (launchTick <= tick < impactTick) at `tick` (fractional). */
  sync(
    states: readonly ProjectileState[],
    tick: number,
    snapshot: MatchSnapshot,
  ): void;
  counts(): Record<ProjectileModel, number>;
  /** One entry per drawn projectile, in draw order (spec 17 §7.7). */
  samples(): { model: ProjectileModel; z: number; t: number }[];
  /** Spawns the launch effects of projectiles seen for the first time and the
   *  smoke trail of the flying ones (spec 17 §7.2–7.3). */
  spawnEffects(
    states: readonly ProjectileState[],
    tick: number,
    snapshot: MatchSnapshot,
    nowMs: number,
    effects: Effects,
  ): void;
}

/** Non-indexed copies so primitives of different kinds merge. */
function merged(parts: BufferGeometry[], useGroups: boolean): BufferGeometry {
  const flat = parts.map((part) => part.toNonIndexed());
  const result = mergeGeometries(flat, useGroups);
  if (result === null) throw new Error("projectile geometry merge failed");
  return result;
}

/** A Y-axis primitive turned to lie along +Z, centred on `z`. */
function alongZ(geometry: BufferGeometry, z: number): BufferGeometry {
  return geometry.rotateX(Math.PI / 2).translate(0, 0, z);
}

/** Body, nose and fins in group 0; the emissive tail in group 1. */
function missileGeometry(look: MissileLook["missile"]): BufferGeometry {
  const { radius, length, nose, fin } = look;
  // The tail end of the body sits at -length / 2; the nose tip ahead of it.
  const shift = -nose.length / 2;
  const body = alongZ(new CylinderGeometry(radius, radius, length, 8), shift);
  const cone = alongZ(
    new ConeGeometry(nose.radius, nose.length, 8),
    shift + (length + nose.length) / 2,
  );
  const finZ = shift - length / 2 + fin / 2;
  const fins = Array.from({ length: FIN_COUNT }, (_, index) =>
    new BoxGeometry(FIN_THICKNESS, fin, fin)
      .translate(0, radius + fin / 2, finZ)
      .rotateZ((index * Math.PI * 2) / FIN_COUNT),
  );
  const tail = alongZ(
    new CylinderGeometry(radius * 0.8, radius * 0.8, TAIL_LENGTH, 8),
    shift - length / 2 - TAIL_LENGTH / 2,
  );
  return merged([merged([body, cone, ...fins], false), tail], true);
}

function lookMesh(look: ProjectileLook): InstancedMesh {
  if ("glow" in look) {
    const [w, h, d] = look.glow.size;
    return new InstancedMesh(
      new BoxGeometry(w, h, d),
      new MeshBasicMaterial({
        color: look.glow.color,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
      PROJECTILE_CAPACITY,
    );
  }
  const materials: Material[] = [
    new MeshLambertMaterial({ color: look.missile.body }),
    new MeshBasicMaterial({ color: look.missile.tail }),
  ];
  return new InstancedMesh(
    missileGeometry(look.missile),
    materials,
    PROJECTILE_CAPACITY,
  );
}

const isModel = (value: string): value is ProjectileModel =>
  (PROJECTILE_MODELS as readonly string[]).includes(value);
const isProfile = (value: string): value is FlightProfile =>
  (FLIGHT_PROFILES as readonly string[]).includes(value);

const zeroCounts = (): Record<ProjectileModel, number> =>
  Object.fromEntries(PROJECTILE_MODELS.map((model) => [model, 0])) as Record<
    ProjectileModel,
    number
  >;

/** Muzzle height of every entity of `snapshot`, tiles (spec 17 §6). */
function muzzleHeights(snapshot: MatchSnapshot): Map<number, number> {
  const muzzles = new Map<number, number>();
  for (const entity of snapshot.entities) {
    muzzles.set(
      entity.id,
      (MUZZLE_SHARE * typeDef(entity.kind).render.size[1]) / 100,
    );
  }
  return muzzles;
}

/** The shooter end of a projectile path, where launch effects spawn. */
interface LaunchPoint {
  readonly originX: number;
  readonly originY: number;
  /** Unit vector from the impact back to the origin. */
  readonly backX: number;
  readonly backY: number;
  /** `origin − back × 0.3`, the muzzle point (spec 17 §7.2). */
  readonly muzzleX: number;
  readonly muzzleY: number;
  readonly height: number;
  readonly nowMs: number;
}

/** Tiles behind the origin where the backblast flashes. */
const BACKBLAST_OFFSET = 0.35;
/** Trail puffs left along `back` by a backblast launch, tiles. */
const BACKBLAST_TRAILS = [0.3, 0.6, 0.9] as const;
/** Trail puffs left along `back` by a soft launch, tiles. */
const SOFT_TRAILS = [0.3, 0.6] as const;
/** Launch dust and smoke, tiles (spec 17 §7.2). */
const DUST_SIZE = 0.15;
const DUST_GROW_TO = 0.45;
const DUST_COLOR = 0x8a7a5c;
const DUST_MS = 1000;
const DUST_FADE_MS = 600;
const TRAIL_SIZE = 0.1;
const TRAIL_GROW_TO = 0.4;
const SMOKE_SIZE = 0.6;
const SMOKE_GROW_TO = 1.4;

/** A ring of launch dust around the shooter, drifting outward. */
function spawnDustRing(
  at: LaunchPoint,
  count: number,
  radius: number,
  speed: number,
  effects: Effects,
): void {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const x = at.originX + dx * radius;
    const y = at.originY + dy * radius;
    effects.spawn("dust", {
      x,
      y,
      height: groundY(x, y) + 0.08,
      size: DUST_SIZE,
      growTo: DUST_GROW_TO,
      durationMs: DUST_MS,
      fadeMs: DUST_FADE_MS,
      vx: dx * speed,
      vy: dy * speed,
      color: DUST_COLOR,
      startMs: at.nowMs,
    });
  }
}

/** Trail puffs left behind the muzzle along the back of the shot. */
function spawnTrailPuffs(
  at: LaunchPoint,
  offsets: readonly number[],
  effects: Effects,
): void {
  for (const offset of offsets) {
    effects.spawn("trail", {
      x: at.muzzleX + at.backX * offset,
      y: at.muzzleY + at.backY * offset,
      z: at.height,
      size: TRAIL_SIZE,
      growTo: TRAIL_GROW_TO,
      vx: at.backX * 1.5,
      vy: at.backY * 1.5,
      startMs: at.nowMs,
    });
  }
}

/** The launch effects of `launch` at the shooter end of the path
 *  (spec 17 §7.2). An unknown launch draws a plain muzzle flash. */
function spawnLaunch(launch: string, at: LaunchPoint, effects: Effects): void {
  const muzzle = (size?: number): void => {
    effects.spawn("muzzle", {
      x: at.muzzleX,
      y: at.muzzleY,
      z: at.height,
      startMs: at.nowMs,
      ...(size === undefined ? {} : { size }),
    });
  };
  const backblast = (size: number): void => {
    effects.spawn("backblast", {
      x: at.originX + at.backX * BACKBLAST_OFFSET,
      y: at.originY + at.backY * BACKBLAST_OFFSET,
      z: at.height,
      size,
      startMs: at.nowMs,
    });
  };
  switch (launch) {
    case "cannon":
      muzzle(0.35);
      spawnDustRing(at, 6, 0.3, 0.6, effects);
      break;
    case "backblast":
      muzzle();
      backblast(0.5);
      spawnTrailPuffs(at, BACKBLAST_TRAILS, effects);
      spawnDustRing(at, 8, 0.2, 0.9, effects);
      break;
    case "softLaunch":
      muzzle(0.1);
      spawnTrailPuffs(at, SOFT_TRAILS, effects);
      break;
    case "rocketLaunch":
      backblast(1);
      spawnSmokeRing(at, effects);
      break;
    default:
      muzzle();
      break;
  }
}

/** The six smoke puffs a rocket launch rolls out of its tube. */
function spawnSmokeRing(at: LaunchPoint, effects: Effects): void {
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    effects.spawn("launchSmoke", {
      x: at.originX + dx * 0.4,
      y: at.originY + dy * 0.4,
      z: 0.15,
      size: SMOKE_SIZE,
      growTo: SMOKE_GROW_TO,
      vx: dx * 0.4,
      vy: dy * 0.4,
      startMs: at.nowMs,
    });
  }
}

export function createProjectiles(): Projectiles {
  const group = new Group();
  const meshes = Object.fromEntries(
    PROJECTILE_MODELS.map((model) => {
      const mesh = lookMesh(LOOKS[model]);
      mesh.count = 0;
      mesh.visible = false;
      // Instances fly anywhere on the map; the mesh bounds would cull them.
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
      return [model, mesh];
    }),
  ) as Record<ProjectileModel, InstancedMesh>;
  let counts = zeroCounts();
  let samples: { model: ProjectileModel; z: number; t: number }[] = [];
  const matrix = new Matrix4();
  const position = new Vector3();
  const direction = new Vector3();
  const rotation = new Quaternion();
  const unit = new Vector3(1, 1, 1);
  const muzzles = new Map<number, number>();
  /** Projectile ids whose launch effects already spawned (spec 17 §7.2). */
  const launched = new Set<number>();
  /** Last trail puff of each projectile, real ms (spec 17 §7.3). */
  const lastTrailMs = new Map<number, number>();

  return {
    group,
    meshes,
    sync(states, tick, snapshot) {
      counts = zeroCounts();
      samples = [];
      muzzles.clear();
      for (const [id, height] of muzzleHeights(snapshot)) {
        muzzles.set(id, height);
      }
      for (const state of states) {
        if (state.launchTick > tick || tick >= state.impactTick) continue;
        const render = WEAPONS[state.weapon]?.render;
        if (render === undefined || !isModel(render.model)) continue;
        const model = render.model;
        const index = counts[model];
        if (index >= PROJECTILE_CAPACITY) continue;
        const profile = isProfile(render.flight) ? render.flight : "straight";
        const point = flightPoint(
          state,
          tick,
          profile,
          muzzles.get(state.shooter) ?? DEFAULT_MUZZLE,
          render.apexCenti / 100,
        );
        // Sim (x, y) is the ground plane (Three x, z); the height is Three y.
        position.set(point.x, point.z, point.y);
        direction.set(point.dx, point.dz, point.dy);
        rotation.setFromUnitVectors(FORWARD, direction);
        matrix.compose(position, rotation, unit);
        meshes[model].setMatrixAt(index, matrix);
        counts[model] = index + 1;
        samples.push({ model, z: point.z, t: point.t });
      }
      for (const model of PROJECTILE_MODELS) {
        const mesh = meshes[model];
        mesh.count = counts[model];
        mesh.visible = mesh.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    counts: () => ({ ...counts }),
    samples: () => samples.map((sample) => ({ ...sample })),
    spawnEffects(states, tick, snapshot, nowMs, effects) {
      const heights = muzzleHeights(snapshot);
      for (const state of states) {
        const render = WEAPONS[state.weapon]?.render;
        if (render === undefined) continue;
        const height = heights.get(state.shooter) ?? DEFAULT_MUZZLE;
        if (state.launchTick <= tick && !launched.has(state.id)) {
          launched.add(state.id);
          lastTrailMs.set(state.id, nowMs);
          const dx = state.impactX - state.originX;
          const dy = state.impactY - state.originY;
          const length = Math.hypot(dx, dy);
          // A shot straight up has no ground direction; pick a stable one.
          const backX = length > 0 ? -dx / length : 0;
          const backY = length > 0 ? -dy / length : -1;
          spawnLaunch(
            render.launch,
            {
              originX: state.originX,
              originY: state.originY,
              backX,
              backY,
              muzzleX: state.originX - backX * MUZZLE_OFFSET,
              muzzleY: state.originY - backY * MUZZLE_OFFSET,
              height,
              nowMs,
            },
            effects,
          );
        }
        if (render.trail !== "smoke") continue;
        const flying = state.launchTick <= tick && tick < state.impactTick;
        if (!flying) continue;
        const last = lastTrailMs.get(state.id) ?? nowMs;
        if (nowMs - last < TRAIL_INTERVAL_MS) continue;
        lastTrailMs.set(state.id, nowMs);
        const profile = isProfile(render.flight) ? render.flight : "straight";
        const point = flightPoint(
          state,
          tick,
          profile,
          height,
          render.apexCenti / 100,
        );
        effects.spawn("trail", {
          x: point.x,
          y: point.y,
          z: point.z - groundY(point.x, point.y),
          size: TRAIL_SIZE,
          growTo: TRAIL_GROW_TO,
          startMs: nowMs,
        });
      }
    },
  };
}
