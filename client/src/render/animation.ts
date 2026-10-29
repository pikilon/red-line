/** Client-only unit animation for the entity renderer (spec 09 §4): turret
 *  recoil along its facing and infantry walk bob. Nothing here touches the
 *  simulation, the snapshot or the models; without an animator the renderer
 *  output is unchanged. */

import { typeDef, WEAPONS } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import { isRigged, picksUp, type RigState } from "./rig";

/** Turret kick at the moment of firing, in tiles (spec 09 §4). */
export const RECOIL_TILES = 0.08;
/** Linear return to rest, in ms (spec 09 §4). */
export const RECOIL_MS = 150;
/** Infantry walk bob amplitude, in tiles (spec 09 §4). */
export const BOB_TILES = 0.04;
/** One infantry step, in ms (spec 09 §4). */
export const BOB_PERIOD_MS = 360;

/** Kick of a turret `ageMs` after it fired: RECOIL_TILES * (1 - ageMs / RECOIL_MS)
 *  for 0 <= ageMs < RECOIL_MS, otherwise 0. */
export function recoilOffset(ageMs: number): number {
  if (ageMs < 0 || ageMs >= RECOIL_MS) return 0;
  return RECOIL_TILES * (1 - ageMs / RECOIL_MS);
}

/** Walk bob height: BOB_TILES * |sin(π * (nowMs / BOB_PERIOD_MS + id * 0.37))|.
 *  Always in [0, BOB_TILES]. */
export function bobHeight(id: number, nowMs: number): number {
  return (
    BOB_TILES *
    Math.abs(Math.sin(Math.PI * (nowMs / BOB_PERIOD_MS + id * 0.37)))
  );
}

/** Ticks per second of the simulation, to turn weapon cooldowns into ms. */
const TICKS_PER_SECOND = 15;
/** Rate, per second, at which walking, aiming and carrying ease in and out. */
const WALK_EASE = 6;
const AIM_EASE = 5;
const STAND_UP_EASE = 2.2;
const KNEEL_EASE = 1.6;
/** Seconds-based rates of the launcher pick-up and put-down (per second). */
const PICKUP_EASE = 0.85;
const PUT_DOWN_EASE = 1.2;
/** Rate at which a team's carry follows the stowing the simulation reports. */
const STOW_FOLLOW = 3;
/** Pick-up progress at which the team may walk off. */
const PICKUP_DONE = 0.95;
/** Ground speed above which a soldier walks, tiles per second, and the rate
 *  at which the measured speed follows the instant one. */
const WALK_SPEED = 0.3;
const SPEED_SMOOTHING = 10;
/** A soldier keeps aiming this long after a shot. */
const AIM_HOLD_MS = 1500;
/** Walk cycles per second (one cycle is two steps). */
const WALK_CYCLES_PER_SECOND = 2;
/** Launch styles of weapons whose reload the soldier shows. */
const VISIBLE_RELOADS = new Set(["backblast", "softLaunch"]);

/** A hit that did not kill: who, from which tile-plane direction it pushes
 *  (atan2(dy, dx)) and the tilt it jolts the body by, radians. */
export interface Hit {
  readonly id: number;
  readonly push: number;
  readonly amplitude: number;
}

/** Spec 35: shovel strokes per second of a digging soldier, and how fast
 *  (per second) he bends to it or puts it away. */
const DIG_STROKES_PER_SECOND = 0.9;
const DIG_EASE = 3;

/** Jolt of a hit: it peaks this long after the hit, lasts this long (ms) and
 *  never tilts more than `FLINCH_MAX` radians. */
const FLINCH_PEAK_MS = 70;
const FLINCH_MS = 700;
const FLINCH_MAX = 0.75;

export interface Pose {
  /** Tiles, pushed back along the turret's facing. */
  readonly recoil: number;
  /** Tiles, added to the model's height. */
  readonly lift: number;
  /** Limb pose of rigged infantry (spec 20), null for everything else. */
  readonly rig: RigState | null;
}

