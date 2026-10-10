import { typeDef } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";

/** Footprint centred on the cursor: { x: floor(gx - w / 2 + 0.5), y: floor(gy - h / 2 + 0.5) }. */
export function footprintOrigin(
  kind: number,
  gx: number,
  gy: number,
): { x: number; y: number } {
  const [width, height] = typeDef(kind).footprint;
  return {
    x: Math.floor(gx - width / 2 + 0.5),
    y: Math.floor(gy - height / 2 + 0.5),
  };
}

function footprintSize(kind: number): { width: number; height: number } {
  const [width, height] = typeDef(kind).footprint;
  return { width, height };
}

function isUnit(entity: EntityState): boolean {
  return typeDef(entity.kind).category === "unit";
}

/** Top-left origin of an entity's footprint, from its centre. */
function entityOrigin(entity: EntityState): { x: number; y: number } {
  const [width, height] = typeDef(entity.kind).footprint;
  return {
    x: Math.floor(entity.x - width / 2 + 0.5),
    y: Math.floor(entity.y - height / 2 + 0.5),
  };
}

function rectanglesOverlap(
  a: { x: number; y: number },
  aSize: { width: number; height: number },
  b: { x: number; y: number },
  bSize: { width: number; height: number },
): boolean {
  return (
    a.x < b.x + bSize.width &&
    b.x < a.x + aSize.width &&
    a.y < b.y + bSize.height &&
    b.y < a.y + aSize.height
  );
}

function cellInside(
  x: number,
  y: number,
  origin: { x: number; y: number },
  size: { width: number; height: number },
): boolean {
  return (
    x >= origin.x &&
    x < origin.x + size.width &&
    y >= origin.y &&
    y < origin.y + size.height
  );
}

/**
 * Client-side prediction of the sim's Construct check (credits and
 * prerequisites are handled by the command panel): in bounds, every tile
 * passable (tiles 0), no overlap with any building, depot or ghost footprint in
 * entities, no unit cell inside, every fog value >= 1.
 */
export function canPlace(args: {
  kind: number;
  origin: { x: number; y: number };
  width: number;
  height: number;
  tiles: Uint8Array;
  fog: Uint8Array;
  entities: readonly EntityState[];
}): boolean {
  const { kind, origin, width, height, tiles, fog, entities } = args;
  const size = footprintSize(kind);
  if (origin.x < 0 || origin.y < 0) return false;
  if (origin.x + size.width > width) return false;
  if (origin.y + size.height > height) return false;

  for (let dy = 0; dy < size.height; dy++) {
    for (let dx = 0; dx < size.width; dx++) {
      const cell = (origin.y + dy) * width + (origin.x + dx);
      if ((tiles[cell] ?? 1) !== 0) return false;
      if ((fog[cell] ?? 0) < 1) return false;
    }
  }

  for (const entity of entities) {
    if (isUnit(entity)) {
      const unitCell = { x: Math.floor(entity.x), y: Math.floor(entity.y) };
      if (cellInside(unitCell.x, unitCell.y, origin, size)) return false;
      continue;
    }
    // Buildings, depots and ghosts all block their footprint.
    if (
      rectanglesOverlap(
        origin,
        size,
        entityOrigin(entity),
        footprintSize(entity.kind),
      )
    ) {
      return false;
    }
  }

  return true;
}
