import ruleset from "@data/ruleset.json";
import { typeDef, WEAPONS as WEAPON_DEFS } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  type MatchSnapshot,
  OBSERVER,
} from "../sim/matchSnapshot";
import type { Hit as Jolt } from "./animation";
import { type Corpse, type Corpses, type DeathCause, landing } from "./corpses";
import { DROPLET_GRAVITY, type Effects } from "./effects";
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

/** Jolt, radians, of a hit that did not kill: a floor by kind plus what the
 *  hit took of his hp (spec 22 §6). */
const JOLT_SHOT = 0.1;
const JOLT_BLAST = 0.28;
const JOLT_PER_LOSS = { shot: 1, explosion: 1.2 } as const;
const JOLT_MAX = 0.7;

/** A hit that did not kill, with where it landed. */
export interface Impact extends Jolt {
  readonly x: number;
  readonly y: number;
  /** Share of his hp he has left after the hit. */
  readonly health: number;
}

/** Soldiers that lost hp between two snapshots and lived: who, the way the hit
 *  pushes them and how hard (spec 22 §6). */
export function detectHits(
  prev: MatchSnapshot,
  next: MatchSnapshot,
  causes: DeathCauses,
  nowMs: number,
): Impact[] {
  if (next.tick <= prev.tick) return [];
  const before = new Map<number, EntityState>();
  for (const entity of prev.entities) before.set(entity.id, entity);
  const hits: Impact[] = [];
  for (const entity of next.entities) {
    const earlier = before.get(entity.id);
    if (earlier === undefined || entity.hp >= earlier.hp || entity.hp <= 0) {
      continue;
    }
    const type = typeDef(entity.kind);
    if (!isRigged(type.id)) continue;
    const cause = causes.causeOf(entity, nowMs);
    const loss = (earlier.hp - entity.hp) / Math.max(1, type.hp);
    const floor = cause.kind === "explosion" ? JOLT_BLAST : JOLT_SHOT;
    hits.push({
      id: entity.id,
      x: entity.x,
      y: entity.y,
      health: entity.hp / Math.max(1, type.hp),
      push: cause.push,
      amplitude: Math.min(
        JOLT_MAX,
        floor + loss * JOLT_PER_LOSS[cause.kind] * 2,
      ),
    });
  }
  return hits;
}

/** A soldier starts to bleed when a hit leaves him with less than this share
 *  of his hp: above it a hit only jolts him and stains his clothes (spec 22 §6). */
export const WOUND_BELOW = 0.7;
/** Splashes (jets) a hit throws by what is left of his hp: one under 70 %, two
 *  under 60 % and never more than two until he dies; a death throws four. */
export function splashesFor(health: number): number {
  if (health >= WOUND_BELOW) return 0;
  return health >= 0.6 ? 1 : 2;
}
const DEATH_SPLASHES = 4;
/** Where on the body a splash can leave, tiles above the ground and across the
 *  body: head, chest, arm, thigh. */
const WOUND_SITES = [
  { height: 0.43, across: 0 },
  { height: 0.3, across: 0 },
  { height: 0.27, across: 0.05 },
  { height: 0.14, across: 0.03 },
] as const;
/** Spread of a splash around the push direction, radians. */
const SPRAY_CONE = 0.2;
/** How far a splash leans to one side of the push, radians. */
const JET_LEAN = 0.15;
/** A splash leaves this long after the hit, ms: the jolt has started. */
const JET_ONSET_MS = 55;
/** Size of the splat a droplet leaves, tiles. */
const DROP_SPLAT = 0.05;
const DROP_SPLAT_SPREAD_MS = 120;
/** A wound's drops dry up sooner than a pool, ms. */
const WOUND_BLOOD_MS = 10_000;

/** Blood thrown out of wounds that left the soldier under `WOUND_BELOW` of his
 *  hp: from a random place of the body a thin jet leaves along the push, flies
 *  on a ballistic arc and, close by, stains the ground with a small splat; one
 *  splash under 70 %, two under 60 %, three under 20 % (spec 22 §6). Nothing
 *  without gore. */
export function spawnHitBlood(
  hits: readonly Impact[],
  effects: Effects,
  gore: boolean,
  nowMs = 0,
): void {
  if (!gore) return;
  for (const hit of hits) {
    const count = splashesFor(hit.health);
    if (count > 0) spawnSplashes(effects, hit, count, nowMs);
  }
}

