/** Client-only unit animation for the entity renderer (spec 09 §4): turret
 *  recoil along its facing and infantry walk bob. Nothing here touches the
 *  simulation, the snapshot or the models; without an animator the renderer
 *  output is unchanged. */

import { typeDef } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";

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

export interface Pose {
  /** Tiles, pushed back along the turret's facing. */
  readonly recoil: number;
  /** Tiles, added to the model's height. */
  readonly lift: number;
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

  function recordShots(entities: readonly EntityState[], atMs: number): void {
    for (const entity of entities) {
      if (hasFlag(entity, ENTITY_FLAGS.fired)) {
        lastShotAt.set(entity.id, atMs);
      }
    }
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

    return { recoil, lift };
  }

  return { recordShots, pose };
}
