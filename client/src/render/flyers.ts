/**
 * Flyers (spec 43): the height, bank and rotor speed of aircraft and missiles,
 * and the fall of the ones shot down. The simulation only says whether a unit
 * is airborne (`ENTITY_FLAGS.airborne`); how it climbs and leans is
 * presentation, so it lives here and never feeds back.
 */
import { RULES, type TypeDef, typeDef } from "../rules";
import type { CombatEventState } from "../sim/combatSnapshot";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  type MatchSnapshot,
} from "../sim/matchSnapshot";
import type { Effects } from "./effects";
import { groundY } from "./elevation";
import { angleToYaw } from "./heading";

export type DeathEvent = Extract<CombatEventState, { kind: "death" }>;

/** Tiles added to the ruleset altitude so a flyer clears the tallest building
 *  (the Patriot, 1.6) and is never hidden behind one in the isometric view. */
export const AIR_CLEARANCE = 0.5;
/** Angle units in a full turn (spec 11 §6). */
const TURN = 65536;
/** Seconds a frame may advance the state by; a stall is not flight time. */
const MAX_STEP_S = 0.1;
/** Exponential rate of the climb, per second, and its minimum speed, tiles/s. */
const CLIMB_RATE = 2.4;
const CLIMB_MIN = 0.5;
/** Bank per radian/s of turn, its limit and how fast it follows, per second. */
const BANK_GAIN = 0.2;
const BANK_MAX = 0.55;
const BANK_RATE = 6;
/** Nose pitch per tile/s of climb and its limit. */
const PITCH_GAIN = 0.12;
const PITCH_MAX = 0.35;
/** How fast the rotors spin up or wind down, per second. */
const ROTOR_RATE = 3;
/** Radians per second of the two kinds of rotor at full speed. */
export const ROTOR_RADIANS = { y: 30, z: 48, x: 30 } as const;
/** A shot-down flyer falls for this long, plus a share per tile of height. */
const FALL_BASE_S = 0.35;
const FALL_PER_TILE_S = 0.22;
/** Nose-down angle a falling flyer ends at, and its tumble, radians. */
const FALL_PITCH = 1.15;
const FALL_ROLL_RATE = 3.2;
/** Longest drift along its heading while it falls, tiles. */
const FALL_DRIFT_MAX = 3;
/** Wreck size from which a crash explodes instead of only puffing, tiles. */
const CRASH_EXPLOSION_FROM = 0.85;
const TICKS_PER_SECOND = 15;

/** Cruise data of a flying type; null for everything on the ground. */
export interface AirInfo {
  /** Drawn height above the ground while airborne, tiles. */
  readonly altitude: number;
  readonly airClass: "low" | "high";
}

/** The `air` locomotor data of `type`, null when it does not fly. */
export function airInfo(type: TypeDef): AirInfo | null {
  const locomotor = RULES.locomotors[type.locomotor];
  if (locomotor === undefined || locomotor.kind !== "air") return null;
  return {
    altitude: (locomotor.altitudeCenti ?? 0) / 100 + AIR_CLEARANCE,
    airClass: locomotor.class ?? "low",
  };
}

/** True when `type` flies (aircraft, drones and missiles). */
export function isFlyerType(type: TypeDef): boolean {
  return airInfo(type) !== null;
}

/** True for a flyer the simulation marks airborne. */
export function isAirborne(entity: EntityState): boolean {
  return hasFlag(entity, ENTITY_FLAGS.airborne);
}

/** Height the entity settles at: cruise while airborne, the ground otherwise. */
export function targetAltitude(entity: EntityState): number {
  if (!isAirborne(entity)) return 0;
  return airInfo(typeDef(entity.kind))?.altitude ?? 0;
}

/** Spec 44: tiles from its target inside which a one-way flyer dives from
 *  its altitude to the ground (the sim's `DIVE_CENTI`). */
export const DIVE_TILES = 4;

/** `cruise` lowered for a one-way flyer in its final dive on `victim`. */
export function diveAltitude(
  entity: EntityState,
  victim: EntityState | undefined,
  cruise: number,
): number {
  if (victim === undefined || typeDef(entity.kind).oneWay === undefined) {
    return cruise;
  }
  const distance = Math.hypot(victim.x - entity.x, victim.y - entity.y);
  return distance >= DIVE_TILES ? cruise : (cruise * distance) / DIVE_TILES;
}