export interface Animator {
  /** Records `atMs` as the last shot of every entity with the `fired` flag and
   *  forgets shots older than RECOIL_MS. */
  recordShots(entities: readonly EntityState[], atMs: number): void;
  /** recoil = recoilOffset(nowMs - last shot) or 0 without a recorded shot;
   *  lift = bobHeight(id, nowMs) for a moving infantry unit (category "unit",
   *  armor 0, `moving` flag), otherwise 0. */
  pose(entity: EntityState, nowMs: number, digging?: boolean): Pose;
  /** Knocks the soldiers that took a hit without dying (spec 22 §6). */
  recordHits?(hits: readonly Hit[], atMs: number): void;
  /** Rig state of the last pose of `id`, null for units without one. */
  lastRig?(id: number): RigState | null;
}

/** Builds the recoil and lift poses for a snapshot (spec 09 §4). State lives
 *  only here; the renderer stays a pure function of it. */
export function createAnimator(): Animator {
  /** Entity id -> tick-advance-ms of its last fired shot. */
  const lastShotAt = new Map<number, number>();

  interface RigEntry {
    atMs: number;
    x: number;
    y: number;
    /** Smoothed ground speed, tiles per second. */
    speed: number;
    walk: number;
    phase: number;
    stance: number;
    aim: number;
    carry: number;
    shotAt: number;
    /** Last hit that did not kill: when, how hard (radians), which way. */
    hitAt: number;
    hitAmp: number;
    hitPush: number;
    dig: number;
    digPhase: number;
  }
  /** Entity id -> eased limb state of the infantry on screen. */
  const rigs = new Map<number, RigEntry>();
  /** Entity id -> last shot, kept for as long as the unit is alive. */
  const rigShots = new Map<number, number>();
  const lastRigs = new Map<number, RigState>();

  /** Tilt of the body now: a quick jolt that peaks `FLINCH_PEAK_MS` after the
   *  hit and recovers, shaped t·e^(1−t) so it never overshoots. */
  function flinchOf(entry: RigEntry, nowMs: number): number {
    const t = nowMs - entry.hitAt;
    if (t < 0 || t > FLINCH_MS) return 0;
    const x = t / FLINCH_PEAK_MS;
    return entry.hitAmp * x * Math.exp(1 - x);
  }

  function recordHits(hits: readonly Hit[], atMs: number): void {
    for (const hit of hits) {
      const entry = rigs.get(hit.id);
      if (entry === undefined) continue;
      // A second hit adds to what is left of the first.
      const left = flinchOf(entry, atMs);
      entry.hitAmp = Math.min(FLINCH_MAX, hit.amplitude + left);
      entry.hitAt = atMs;
      entry.hitPush = hit.push;
    }
  }

  function ease(value: number, target: number, rate: number, dt: number) {
    const step = rate * dt;
    return value + Math.max(-step, Math.min(step, target - value));
  }

  /** Eases the state of one soldier to what it is doing this frame. The `moving`
   *  flag only says the unit has an order (an attacker that stands in range has
   *  one too), so the walk follows the speed the unit really has. */
  function rigOf(
    entity: EntityState,
    nowMs: number,
    digging: boolean,
  ): RigState {
    const type = typeDef(entity.kind);
    let entry = rigs.get(entity.id);
    if (entry === undefined) {
      entry = {
        atMs: nowMs,
        x: entity.x,
        y: entity.y,
        speed: 0,
        walk: 0,
        phase: entity.id * 0.37,
        stance: 0,
        aim: 0,
        carry: 0,
        shotAt: rigShots.get(entity.id) ?? Number.NEGATIVE_INFINITY,
        hitAt: Number.NEGATIVE_INFINITY,
        hitAmp: 0,
        hitPush: 0,
        dig: 0,
        digPhase: entity.id * 0.29,
      };
      rigs.set(entity.id, entry);
    }
    const dt = Math.max(0, Math.min(0.1, (nowMs - entry.atMs) / 1000));
    entry.atMs = nowMs;
    if (dt > 0) {
      const instant = Math.hypot(entity.x - entry.x, entity.y - entry.y) / dt;
      entry.speed +=
        (instant - entry.speed) * Math.min(1, dt * SPEED_SMOOTHING);
      entry.x = entity.x;
      entry.y = entity.y;
    }
    const walking = entry.speed > WALK_SPEED;
    // A missile team stows its launcher before it walks and sets it up after
    // it stops; the simulation holds it still meanwhile and reports how far
    // along it is in `progress` (permille).
    const stows = type.stowTicks > 0;
    const stowed = stows ? entity.progress / 1000 : 0;
    const moving = walking || stowed > 0;
    // A team that picks something up stays put until it has it.
    const ready = !picksUp(type.id) || entry.carry >= PICKUP_DONE;
    entry.walk = ease(entry.walk, walking && ready ? 1 : 0, WALK_EASE, dt);
    entry.phase += dt * entry.walk * WALK_CYCLES_PER_SECOND;
    entry.stance = ease(
      entry.stance,
      moving ? 1 : 0,
      moving ? STAND_UP_EASE : KNEEL_EASE,
      dt,
    );
    // Moving drops the weapon pose (Zero Hour: the fire states need ATTACKING);
    // a unit that fires at a point of the ground has no target but aims.
    const firing = nowMs - entry.shotAt < AIM_HOLD_MS;
    const aiming = (entity.target !== null || firing) && !moving;
    entry.aim = ease(entry.aim, aiming ? 1 : 0, AIM_EASE, dt);
    entry.carry = stows
      ? ease(entry.carry, walking ? 1 : stowed, STOW_FOLLOW, dt)
      : ease(
          entry.carry,
          moving ? 1 : 0,
          moving ? PICKUP_EASE : PUT_DOWN_EASE,
          dt,
        );
    entry.dig = ease(
      entry.dig,
      digging && !moving && !aiming ? 1 : 0,
      DIG_EASE,
      dt,
    );
    entry.digPhase += dt * DIG_STROKES_PER_SECOND * (entry.dig > 0 ? 1 : 0);
    const weapon = type.weapon >= 0 ? WEAPONS[type.weapon] : undefined;
    const reloadMs =
      weapon !== undefined && VISIBLE_RELOADS.has(weapon.render.launch)
        ? (weapon.cooldownTicks * 1000) / TICKS_PER_SECOND
        : 0;
    return {
      walk: entry.walk,
      phase: entry.phase,
      stance: entry.stance,
      aim: entry.aim,
      carry: entry.carry,
      sinceShot: nowMs - entry.shotAt,
      reloadMs,
      flinch: flinchOf(entry, nowMs),
      flinchPush: entry.hitPush,
      dig: entry.dig,
      digPhase: entry.digPhase,
    };
  }

  function recordShots(entities: readonly EntityState[], atMs: number): void {
    const alive = new Set<number>();
    for (const entity of entities) {
      alive.add(entity.id);
      if (hasFlag(entity, ENTITY_FLAGS.fired)) {
        lastShotAt.set(entity.id, atMs);
        rigShots.set(entity.id, atMs);
        const entry = rigs.get(entity.id);
        if (entry !== undefined) entry.shotAt = atMs;
      }
    }
    for (const id of rigs.keys()) {
      if (!alive.has(id)) {
        rigs.delete(id);
        lastRigs.delete(id);
      }
    }
    for (const id of rigShots.keys()) if (!alive.has(id)) rigShots.delete(id);
  }

  function pose(entity: EntityState, nowMs: number, digging = false): Pose {
    const shotAt = lastShotAt.get(entity.id);
    // A recorded shot older than the linear return is forgotten: its recoil is 0.
    if (shotAt !== undefined && nowMs - shotAt >= RECOIL_MS) {
      lastShotAt.delete(entity.id);
    }
    const recoil = shotAt === undefined ? 0 : recoilOffset(nowMs - shotAt);

    const type = typeDef(entity.kind);
    let lift = 0;
    if (
      type.category === "unit" &&
      type.armor === 0 &&
      hasFlag(entity, ENTITY_FLAGS.moving)
    ) {
      lift = bobHeight(entity.id, nowMs);
    }

    const rig = isRigged(type.id) ? rigOf(entity, nowMs, digging) : null;
    if (rig !== null) lastRigs.set(entity.id, rig);
    return { recoil, lift, rig };
  }

  return {
    recordShots,
    recordHits,
    pose,
    lastRig: (id) => lastRigs.get(id) ?? null,
  };
}
