import { typeDef } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import {
  CLICK_PICK_RADIUS_TILES,
  type ScreenPoint,
  type ScreenRect,
} from "./selection";

function isUnit(entity: EntityState): boolean {
  return typeDef(entity.kind).category === "unit";
}

/** True when the point lies inside [x - w/2, x + w/2] x [y - h/2, y + h/2]. */
function containsPoint(entity: EntityState, x: number, y: number): boolean {
  const [width, height] = typeDef(entity.kind).footprint;
  return (
    x >= entity.x - width / 2 &&
    x <= entity.x + width / 2 &&
    y >= entity.y - height / 2 &&
    y <= entity.y + height / 2
  );
}

/**
 * Units (category unit) within CLICK_PICK_RADIUS_TILES first (nearest, ties
 * lowest id); otherwise the lowest-id building, depot or ghost whose footprint
 * rectangle contains the point; otherwise null.
 */
export function pickEntity(
  entities: readonly EntityState[],
  x: number,
  y: number,
): number | null {
  let unitId: number | null = null;
  let unitDistance = Number.POSITIVE_INFINITY;
  let structureId: number | null = null;

  for (const entity of entities) {
    if (isUnit(entity)) {
      const distance = Math.hypot(entity.x - x, entity.y - y);
      if (distance > CLICK_PICK_RADIUS_TILES) continue;
      const closer = distance < unitDistance;
      const tiedLowerId =
        distance === unitDistance && unitId !== null && entity.id < unitId;
      if (closer || tiedLowerId) {
        unitId = entity.id;
        unitDistance = distance;
      }
      continue;
    }
    if (!containsPoint(entity, x, y)) continue;
    if (structureId === null || entity.id < structureId)
      structureId = entity.id;
  }

  return unitId === null ? structureId : unitId;
}

/** [id] if the picked entity is owned by player and not a ghost, else []. */
export function clickSelect(
  entities: readonly EntityState[],
  x: number,
  y: number,
  player: number,
): number[] {
  const id = pickEntity(entities, x, y);
  if (id === null) return [];
  const entity = entities.find((candidate) => candidate.id === id);
  if (entity === undefined) return [];
  if (entity.owner !== player) return [];
  if (hasFlag(entity, ENTITY_FLAGS.ghost)) return [];
  return [id];
}

/**
 * Ascending ids of units owned by player whose projected point is inside rect
 * (edges inclusive).
 */
export function boxSelect(
  entities: readonly EntityState[],
  rect: ScreenRect,
  project: (x: number, y: number) => ScreenPoint,
  player: number,
): number[] {
  const ids: number[] = [];
  for (const entity of entities) {
    if (entity.owner !== player) continue;
    if (!isUnit(entity)) continue;
    const point = project(entity.x, entity.y);
    if (
      point.x >= rect.minX &&
      point.x <= rect.maxX &&
      point.y >= rect.minY &&
      point.y <= rect.maxY
    ) {
      ids.push(entity.id);
    }
  }
  return ids.sort((a, b) => a - b);
}

/** Ascending ids of every unit owned by player. */
export function selectAllOwnUnits(
  entities: readonly EntityState[],
  player: number,
): number[] {
  const ids = new Set<number>();
  for (const entity of entities) {
    if (entity.owner !== player) continue;
    if (!isUnit(entity)) continue;
    ids.add(entity.id);
  }
  return [...ids].sort((a, b) => a - b);
}
