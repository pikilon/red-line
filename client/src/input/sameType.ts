import { typeDef } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import type { ScreenPoint, ScreenRect } from "./selection";

/** Own selectable units: not a ghost and not riding inside a vehicle. */
function ownUnits(
  entities: readonly EntityState[],
  player: number,
): EntityState[] {
  return entities.filter(
    (entity) =>
      entity.owner === player &&
      typeDef(entity.kind).category === "unit" &&
      !hasFlag(entity, ENTITY_FLAGS.ghost) &&
      !hasFlag(entity, ENTITY_FLAGS.aboard),
  );
}

/** The distinct unit kinds among the selected ids, ascending. */
export function selectedUnitKinds(
  entities: readonly EntityState[],
  selected: ReadonlySet<number>,
): number[] {
  const kinds = new Set<number>();
  for (const entity of entities) {
    if (selected.has(entity.id) && typeDef(entity.kind).category === "unit")
      kinds.add(entity.kind);
  }
  return [...kinds].sort((a, b) => a - b);
}

/** Every own unit of the given kinds on the whole map (spec 41 A2), ascending. */
export function sameTypeEverywhere(
  entities: readonly EntityState[],
  kinds: readonly number[],
  player: number,
): number[] {
  const wanted = new Set(kinds);
  return ownUnits(entities, player)
    .filter((entity) => wanted.has(entity.kind))
    .map((entity) => entity.id)
    .sort((a, b) => a - b);
}

/**
 * Own units of the given kinds whose screen position lies inside `view`
 * (Zero Hour's double-click, spec 41 A3). With none on screen the whole map is
 * used, as the original does.
 */
export function sameTypeOnScreen(
  entities: readonly EntityState[],
  kinds: readonly number[],
  player: number,
  view: ScreenRect,
  project: (x: number, y: number) => ScreenPoint,
): number[] {
  const wanted = new Set(kinds);
  const visible = ownUnits(entities, player)
    .filter((entity) => {
      if (!wanted.has(entity.kind)) return false;
      const point = project(entity.x, entity.y);
      return (
        point.x >= view.minX &&
        point.x <= view.maxX &&
        point.y >= view.minY &&
        point.y <= view.maxY
      );
    })
    .map((entity) => entity.id)
    .sort((a, b) => a - b);
  return visible.length > 0
    ? visible
    : sameTypeEverywhere(entities, kinds, player);
}

/** The selected ids narrowed to the entities of `kind` (a strip chip tap). */
export function narrowToKind(
  entities: readonly EntityState[],
  selected: ReadonlySet<number>,
  kind: number,
): number[] {
  return entities
    .filter((entity) => selected.has(entity.id) && entity.kind === kind)
    .map((entity) => entity.id)
    .sort((a, b) => a - b);
}
