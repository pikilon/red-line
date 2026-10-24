import { RULES, typeDef } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import type { PressSource } from "./terrainDeform";

/** How hard each locomotor presses on soft ground (spec 22 §3). */
const WEIGHT_BY_LOCOMOTOR = { foot: 0, wheels: 0.5, tracks: 1 } as const;

/** Tiles of crater radius per tile of explosion size, and its floor. */
const CRATER_RADIUS_PER_SIZE = 0.9;
const CRATER_MIN_RADIUS = 1.2;
const CRATER_MAX_RADIUS = 3.5;
/** Tiles of crater depth per tile of crater radius. */
const CRATER_DEPTH_PER_RADIUS = 0.18;
/** Explosions under this size (tiles) leave the ground alone. */
export const MIN_CRATER_SIZE = 0.5;

/** The vehicles of `entities` that weigh on the ground. */
export function pressSourcesOf(
  entities: readonly EntityState[],
): PressSource[] {
  const sources: PressSource[] = [];
  for (const entity of entities) {
    const locomotor = typeDef(entity.kind).locomotor;
    const kind = RULES.locomotors[locomotor]?.kind;
    if (kind === undefined) continue;
    const weight = WEIGHT_BY_LOCOMOTOR[kind];
    if (weight > 0) {
      sources.push({ id: entity.id, x: entity.x, y: entity.y, weight });
    }
  }
  return sources;
}

/** Radius and depth, in tiles, of the crater a blast of `size` tiles digs. */
export function craterFor(size: number): { radius: number; depth: number } {
  const radius = Math.min(
    CRATER_MAX_RADIUS,
    Math.max(CRATER_MIN_RADIUS, size * CRATER_RADIUS_PER_SIZE),
  );
  return { radius, depth: radius * CRATER_DEPTH_PER_RADIUS };
}
