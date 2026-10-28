import { lerpAngle } from "../render/heading";
import { fromRaw } from "./fixed";

export const MATCH_HEADER_LEN = 8;
export const ENTITY_STRIDE = 11;
export const QUEUE_SLOTS = 9;
export const QUEUE_STRIDE = 12; // building_id, headPermille, queue_len, kind_0..kind_8
export const RALLY_STRIDE = 3; // building_id, x raw, y raw (spec 33)
export const NEUTRAL = 255;
export const OBSERVER = 255;

export const ENTITY_FLAGS = {
  moving: 1,
  underConstruction: 2,
  ghost: 4,
  fired: 8,
  poweredOff: 16,
  /** Spec 31 block 2: garrisoned in a building; hidden on the map. */
  inside: 32,
  /** Spec 34: rides a vehicle (with `inside`); `progress` holds its id. */
  aboard: 64,
} as const;
export const OUTCOMES = ["ongoing", "winner", "draw"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface EntityState {
  id: number;
  owner: number;
  kind: number;
  x: number;
  y: number; // tiles
  hp: number;
  flags: number;
  progress: number;
  target: number | null;
  /** Hull heading in angle units, 65536 per turn (spec 11 §6). */
  heading: number;
  /** World turret angle (hull heading + turret) in angle units. */
  turretAngle: number;
} // target -1 -> null

export interface QueueState {
  building: number;
  headPermille: number;
  items: number[];
} // -1 slots dropped

export interface RallyState {
  building: number;
  x: number;
  y: number;
}

export interface MatchSnapshot {
  tick: number;
  viewer: number;
  credits: number;
  powerProduced: number;
  powerConsumed: number;
  outcome: Outcome;
  winner: number | null;
  entities: EntityState[];
  queues: QueueState[];
  rallies: RallyState[];
}

// decodeMatchSnapshot(data): per spec §5.15 — header (8), entity_count entities (11 each),
// then queue_count, then per-building queues (8 each). Observer sees 0 credits/power and no queues.
export function decodeMatchSnapshot(data: Int32Array): MatchSnapshot {
  const viewer = data[1] ?? 0;
  const isObserver = viewer === OBSERVER;
  const outcomeIndex = data[5] ?? 0;
  const winnerRaw = data[6] ?? -1;
  const entityCount = data[7] ?? 0;

  const entities: EntityState[] = [];
  for (let i = 0; i < entityCount; i++) {
    const base = MATCH_HEADER_LEN + i * ENTITY_STRIDE;
    const targetRaw = data[base + 8] ?? -1;
    entities.push({
      id: data[base] ?? 0,
      owner: data[base + 1] ?? 0,
      kind: data[base + 2] ?? 0,
      x: fromRaw(data[base + 3] ?? 0),
      y: fromRaw(data[base + 4] ?? 0),
      hp: data[base + 5] ?? 0,
      flags: data[base + 6] ?? 0,
      progress: data[base + 7] ?? 0,
      target: targetRaw < 0 ? null : targetRaw,
      heading: data[base + 9] ?? 0,
      turretAngle: data[base + 10] ?? 0,
    });
  }

  const queueBase = MATCH_HEADER_LEN + entityCount * ENTITY_STRIDE;
  const queueCount = data[queueBase] ?? 0;
  const queues: QueueState[] = [];
  for (let i = 0; i < queueCount; i++) {
    const base = queueBase + 1 + i * QUEUE_STRIDE;
    const items: number[] = [];
    for (let k = 3; k < 3 + QUEUE_SLOTS; k++) {
      const kind = data[base + k] ?? -1;
      if (kind >= 0) items.push(kind);
    }
    queues.push({
      building: data[base] ?? 0,
      headPermille: data[base + 1] ?? 0,
      items,
    });
  }

  const rallyBase = queueBase + 1 + queueCount * QUEUE_STRIDE;
  const rallyCount = data[rallyBase] ?? 0;
  const rallies: RallyState[] = [];
  for (let i = 0; i < rallyCount; i++) {
    const base = rallyBase + 1 + i * RALLY_STRIDE;
    rallies.push({
      building: data[base] ?? 0,
      x: fromRaw(data[base + 1] ?? 0),
      y: fromRaw(data[base + 2] ?? 0),
    });
  }

  return {
    tick: data[0] ?? 0,
    viewer,
    credits: isObserver ? 0 : (data[2] ?? 0),
    powerProduced: isObserver ? 0 : (data[3] ?? 0),
    powerConsumed: isObserver ? 0 : (data[4] ?? 0),
    outcome: OUTCOMES[outcomeIndex] ?? "ongoing",
    winner: winnerRaw < 0 ? null : winnerRaw,
    entities,
    queues,
    rallies,
  };
}

// hasFlag(entity, flag): true when the flag bit is set in entity.flags.
export function hasFlag(entity: EntityState, flag: number): boolean {
  return (entity.flags & flag) !== 0;
}

// interpolateEntities(prev, next, alpha): entities of `next` in order; an entity whose
// id is in prev gets its x/y interpolated (alpha clamped to [0, 1]), otherwise next's
// values; all other fields come from next.
export function interpolateEntities(
  prev: MatchSnapshot,
  next: MatchSnapshot,
  alpha: number,
): EntityState[] {
  const t = Math.min(1, Math.max(0, alpha));
  return next.entities.map((entity) => {
    const before = prev.entities.find(
      (prevEntity) => prevEntity.id === entity.id,
    );
    if (before === undefined) {
      return { ...entity };
    }
    return {
      ...entity,
      x: before.x + (entity.x - before.x) * t,
      y: before.y + (entity.y - before.y) * t,
      heading: lerpAngle(before.heading, entity.heading, t),
      turretAngle: lerpAngle(before.turretAngle, entity.turretAngle, t),
    };
  });
}
