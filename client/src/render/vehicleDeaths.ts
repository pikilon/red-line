import ruleset from "@data/ruleset.json";
import { RULES, type TypeDef, typeDef, WEAPONS } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  type MatchSnapshot,
} from "../sim/matchSnapshot";
import type { DeathCauses } from "./deaths";

/** How a vehicle dies (spec 27 §4): its ammunition cooks off and throws the
 *  turret, it blows up in one big explosion, or it catches fire and burns
 *  out before it explodes. Zero Hour picks one `SlowDeathBehavior` per death
 *  by weight; here the weight roll is a hash of the unit id, so the same unit
 *  always dies the same way. */
export type VehicleDeath = "cookOff" | "blast" | "burnOut";

/** Integer hash of (`id`, `salt`) into [0, 1): the same id always rolls the
 *  same number, independent of frame rate or clock. */
export function unitHash(id: number, salt: number): number {
  let h = Math.imul((id | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((salt | 0) + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** Death weights (spec 27 §4). A Russian tank or IFV throws its turret most
 *  often (carousel autoloader); a Western one rarely; a vehicle without a
 *  turret only blows up or burns out. */
const WEIGHTS: Readonly<
  Record<"russian" | "turret" | "none", Readonly<Record<VehicleDeath, number>>>
> = {
  russian: { cookOff: 45, blast: 30, burnOut: 25 },
  turret: { cookOff: 20, blast: 40, burnOut: 40 },
  none: { cookOff: 0, blast: 50, burnOut: 50 },
};

/** A turret that can be thrown: tracked, turning and not a launcher or blade. */
export function canTossTurret(type: TypeDef): boolean {
  return (
    RULES.locomotors[type.locomotor]?.id === "tracked" &&
    type.turretTurnRateDeg > 0 &&
    type.articulation === "none"
  );
}

function isRussian(type: TypeDef): boolean {
  return RULES.factions[type.faction]?.id === "russia";
}

/** The death of vehicle `id` of `type`: a weighted roll on the id's hash. */
export function deathVariant(type: TypeDef, id: number): VehicleDeath {
  const table = canTossTurret(type)
    ? isRussian(type)
      ? WEIGHTS.russian
      : WEIGHTS.turret
    : WEIGHTS.none;
  const total = table.cookOff + table.blast + table.burnOut;
  let roll = unitHash(id, 1) * total;
  for (const variant of ["cookOff", "blast", "burnOut"] as const) {
    roll -= table[variant];
    if (roll < 0) return variant;
  }
  return "blast";
}

export function isVehicle(type: TypeDef): boolean {
  return type.category === "unit" && type.armor !== 0;
}

/** Damage state of a living vehicle (spec 27 §3): smoke under half its hp,
 *  fire under a quarter (the red health bar). */
export type DamageState = "pristine" | "damaged" | "burning";
export const DAMAGED_BELOW = 0.5;
export const BURNING_BELOW = 0.25;

export function damageState(hp: number, maxHp: number): DamageState {
  const ratio = hp / Math.max(1, maxHp);
  if (ratio > DAMAGED_BELOW) return "pristine";
  return ratio > BURNING_BELOW ? "damaged" : "burning";
}

// ---------------------------------------------------------------------------
// Hits that do not kill: the hull rocks away from the hit.

export type HitKind = "shot" | "explosion";

/** A vehicle that lost hp and lived. */
export interface VehicleImpact {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly kind: HitKind;
  /** Tile-plane direction the hit pushes (away from the shooter). */
  readonly push: number;
  /** Share of its hp the hit took. */
  readonly loss: number;
}

/** Vehicles that lost hp between two snapshots and lived (spec 27 §2). */
export function detectVehicleHits(
  prev: MatchSnapshot,
  next: MatchSnapshot,
  causes: DeathCauses,
  nowMs: number,
): VehicleImpact[] {
  if (next.tick <= prev.tick) return [];
  const before = new Map<number, EntityState>();
  for (const entity of prev.entities) before.set(entity.id, entity);
  const hits: VehicleImpact[] = [];
  for (const entity of next.entities) {
    const earlier = before.get(entity.id);
    if (earlier === undefined || entity.hp >= earlier.hp || entity.hp <= 0) {
      continue;
    }
    const type = typeDef(entity.kind);
    if (!isVehicle(type)) continue;
    const cause = causes.causeOf(entity, nowMs);
    hits.push({
      id: entity.id,
      x: entity.x,
      y: entity.y,
      kind: cause.kind === "explosion" ? "explosion" : "shot",
      push: cause.push,
      loss: (earlier.hp - entity.hp) / Math.max(1, type.hp),
    });
  }
  return hits;
}

const DAMAGE_TYPE_NAMES = ruleset.damageTypes as readonly string[];
/** Rounds that ricochet off armour; shells and missiles explode instead. */
const RICOCHET = new Set(["smallArms", "autocannon"]);

/** Bullets and cannon rounds fired at a vehicle in `snapshot` (spec 27 §2):
 *  they spark on the armour even when they cannot hurt it, as Zero Hour's
 *  `FX_DamageTankStruckSmallArms`. */
export function detectRicochets(snapshot: MatchSnapshot): VehicleImpact[] {
  const byId = new Map<number, EntityState>();
  for (const entity of snapshot.entities) byId.set(entity.id, entity);
  const hits: VehicleImpact[] = [];
  for (const shooter of snapshot.entities) {
    if (!hasFlag(shooter, ENTITY_FLAGS.fired) || shooter.target === null) {
      continue;
    }
    const target = byId.get(shooter.target);
    if (target === undefined || !isVehicle(typeDef(target.kind))) continue;
    const weapon = WEAPONS[typeDef(shooter.kind).weapon];
    if (weapon === undefined) continue;
    if (!RICOCHET.has(DAMAGE_TYPE_NAMES[weapon.damageType] ?? "")) continue;
    hits.push({
      id: target.id,
      x: target.x,
      y: target.y,
      kind: "shot",
      push: Math.atan2(target.y - shooter.y, target.x - shooter.x),
      loss: 0,
    });
  }
  return hits;
}

/** A rock of the hull: amplitude in radians, lift in tiles. */
export interface Kick {
  readonly push: number;
  readonly amplitude: number;
  readonly lift: number;
  readonly atMs: number;
}

const KICK_SHOT = 0.008;
const KICK_SHOT_PER_LOSS = 0.25;
const KICK_SHOT_MAX = 0.03;
const KICK_BLAST = 0.05;
const KICK_BLAST_PER_LOSS = 0.4;
const KICK_BLAST_MAX = 0.14;
const KICK_BLAST_LIFT = 0.025;
/** The hull rocks at this frequency on its suspension and settles in `τ`. */
const ROCK_HZ = 2.2;
const ROCK_DECAY_S = 0.22;
export const ROCK_LIFE_MS = 1200;
const ROCK_MAX = 0.16;

/** The kick a hit gives the hull: tiny for bullets, large for shells. */
export function kickOf(hit: VehicleImpact, atMs: number): Kick {
  const blast = hit.kind === "explosion";
  return {
    push: hit.push,
    amplitude: blast
      ? Math.min(KICK_BLAST_MAX, KICK_BLAST + hit.loss * KICK_BLAST_PER_LOSS)
      : Math.min(KICK_SHOT_MAX, KICK_SHOT + hit.loss * KICK_SHOT_PER_LOSS),
    lift: blast ? KICK_BLAST_LIFT : 0,
    atMs,
  };
}

export interface Rock {
  /** Radians, positive nose down (as the suspension). */
  readonly pitch: number;
  /** Radians about the long axis. */
  readonly roll: number;
  readonly lift: number;
}

export const NO_ROCK: Rock = { pitch: 0, roll: 0, lift: 0 };

/** Sum of the `kicks` on a hull of yaw `yaw` at `nowMs`: the top tips along
 *  the push, swings back once on the suspension and settles. */
export function rockAt(
  kicks: readonly Kick[],
  yaw: number,
  nowMs: number,
): Rock {
  let pitch = 0;
  let roll = 0;
  let lift = 0;
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  for (const kick of kicks) {
    const t = (nowMs - kick.atMs) / 1000;
    if (t < 0 || t * 1000 > ROCK_LIFE_MS) continue;
    const s = Math.sin(2 * Math.PI * ROCK_HZ * t) * Math.exp(-t / ROCK_DECAY_S);
    const px = Math.cos(kick.push);
    const py = Math.sin(kick.push);
    // Forward of the hull is (sin yaw, cos yaw); its right (cos yaw, -sin yaw).
    const along = px * sinYaw + py * cosYaw;
    const across = px * cosYaw - py * sinYaw;
    pitch += kick.amplitude * s * along;
    roll -= kick.amplitude * s * across;
    lift += kick.lift * Math.max(0, s);
  }
  const clamp = (v: number) => Math.max(-ROCK_MAX, Math.min(ROCK_MAX, v));
  return { pitch: clamp(pitch), roll: clamp(roll), lift };
}

// ---------------------------------------------------------------------------
// Hulks: the burning wreck a vehicle leaves.

/** A destroyed vehicle: drawn with its own model, charred (spec 27 §4). */
export interface Hulk {
  readonly id: number;
  readonly kind: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  /** Hull and turret yaw at death, radians. */
  readonly yaw: number;
  readonly turretYaw: number;
  readonly variant: VehicleDeath;
  /** Direction the killing blow pushed. */
  readonly push: number;
  readonly startMs: number;
}

/** Zero Hour hulks: sink after 14 s at 2 world units/s (0.2 tiles/s) and are
 *  removed at 20 s (`Hulk.ini` BattleMasterDeadHull). */
export const HULK_SINK_DELAY_MS = 14_000;
export const HULK_SINK_RATE = 0.2;
export const HULK_LIFE_MS = 20_000;
/** A burning-out vehicle explodes after this (Crusader `FX_CrusaderCatchFire`,
 *  DestructionDelay 2000). */
export const BURN_OUT_MS = 2000;
/** The ammunition cooks off and the turret pops this long after the hit. */
export const TURRET_POP_MS = 250;
/** Gravity on a thrown hull or turret, tiles/s². */
export const HULK_GRAVITY = 7;

export interface TurretFlight {
  /** World position of the turret pivot, tiles (x, height, y). */
  readonly x: number;
  readonly z: number;
  readonly y: number;
  /** Tumble about a horizontal axis (axisX, 0, axisZ), radians. */
  readonly axisX: number;
  readonly axisZ: number;
  readonly angle: number;
  /** Turret yaw, radians. */
  readonly yaw: number;
}

export interface HulkPose {
  readonly x: number;
  readonly y: number;
  readonly lift: number;
  readonly pitch: number;
  readonly roll: number;
  readonly yaw: number;
  /** Turret yaw while it stays on the hull. */
  readonly turretYaw: number;
  /** 0 clean .. 1 burnt black. */
  readonly char: number;
  /** The thrown turret, null while it sits on the hull. */
  readonly turret: TurretFlight | null;
}

/** Ballistic hop from the ground: height at `t` s, 0 outside the flight. */
function hop(v0: number, t: number): number {
  const flight = (2 * v0) / HULK_GRAVITY;
  if (t <= 0 || t >= flight) return 0;
  return v0 * t - 0.5 * HULK_GRAVITY * t * t;
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Pose of `hulk` at `nowMs`. `pivot` is the turret pivot in hull space and
 *  `height` the model height, tiles. */
export function hulkPose(
  hulk: Hulk,
  nowMs: number,
  pivot: { readonly x: number; readonly y: number; readonly z: number },
  height: number,
): HulkPose {
  const t = (nowMs - hulk.startMs) / 1000;
  const r = (salt: number) => unitHash(hulk.id, salt);
  const sink = Math.max(0, t - HULK_SINK_DELAY_MS / 1000) * HULK_SINK_RATE;
  const px = Math.cos(hulk.push);
  const py = Math.sin(hulk.push);
  // The tilt the wreck comes to rest with, the slew of its turret.
  const restPitch = (r(2) - 0.5) * 0.08;
  const restRoll = (r(3) - 0.5) * 0.1;
  const slew = (r(4) - 0.5) * 1.2;
  let lift = 0;
  let u = 0;
  let pitch = restPitch;
  let roll = restRoll;
  let turretYaw = hulk.turretYaw;
  let char = 1;
  let turret: TurretFlight | null = null;

  if (hulk.variant === "blast") {
    // One big explosion lifts the whole vehicle and drops it a little away.
    const v0 = 1.4 + r(5) * 0.5;
    const flight = (2 * v0) / HULK_GRAVITY;
    lift = hop(v0, t);
    const f = smooth(t / flight);
    u = 0.25 * f;
    const air = Math.sin(Math.PI * Math.min(1, t / flight));
    pitch = restPitch * f + (r(6) - 0.5) * 0.5 * air;
    roll = restRoll * f + (r(7) - 0.5) * 0.5 * air;
    turretYaw += slew * f;
    char = smooth(t / 0.15);
  } else if (hulk.variant === "burnOut") {
    // Burns where it stopped, then the fire reaches the ammunition.
    const boom = t - BURN_OUT_MS / 1000;
    char = smooth(t / (BURN_OUT_MS / 1000 + 0.2));
    lift = hop(0.8, boom);
    const f = smooth(boom / 0.25);
    pitch = restPitch * f;
    roll = restRoll * f;
    turretYaw += slew * 0.5 * f;
  } else {
    // Cook-off: the hull jolts, the turret is blown off and tumbles away.
    char = smooth(t / 0.2);
    const pop = t - TURRET_POP_MS / 1000;
    lift = hop(0.5, pop);
    if (pop > 0) {
      const cosYaw = Math.cos(hulk.yaw);
      const sinYaw = Math.sin(hulk.yaw);
      // The pivot in the world (model +Z is forward).
      const ox = hulk.x + pivot.x * cosYaw + pivot.z * sinYaw;
      const oy = hulk.y - pivot.x * sinYaw + pivot.z * cosYaw;
      const z0 = pivot.y;
      const up = 3.8 + r(8) * 1.4;
      const away = 0.7 + r(9) * 0.7;
      const dir = hulk.push + (r(10) - 0.5) * 2.4;
      const dx = Math.cos(dir);
      const dy = Math.sin(dir);
      // Lands on its ring (0) or upside down on its roof.
      const upsideDown = r(11) < 0.45;
      const zRest = upsideDown ? height * 0.3 : 0;
      const land =
        (up + Math.sqrt(up * up + 2 * HULK_GRAVITY * (z0 - zRest))) /
        HULK_GRAVITY;
      const spin = (5 + r(12) * 5) * (r(13) < 0.5 ? -1 : 1);
      const restAngle =
        (upsideDown ? Math.PI : 0) +
        (r(14) - 0.5) * 0.4 +
        2 * Math.PI * Math.round((spin * land) / (2 * Math.PI));
      let z: number;
      let along: number;
      let angle: number;
      if (pop < land) {
        z = z0 + up * pop - 0.5 * HULK_GRAVITY * pop * pop;
        along = away * pop;
        angle = spin * pop;
      } else {
        // One small bounce, then it rolls to rest.
        const after = pop - land;
        z = zRest + hop(up * 0.18, after);
        along = away * land + away * 0.3 * Math.min(after, 0.4);
        const settle = smooth(after / 0.45);
        angle = spin * land + (restAngle - spin * land) * settle;
      }
      // Tumbles about the horizontal axis across its flight.
      turret = {
        x: ox + dx * along,
        y: oy + dy * along,
        z: Math.max(zRest, z) - sink,
        axisX: -dy,
        axisZ: dx,
        angle,
        yaw: hulk.turretYaw + spin * 0.15 * Math.min(pop, land),
      };
    }
  }

  return {
    x: hulk.x + px * u,
    y: hulk.y + py * u,
    lift: lift - sink,
    pitch,
    roll,
    yaw: hulk.yaw,
    turretYaw,
    char,
    turret,
  };
}

/** Fire, smoke and flame-jet rates (per second) of a hulk at `t` s. */
export interface HulkRates {
  readonly fire: number;
  readonly smoke: number;
  /** The flame jet out of the turret ring of a cook-off. */
  readonly jet: number;
}

function ramp(t: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (t - from) / (to - from)));
}

/** How hard a hulk burns and smokes (spec 27 §4): a cook-off burns hardest,
 *  a burn-out grows before it explodes; every fire dies down and the smoke
 *  column outlasts it until the hulk sinks. */
export function hulkRates(variant: VehicleDeath, t: number): HulkRates {
  if (t < 0 || t * 1000 >= HULK_LIFE_MS) return { fire: 0, smoke: 0, jet: 0 };
  const smokeEnd = 1 - ramp(t, 15, 18);
  if (variant === "cookOff") {
    const pop = TURRET_POP_MS / 1000;
    return {
      fire: 18 * (1 - ramp(t, 8, 14)),
      smoke: 9 * smokeEnd,
      jet:
        t >= pop && t < pop + 1.4
          ? 40 * (1 - ramp(t, pop + 0.6, pop + 1.4))
          : 0,
    };
  }
  if (variant === "burnOut") {
    const boom = BURN_OUT_MS / 1000;
    if (t < boom) {
      const grow = t / boom;
      return { fire: 4 + 16 * grow, smoke: 3 + 5 * grow, jet: 0 };
    }
    return { fire: 12 * (1 - ramp(t, 4, 11)), smoke: 7 * smokeEnd, jet: 0 };
  }
  return { fire: 14 * (1 - ramp(t, 5, 12)), smoke: 7 * smokeEnd, jet: 0 };
}
