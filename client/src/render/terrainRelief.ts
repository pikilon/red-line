import { RULES, typeDef } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import type { PressSource } from "./terrainDeform";

/** How hard each locomotor presses on soft ground (spec 24 §3). */
const WEIGHT_BY_LOCOMOTOR = { foot: 0, wheels: 0.5, tracks: 1 } as const;

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
