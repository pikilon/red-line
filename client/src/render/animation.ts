/** Client-only unit animation for the entity renderer (spec 09 §4): turret
 *  recoil along its facing and infantry walk bob. Nothing here touches the
 *  simulation, the snapshot or the models; without an animator the renderer
 *  output is unchanged. */

import { typeDef, WEAPONS } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import { isRigged, type RigState } from "./rig";

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
const CARRY_EASE = 0.9;
/** Walk cycles per second (one cycle is two steps). */
const WALK_CYCLES_PER_SECOND = 2;
/** Launch styles of weapons whose reload the soldier shows. */
const VISIBLE_RELOADS = new Set(["backblast", "softLaunch"]);

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
  pose(entity: EntityState, nowMs: number): Pose;
}

/** Builds the recoil and lift poses for a snapshot (spec 09 §4). State lives
 *  only here; the renderer stays a pure function of it. */
export function createAnimator(): Animator {
  /** Entity id -> tick-advance-ms of its last fired shot. */
  const lastShotAt = new Map<number, number>();

  interface RigEntry {
    atMs: number;
    walk: number;
    phase: number;
    stance: number;
    aim: number;
    carry: number;
    shotAt: number;
  }
  /** Entity id -> eased limb state of the infantry on screen. */
  const rigs = new Map<number, RigEntry>();

  function ease(value: number, target: number, rate: number, dt: number) {
    const step = rate * dt;
    return value + Math.max(-step, Math.min(step, target - value));
  }

  /** Eases the state of one soldier to what its flags ask for this frame. */
  function rigOf(entity: EntityState, nowMs: number): RigState {
    const moving = hasFlag(entity, ENTITY_FLAGS.moving);
    let entry = rigs.get(entity.id);
    if (entry === undefined) {
      entry = {
        atMs: nowMs,
        walk: moving ? 1 : 0,
        phase: entity.id * 0.37,
        stance: moving ? 1 : 0,
        aim: 0,
        carry: moving ? 1 : 0,
        shotAt: Number.NEGATIVE_INFINITY,
      };
      rigs.set(entity.id, entry);
    }
    const dt = Math.max(0, Math.min(0.1, (nowMs - entry.atMs) / 1000));
    entry.atMs = nowMs;
    entry.walk = ease(entry.walk, moving ? 1 : 0, WALK_EASE, dt);
    entry.phase += dt * entry.walk * WALK_CYCLES_PER_SECOND;
    const wantStand = moving ? 1 : 0;
    entry.stance = ease(
      entry.stance,
      wantStand,
      wantStand === 1 ? STAND_UP_EASE : KNEEL_EASE,
      dt,
    );
    // Moving drops the weapon pose (Zero Hour: the fire states need ATTACKING).
    const aiming = entity.target !== null && !moving;
    entry.aim = ease(entry.aim, aiming ? 1 : 0, AIM_EASE, dt);
    entry.carry = ease(entry.carry, moving ? 1 : 0, CARRY_EASE, dt);
    const type = typeDef(entity.kind);
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
    };
  }

  function recordShots(entities: readonly EntityState[], atMs: number): void {
    const alive = new Set<number>();
    for (const entity of entities) {
      alive.add(entity.id);
      if (hasFlag(entity, ENTITY_FLAGS.fired)) {
        lastShotAt.set(entity.id, atMs);
        const entry = rigs.get(entity.id);
        if (entry !== undefined) entry.shotAt = atMs;
      }
    }
    for (const id of rigs.keys()) if (!alive.has(id)) rigs.delete(id);
  }

  function pose(entity: EntityState, nowMs: number): Pose {
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

    const rig = isRigged(type.id) ? rigOf(entity, nowMs) : null;
    return { recoil, lift, rig };
  }

  return { recordShots, pose };
}
