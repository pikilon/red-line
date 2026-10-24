import ruleset from "@data/ruleset.json";
import { typeDef, WEAPONS as WEAPON_DEFS } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  type MatchSnapshot,
  OBSERVER,
} from "../sim/matchSnapshot";
import {
  type Corpse,
  type Corpses,
  type DeathCause,
  settleMs,
  tossReach,
} from "./corpses";
import type { Effects } from "./effects";
import { angleToYaw } from "./heading";
import { isRigged } from "./rig";

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

/** How long a shot is remembered as the possible cause of a death, ms: a shell
 *  can fly for seconds before it kills. */
const CAUSE_MEMORY_MS = 5000;
/** Damage types that blow a soldier away; the others just shoot him. */
const EXPLOSIVE = new Set(["antiTank", "highExplosive", "thermobaric"]);
const DAMAGE_TYPE_NAMES = ruleset.damageTypes as readonly string[];
/** Extra reach of a blast beyond its splash radius, tiles. */
const BLAST_MARGIN = 0.4;
const MIN_BLAST_RADIUS = 1;

interface Hit {
  readonly fromX: number;
  readonly fromY: number;
  readonly atMs: number;
}

interface Blast extends Hit {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Remembers recent shots to tell, when a soldier disappears, whether he was
 *  shot or blown up and which way he is pushed (spec 22 §2). */
export interface DeathCauses {
  /** Notes the shots of a snapshot (entities with the `fired` flag). */
  record(entities: readonly EntityState[], atMs: number): void;
  /** Cause of the death of `victim`; a shot from nowhere pushes him back. */
  causeOf(victim: EntityState, nowMs: number): DeathCause;
}

export function createDeathCauses(): DeathCauses {
  const shots = new Map<number, Hit>();
  let blasts: Blast[] = [];

  function record(entities: readonly EntityState[], atMs: number): void {
    const byId = new Map<number, EntityState>();
    for (const entity of entities) byId.set(entity.id, entity);
    blasts = blasts.filter((blast) => atMs - blast.atMs < CAUSE_MEMORY_MS);
    for (const [id, hit] of shots) {
      if (atMs - hit.atMs >= CAUSE_MEMORY_MS) shots.delete(id);
    }
    for (const shooter of entities) {
      if (!hasFlag(shooter, ENTITY_FLAGS.fired) || shooter.target === null) {
        continue;
      }
      const target = byId.get(shooter.target);
      if (target === undefined) continue;
      const weapon = WEAPON_DEFS[typeDef(shooter.kind).weapon];
      if (weapon === undefined) continue;
      const hit = { fromX: shooter.x, fromY: shooter.y, atMs };
      if (EXPLOSIVE.has(DAMAGE_TYPE_NAMES[weapon.damageType] ?? "")) {
        blasts.push({
          ...hit,
          x: target.x,
          y: target.y,
          radius: Math.max(MIN_BLAST_RADIUS, weapon.splashCenti / 100),
        });
      } else {
        shots.set(target.id, hit);
      }
    }
  }

  function causeOf(victim: EntityState, nowMs: number): DeathCause {
    let best: Blast | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const blast of blasts) {
      if (nowMs - blast.atMs >= CAUSE_MEMORY_MS) continue;
      const distance = Math.hypot(victim.x - blast.x, victim.y - blast.y);
      if (distance <= blast.radius + BLAST_MARGIN && distance < bestDistance) {
        best = blast;
        bestDistance = distance;
      }
    }
    if (best !== null) {
      // Pushed away from the centre of the blast; right on it, along the shell.
      const away =
        bestDistance > 0.05
          ? Math.atan2(victim.y - best.y, victim.x - best.x)
          : Math.atan2(best.y - best.fromY, best.x - best.fromX);
      return { kind: "explosion", push: away };
    }
    const shot = shots.get(victim.id);
    if (shot !== undefined && nowMs - shot.atMs < CAUSE_MEMORY_MS) {
      return {
        kind: "shot",
        push: Math.atan2(victim.y - shot.fromY, victim.x - shot.fromX),
      };
    }
    // Unknown shooter (fog, ground fire): falls back along its own heading.
    return {
      kind: "shot",
      push: yawToPush(angleToYaw(victim.heading)) + Math.PI,
    };
  }

  return { record, causeOf };
}

/** Tile-plane direction (atan2(dy, dx)) that faces yaw `yaw`. */
function yawToPush(yaw: number): number {
  return Math.atan2(Math.cos(yaw), Math.sin(yaw));
}

/** Tiles of wreck height relative to the model's render size (spec 07 §3). */
const WRECK_HEIGHT = 0.6;
/** Spread times of a spurt of drops and of a pool of blood, ms (spec 22 §4). */
const SPURT_SPREAD_MS = 180;
const POOL_SPREAD_MS = 1400;
/** Overlapping blood decals under an infantry body (spec 07 §3). */
const BLOOD_DECALS = 3;
/** Rubble pieces scattered around a destroyed building (spec 09 §6). */
const DEBRIS_PIECES = 8;

/** Spawns the wreck, body and blood effects of `deaths` (spec 07 §3,
 *  AC-07-04, spec 22). Blood is skipped when the gore filter is off. A rigged
 *  soldier falls as a `corpses` body; other infantry leave the flat `body`. */