/** Missiles and jet drones leave a smoke trail: one-way flyers of the high
 *  class (Flamingo, Storm Shadow, Geran-3). */
export function leavesTrail(type: TypeDef): boolean {
  const info = airInfo(type);
  return info !== null && info.airClass === "high" && type.oneWay !== undefined;
}

/** True for a death the unit chose: a one-way unit detonating (killer is
 *  itself). Its blast comes from the detonation event, not from a wreck. */
export function isSelfDestruct(event: DeathEvent): boolean {
  return event.killer === event.victim;
}

/** True for a death of an airborne flyer in `previous` (not a parked one). */
export function isAirDeath(
  event: DeathEvent,
  previous: MatchSnapshot | null,
): boolean {
  const earlier = previous?.entities.find(
    (entity) => entity.id === event.victim,
  );
  return (
    earlier !== undefined &&
    isFlyerType(typeDef(earlier.kind)) &&
    isAirborne(earlier)
  );
}

/** Where a flyer is held in the air and how it leans. */
export interface FlightPose {
  /** Height above the ground, tiles. */
  readonly altitude: number;
  /** Radians about the nose; negative banks into a left turn. */
  readonly roll: number;
  /** Radians about the wings; positive lowers the nose. */
  readonly pitch: number;
  /** Rotor time in seconds at full speed: turns accumulated by the props. */
  readonly spin: number;
}

/** A flyer on its way down. */
export interface FallingFlyer extends FlightPose {
  readonly id: number;
  readonly kind: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  /** Yaw in radians. */
  readonly yaw: number;
}

interface FlyerState {
  altitude: number;
  roll: number;
  pitch: number;
  rotor: number;
  spin: number;
  heading: number;
}

interface Fall {
  readonly id: number;
  readonly kind: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
  readonly altitude: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly tumble: number;
  readonly spin: number;
}

export interface Flyers {
  /** Advances the pose of every flyer of `entities` to `nowMs`. */
  update(entities: readonly EntityState[], nowMs: number): void;
  /** The pose of flyer `id`; a level pose at the ground when unknown. */
  pose(id: number): FlightPose;
  /** Current drawn height of an entity: its eased altitude, 0 when it is not
   *  a flyer. */
  altitudeOf(entity: EntityState): number;
  /** Starts the fall of the airborne flyers among `events` and schedules the
   *  smoke along the way and the crash puff at the end. */
  kill(
    events: readonly DeathEvent[],
    previous: MatchSnapshot | null,
    nowMs: number,
    effects: Effects,
  ): void;
  /** Flyers still falling at `nowMs`. */
  falling(nowMs: number): FallingFlyer[];
}

const LEVEL: FlightPose = { altitude: 0, roll: 0, pitch: 0, spin: 0 };

const clamp = (value: number, limit: number): number =>
  Math.min(limit, Math.max(-limit, value));

/** `from` moved towards `to`: exponentially, but at least `minSpeed` tiles/s. */
export function approachAltitude(
  from: number,
  to: number,
  dt: number,
  rate = CLIMB_RATE,
  minSpeed = CLIMB_MIN,
): number {
  const gap = to - from;
  if (gap === 0) return to;
  const step = Math.max(
    Math.abs(gap) * (1 - Math.exp(-rate * dt)),
    minSpeed * dt,
  );
  return Math.abs(gap) <= step ? to : from + Math.sign(gap) * step;
}

/** Signed shortest difference between two angles in angle units. */
function turnDelta(from: number, to: number): number {
  return ((((to - from + TURN / 2) % TURN) + TURN) % TURN) - TURN / 2;
}

/** Bank angle of a flyer turning at `yawRate` radians per second. */
export function bankFor(yawRate: number): number {
  return clamp(-yawRate * BANK_GAIN, BANK_MAX);
}