/** `count` splashes from random places of the body of a soldier at (x, y). */
function spawnSplashes(
  effects: Effects,
  hit: Pick<Impact, "id" | "x" | "y" | "push" | "amplitude">,
  count: number,
  nowMs: number,
): void {
  // Every hit is different: the splashes change with a running number, not
  // only with who is hit.
  hitSerial += 1;
  const seed = hit.id * 12.9898 + hitSerial * 4.1414;
  const roll = (i: number, k: number) => {
    const h = Math.sin((seed + i * 78.233 + k * 37.719) * 43758.5453);
    return h - Math.floor(h);
  };
  const lean = (roll(0, 7) - 0.5) * 2 * JET_LEAN;
  for (let i = 0; i < count; i++) {
    const site = WOUND_SITES[Math.floor(roll(i, 6) * WOUND_SITES.length)];
    const height = site?.height ?? 0.3;
    const side = (site?.across ?? 0) * (roll(i, 11) < 0.5 ? -1 : 1);
    const angle = hit.push + lean + (roll(i, 1) - 0.5) * 2 * SPRAY_CONE;
    // Close by: the jet is short and falls quickly.
    const speed = 0.3 + roll(i, 2) * 0.45 + hit.amplitude * 0.25;
    const rise = 0.1 + roll(i, 3) * 0.3;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const flight =
      (rise + Math.sqrt(rise * rise + 2 * DROPLET_GRAVITY * height)) /
      DROPLET_GRAVITY;
    const x = hit.x - Math.sin(hit.push) * side;
    const y = hit.y + Math.cos(hit.push) * side;
    // Nothing before the jolt has started: the first leaves a moment after the
    // hit, the rest follow in quick succession.
    const delay = JET_ONSET_MS + i * 45 + roll(i, 5) * 30;
    effects.spawn("droplet", {
      x,
      y,
      height,
      velocity: [vx, vy, rise],
      durationMs: flight * 1000,
      startMs: nowMs + delay,
    });
    const size = DROP_SPLAT * (0.7 + roll(i, 4) * 0.8);
    effects.spawn("blood", {
      x: x + vx * flight,
      y: y + vy * flight,
      sizeXYZ: [size * (2.6 + roll(i, 10) * 1.2), 0.02, size * 0.75],
      rotationY: -angle,
      startMs: nowMs + delay + flight * 1000,
      spreadMs: DROP_SPLAT_SPREAD_MS,
      durationMs: WOUND_BLOOD_MS,
    });
  }
}

/** Number of wound jets thrown so far: the seed of the next one. */
let hitSerial = 0;

/** Tiles of wreck height relative to the model's render size (spec 07 §3). */
const WRECK_HEIGHT = 0.6;
/** Spread times of a spurt of drops and of a pool of blood, ms (spec 22 §4). */
const SPURT_SPREAD_MS = 180;
/** The ground spurts of a death are this much of the size they were first drawn. */
const SPURT_SCALE = 0.6;
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
  poseOf?: (entity: EntityState) => {
    kneel: number;
    joints: Readonly<Record<string, Record<string, number>>>;
  } | null,
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
        ...(poseOf?.(entity) ?? {}),
        // What hurt him before plus the blow that killed him.
        blood: Math.min(
          1,
          1 -
            Math.min(1, entity.hp / Math.max(1, type.hp)) +
            (cause.kind === "explosion" ? 0.7 : 0.45),
        ),
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
  const down = landing(corpse);
  const landed = nowMs + down.ms;
  const burst = (
    at: { x: number; y: number },
    size: number,
    turn: number,
    delayMs: number,
    stretch = 1,
  ) =>
    effects.spawn("blood", {
      ...at,
      sizeXYZ: [size * SPURT_SCALE * stretch, 0.02, size * SPURT_SCALE],
      rotationY: turn,
      startMs: nowMs + delayMs,
      spreadMs: SPURT_SPREAD_MS,
    });

  if (kind === "explosion") {
    const reach = Math.max(0.5, down.u);
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
    burst(along(reach + 0.35, 0.2), 0.26, spin + 1, down.ms, 1.3);
    return;
  }
  // Four splashes from random places of the body, thrown the way he is hit,
  // then the pool under the body once it is down.
  spawnSplashes(
    effects,
    { id: corpse.id, x: corpse.x, y: corpse.y, push, amplitude: 0.4 },
    DEATH_SPLASHES,
    nowMs,
  );
  effects.spawn("blood", {
    ...along(0.2 + Math.max(0, down.u)),
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
