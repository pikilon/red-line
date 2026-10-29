import { RULES, typeDef } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import type { SimCommand } from "../sim/protocol";
import { ORDER_PICK_RADIUS_TILES } from "./entitySelection";

/** Spec 34: slots of a vehicle type that carries infantry, 0 otherwise. */
export function transportSlots(kind: number): number {
  return typeDef(kind).transport?.slots ?? 0;
}

/** True when the unit rides a vehicle (hidden, moves with it). */
export function isAboard(entity: EntityState): boolean {
  return hasFlag(entity, ENTITY_FLAGS.aboard);
}

/** The riders of vehicle `carrier`: aboard rows keep its id in `progress`. */
export function ridersOf(
  carrier: number,
  entities: readonly EntityState[],
): EntityState[] {
  return entities.filter(
    (entity) => isAboard(entity) && entity.progress === carrier,
  );
}

/** Infantry on foot, free on the map (not in a building or a vehicle). */
function isFreeFootUnit(entity: EntityState): boolean {
  const def = typeDef(entity.kind);
  return (
    def.category === "unit" &&
    !hasFlag(entity, ENTITY_FLAGS.inside) &&
    RULES.locomotors[def.locomotor]?.kind === "foot"
  );
}

/** Right click with infantry selected on an own transport under the cursor:
 *  the infantry board it (the sim checks the free slots). Otherwise []. */
export function resolveBoardClick(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, x, y } = args;
  let carrier: EntityState | null = null;
  let best = ORDER_PICK_RADIUS_TILES;
  for (const entity of entities) {
    if (entity.owner !== player || isAboard(entity)) continue;
    if (transportSlots(entity.kind) === 0) continue;
    const distance = Math.hypot(entity.x - x, entity.y - y);
    if (distance <= best) {
      best = distance;
      carrier = entity;
    }
  }
  if (carrier === null) return [];
  const wanted = new Set(selected);
  const units = entities
    .filter(
      (entity) =>
        wanted.has(entity.id) &&
        entity.owner === player &&
        isFreeFootUnit(entity),
    )
    .map((entity) => entity.id);
  if (units.length === 0) return [];
  return [{ kind: "board", player, units, carrier: carrier.id }];
}

/** The first selected own transport with riders, with how many it carries,
 *  for the Unload button; null when there is none. */
export function disembarkOffer(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
}): { carrier: number; riders: number } | null {
  const wanted = new Set(args.selected);
  for (const entity of args.entities) {
    if (!wanted.has(entity.id) || entity.owner !== args.player) continue;
    if (transportSlots(entity.kind) === 0) continue;
    const riders = ridersOf(entity.id, args.entities).length;
    if (riders > 0) return { carrier: entity.id, riders };
  }
  return null;
}