export function spawnDeathEffects(
  deaths: readonly EntityState[],
  effects: Effects,
  gore: boolean,
  nowMs = 0,
  corpses?: Corpses,
  causes?: DeathCauses,
  kneelOf?: (entity: EntityState) => number,
): void {
  for (const entity of deaths) {
    const type = typeDef(entity.kind);
    const [width, height, depth] = type.render.size.map(
      (size) => size / PERCENT,
    ) as [number, number, number];
    const infantry = type.category === "unit" && type.armor === 0;

    if (!infantry) {
      // Buildings leave only their rubble; vehicles keep the wreck box (spec 10 §6).
      if (type.category === "building") {
        spawnDebris(effects, entity, width, depth, nowMs);
      } else {
        effects.spawn("wreck", {
          x: entity.x,
          y: entity.y,
          sizeXYZ: [width, height * WRECK_HEIGHT, depth],
          startMs: nowMs,
        });
      }
      continue;
    }

    if (corpses !== undefined && isRigged(type.id)) {
      const cause: DeathCause = causes?.causeOf(entity, nowMs) ?? {
        kind: "shot",
        push: Math.PI,
      };
      const corpse = {
        id: entity.id,
        kind: entity.kind,
        owner: entity.owner,
        x: entity.x,
        y: entity.y,
        yaw: angleToYaw(entity.heading),
        cause,
        kneel: kneelOf?.(entity) ?? 0,
        startMs: nowMs,
      };
      corpses.add(corpse);
      if (gore) spawnBlood(effects, corpse, nowMs);
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

/** Blood of a falling soldier (spec 22 §4): first spurts, small splatters
 *  that appear in quick bursts while he is hit and thrown, then the pool, which
 *  spreads slowly once the body is down. */
function spawnBlood(effects: Effects, corpse: Corpse, nowMs: number): void {
  const { push, kind } = corpse.cause;
  const along = (distance: number, side = 0) => ({
    x: corpse.x + Math.cos(push) * distance - Math.sin(push) * side,
    y: corpse.y + Math.sin(push) * distance + Math.cos(push) * side,
  });
  const spin = corpse.id * 2.399;
  const landed = nowMs + settleMs(corpse);
  const burst = (
    at: { x: number; y: number },
    size: number,
    turn: number,
    delayMs: number,
    stretch = 1,
  ) =>
    effects.spawn("blood", {
      ...at,
      sizeXYZ: [size * stretch, 0.02, size],
      rotationY: turn,
      startMs: nowMs + delayMs,
      spreadMs: SPURT_SPREAD_MS,
    });

  if (kind === "explosion") {
    const reach = tossReach(corpse);
    // A few spurts follow the body through the air, in two quick bursts.
    for (let i = 0; i < 4; i++) {
      const f = 0.2 + i * 0.22;
      const side = (((corpse.id + i * 5) % 5) - 2) * 0.08;
      burst(
        along(reach * f, side),
        0.2 - i * 0.025,
        -push + side * 4,
        150 + i * 110,
        1.7,
      );
    }
    // Where he lands: a pool that spreads slowly, and one splash ahead.
    effects.spawn("blood", {
      ...along(reach),
      sizeXYZ: [0.8, 0.02, 0.72],
      rotationY: spin,
      startMs: landed,
      spreadMs: POOL_SPREAD_MS,
    });
    burst(along(reach + 0.35, 0.2), 0.26, spin + 1, settleMs(corpse), 1.3);
    return;
  }
  // Three quick spurts at the wound, flying the way he is hit, then the pool
  // under the body once it is down.
  for (let i = 0; i < 3; i++) {
    const side = (((corpse.id + i * 3) % 5) - 2) * 0.09;
    burst(
      along(0.1 + i * 0.1, side),
      0.15 + (i % 2) * 0.04,
      -push + side * 5,
      40 + i * 90,
      1.6,
    );
  }
  effects.spawn("blood", {
    ...along(0.18),
    sizeXYZ: [0.5, 0.02, 0.44],
    rotationY: spin,
    startMs: landed - 150,
    spreadMs: POOL_SPREAD_MS,
  });
}

/** Scatters `DEBRIS_PIECES` debris pieces around a destroyed building (spec 10 §6,
 *  AC-10-05). Each piece's height is `s × 0.8` and its colour is `0x4a4038`.
 *  `width` and `depth` are the building render size in tiles. Units never call
 *  this, so they spawn no debris. */
function spawnDebris(
  effects: Effects,
  entity: EntityState,
  width: number,
  depth: number,
  nowMs: number,
): void {
  const id = entity.id;
  for (let i = 0; i < DEBRIS_PIECES; i++) {
    const angle = (i * 2 * Math.PI) / 8 + id * 0.7;
    const radius = ((0.25 + 0.15 * (i % 3)) * Math.min(width, depth)) / 2;
    const s = 0.2 + 0.1 * ((id + i) % 3);
    effects.spawn("debris", {
      x: entity.x + Math.cos(angle) * radius,
      y: entity.y + Math.sin(angle) * radius,
      sizeXYZ: [s, s * 0.8, s],
      rotationY: angle,
      startMs: nowMs,
    });
  }
}
