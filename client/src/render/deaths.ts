import ruleset from "@data/ruleset.json";
import { typeDef } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  type MatchSnapshot,
  OBSERVER,
} from "../sim/matchSnapshot";
import type { Effects } from "./effects";

/** Weapon fields needed to bound a single hit; `data/` is the source of truth. */
interface WeaponDef {
  damageType: number;
  damage: number;
}

const WEAPONS = ruleset.weapons as readonly WeaponDef[];
const DAMAGE_MODIFIERS =
  ruleset.damageModifiers as readonly (readonly number[])[];
const ARMOR_COUNT = ruleset.armorClasses.length;
/** `damage * modifier` is per-mille of a hit, so hp is compared in the same unit. */
const PERCENT = 100;

/** Largest single hit (base damage × modifier) any weapon deals to `armor`. */
function maxSingleHit(armor: number): number {
  let best = 0;
  for (const weapon of WEAPONS) {
    const modifier = DAMAGE_MODIFIERS[weapon.damageType]?.[armor] ?? 0;
    best = Math.max(best, weapon.damage * modifier);
  }
  return best;
}

const MAX_SINGLE_HIT = Array.from({ length: ARMOR_COUNT }, (_, armor) =>
  maxSingleHit(armor),
);

/** Entities that died between two snapshots (spec 07 §4, AC-07-03).
 *
 *  A `prev` entity that is not a ghost, not a depot and still has `hp > 0`, is
 *  absent from a newer `next`. Buildings always die; a unit only when its last
 *  known hp could not survive one hit from any weapon, or when a `fired` entity
 *  in `prev` targeted it. That keeps units walking into the fog from leaving
 *  bodies. The observer sees everything, so every disappearance is a death. */
export function detectDeaths(
  prev: MatchSnapshot,
  next: MatchSnapshot,
  viewer: number,
): EntityState[] {
  if (next.tick <= prev.tick) return [];

  const present = new Set<number>();
  for (const entity of next.entities) present.add(entity.id);
  const targeted = new Set<number>();
  for (const entity of prev.entities) {
    if (hasFlag(entity, ENTITY_FLAGS.fired) && entity.target !== null) {
      targeted.add(entity.target);
    }
  }

  const deaths: EntityState[] = [];
  for (const entity of prev.entities) {
    if (hasFlag(entity, ENTITY_FLAGS.ghost)) continue;
    const type = typeDef(entity.kind);
    if (type.category === "depot") continue;
    if (entity.hp <= 0) continue;
    if (present.has(entity.id)) continue;
    const diesInOneHit =
      entity.hp * PERCENT <= (MAX_SINGLE_HIT[type.armor] ?? 0);
    if (
      type.category === "building" ||
      viewer === OBSERVER ||
      diesInOneHit ||
      targeted.has(entity.id)
    ) {
      deaths.push(entity);
    }
  }
  return deaths;
}

/** Tiles of wreck height relative to the model's render size (spec 07 §3). */
const WRECK_HEIGHT = 0.6;
/** Overlapping blood decals under an infantry body (spec 07 §3). */
const BLOOD_DECALS = 3;

/** Spawns the wreck, body and blood effects of `deaths` (spec 07 §3,
 *  AC-07-04). Blood is skipped when the gore filter is off. */
export function spawnDeathEffects(
  deaths: readonly EntityState[],
  effects: Effects,
  gore: boolean,
  nowMs = 0,
): void {
  for (const entity of deaths) {
    const type = typeDef(entity.kind);
    const [width, height, depth] = type.render.size.map(
      (size) => size / PERCENT,
    ) as [number, number, number];
    const infantry = type.category === "unit" && type.armor === 0;

    if (!infantry) {
      effects.spawn("wreck", {
        x: entity.x,
        y: entity.y,
        sizeXYZ: [width, height * WRECK_HEIGHT, depth],
        startMs: nowMs,
      });
      continue;
    }

    effects.spawn("body", { x: entity.x, y: entity.y, startMs: nowMs });
    if (!gore) continue;
    for (let i = 0; i < BLOOD_DECALS; i++) {
      const angle = entity.id * 2.399 + i * 2.094;
      const radius = 0.12 + ((entity.id + i) % 3) * 0.06;
      effects.spawn("blood", {
        x: entity.x + Math.cos(angle) * radius,
        y: entity.y + Math.sin(angle) * radius,
        rotationY: angle,
        startMs: nowMs,
      });
    }
  }
}