export function createFlyers(): Flyers {
  const states = new Map<number, FlyerState>();
  let falls: Fall[] = [];
  let lastMs: number | null = null;
  let maxId = -1;
  let seeded = false;

  return {
    update(entities, nowMs) {
      const dt =
        lastMs === null
          ? 0
          : Math.min(MAX_STEP_S, Math.max(0, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      const seen = new Set<number>();
      let newest = maxId;
      const byId = new Map<number, EntityState>();
      for (const entity of entities) byId.set(entity.id, entity);
      for (const entity of entities) {
        newest = Math.max(newest, entity.id);
        const type = typeDef(entity.kind);
        if (!isFlyerType(type)) continue;
        seen.add(entity.id);
        const target = diveAltitude(
          entity,
          entity.target === null ? undefined : byId.get(entity.target),
          targetAltitude(entity),
        );
        let state = states.get(entity.id);
        if (state === undefined) {
          // A unit launched mid-match climbs from its rail; one that was
          // already flying (a save, a flyer entering sight) starts up there.
          const launched = seeded && entity.id > maxId;
          state = {
            altitude: launched ? 0 : target,
            roll: 0,
            pitch: 0,
            rotor: target > 0 ? 1 : 0,
            spin: entity.id * 0.37,
            heading: entity.heading,
          };
          states.set(entity.id, state);
        }
        if (dt <= 0) continue;
        const before = state.altitude;
        state.altitude = approachAltitude(before, target, dt);
        const climb = (state.altitude - before) / dt;
        state.pitch +=
          (-clamp(climb * PITCH_GAIN, PITCH_MAX) - state.pitch) *
          Math.min(1, BANK_RATE * dt);
        const yawRate =
          ((turnDelta(state.heading, entity.heading) / TURN) * Math.PI * 2) /
          dt;
        state.heading = entity.heading;
        const moving = hasFlag(entity, ENTITY_FLAGS.moving) ? 1 : 0;
        state.roll +=
          (bankFor(yawRate) * moving - state.roll) *
          Math.min(1, BANK_RATE * dt);
        state.rotor +=
          ((target > 0 || state.altitude > 0.05 ? 1 : 0) - state.rotor) *
          Math.min(1, ROTOR_RATE * dt);
        state.spin += state.rotor * dt;
      }
      for (const id of states.keys()) {
        if (!seen.has(id)) states.delete(id);
      }
      if (entities.length > 0) {
        maxId = newest;
        seeded = true;
      }
    },
    pose(id) {
      const state = states.get(id);
      return state === undefined
        ? LEVEL
        : {
            altitude: state.altitude,
            roll: state.roll,
            pitch: state.pitch,
            spin: state.spin,
          };
    },
    altitudeOf(entity) {
      const state = states.get(entity.id);
      if (state !== undefined) return state.altitude;
      return targetAltitude(entity);
    },
    kill(events, previous, nowMs, effects) {
      for (const event of events) {
        if (isSelfDestruct(event) || !isAirDeath(event, previous)) continue;
        const earlier = previous?.entities.find(
          (entity) => entity.id === event.victim,
        );
        if (earlier === undefined) continue;
        const type = typeDef(earlier.kind);
        const state = states.get(earlier.id);
        const altitude = state?.altitude ?? targetAltitude(earlier);
        const durationS = FALL_BASE_S + FALL_PER_TILE_S * altitude;
        const yaw = angleToYaw(earlier.heading);
        const speed = ((type.speedCenti / 100) * TICKS_PER_SECOND) / 4;
        const drift = Math.min(FALL_DRIFT_MAX, speed * durationS);
        const fall: Fall = {
          id: earlier.id,
          kind: earlier.kind,
          owner: earlier.owner,
          x: event.x,
          y: event.y,
          yaw,
          altitude,
          startMs: nowMs,
          durationMs: durationS * 1000,
          driftX: Math.sin(yaw) * drift,
          driftY: Math.cos(yaw) * drift,
          tumble: earlier.id % 2 === 0 ? 1 : -1,
          spin: state?.spin ?? 0,
        };
        falls.push(fall);
        scheduleCrash(fall, type, effects);
      }
    },
    falling(nowMs) {
      falls = falls.filter((fall) => nowMs < fall.startMs + fall.durationMs);
      return falls.map((fall) => fallPose(fall, nowMs));
    },
  };
}

/** Pose of `fall` at `nowMs`: it drops with gravity, noses over and tumbles. */
export function fallPose(fall: Fall, nowMs: number): FallingFlyer {
  const t = Math.min(1, Math.max(0, (nowMs - fall.startMs) / fall.durationMs));
  const along = t;
  return {
    id: fall.id,
    kind: fall.kind,
    owner: fall.owner,
    x: fall.x + fall.driftX * along,
    y: fall.y + fall.driftY * along,
    yaw: fall.yaw,
    altitude: fall.altitude * (1 - t * t),
    pitch: FALL_PITCH * t,
    roll: fall.tumble * FALL_ROLL_RATE * t * (fall.durationMs / 1000),
    spin: fall.spin + (t * fall.durationMs) / 1000,
  };
}

/** Smoke along the fall and the puff, and for a big wreck a fireball, at the
 *  end of it. Every effect is timed ahead, so the renderer needs no state. */
function scheduleCrash(fall: Fall, type: TypeDef, effects: Effects): void {
  const [w, , d] = type.render.size;
  const size = Math.max(w ?? 0, d ?? 0) / 100;
  const endX = fall.x + fall.driftX;
  const endY = fall.y + fall.driftY;
  const endMs = fall.startMs + fall.durationMs;
  const puffs = Math.max(3, Math.round(fall.durationMs / 70));
  for (let i = 0; i < puffs; i++) {
    const t = i / puffs;
    const at = fallPose(fall, fall.startMs + t * fall.durationMs);
    effects.spawn("trail", {
      x: at.x,
      y: at.y,
      z: at.altitude,
      size: 0.2 + size * 0.25,
      growTo: 0.6 + size * 0.5,
      startMs: fall.startMs + t * fall.durationMs,
    });
  }
  const base = groundY(endX, endY);
  if (size >= CRASH_EXPLOSION_FROM) {
    effects.spawn("explosion", {
      x: endX,
      y: endY,
      size: Math.min(1.8, size * 0.9),
      startMs: endMs,
    });
  } else {
    effects.spawn("impact", { x: endX, y: endY, startMs: endMs });
  }
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    effects.spawn("dust", {
      x: endX + dx * 0.15,
      y: endY + dy * 0.15,
      height: base + 0.08,
      size: 0.15,
      growTo: 0.2 + size * 0.45,
      durationMs: 900,
      fadeMs: 600,
      vx: dx * 0.8,
      vy: dy * 0.8,
      color: 0x8a7a5c,
      startMs: endMs,
    });
  }
  for (let i = 0; i < 3; i++) {
    effects.spawn("trail", {
      x: endX,
      y: endY,
      z: 0.2 + i * 0.25,
      size: 0.3 + size * 0.2,
      growTo: 0.9 + size * 0.5,
      vy: -0.2,
      startMs: endMs + i * 120,
    });
  }
}

/** Interval, real ms, between two puffs of a trail. */
export const FLYER_TRAIL_MS = 45;

/** Spawns the exhaust trail of the missiles and jet drones of `snapshot`;
 *  `lastPuff` holds the time of each one's latest puff. */
export function spawnFlyerTrails(
  snapshot: MatchSnapshot,
  flyers: Flyers,
  effects: Effects,
  nowMs: number,
  lastPuff: Map<number, number>,
): void {
  const present = new Set<number>();
  for (const entity of snapshot.entities) {
    const type = typeDef(entity.kind);
    if (!leavesTrail(type) || !isAirborne(entity)) continue;
    present.add(entity.id);
    const last = lastPuff.get(entity.id) ?? Number.NEGATIVE_INFINITY;
    if (nowMs - last < FLYER_TRAIL_MS) continue;
    lastPuff.set(entity.id, nowMs);
    const yaw = angleToYaw(entity.heading);
    const length = Math.max(type.render.size[2] ?? 100, 100) / 200;
    effects.spawn("trail", {
      x: entity.x - Math.sin(yaw) * length,
      y: entity.y - Math.cos(yaw) * length,
      z: flyers.altitudeOf(entity),
      size: 0.2,
      growTo: 0.75,
      startMs: nowMs,
    });
  }
  for (const id of lastPuff.keys()) {
    if (!present.has(id)) lastPuff.delete(id);
  }
}
