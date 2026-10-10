import { typeDef } from "../rules";
import { toRaw } from "../sim/fixed";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  NEUTRAL,
} from "../sim/matchSnapshot";
import type { SimCommand } from "../sim/protocol";
import { pickEntity } from "./entitySelection";

/** Selected entities owned by player, ascending id; missing ids are dropped. */
function ownSelected(
  selected: readonly number[],
  entities: readonly EntityState[],
  player: number,
): EntityState[] {
  const own = entities.filter(
    (entity) => entity.owner === player && selected.includes(entity.id),
  );
  return own.sort((a, b) => a.id - b.id);
}

function unitIds(entities: readonly EntityState[]): number[] {
  return entities
    .filter((entity) => typeDef(entity.kind).category === "unit")
    .map((entity) => entity.id)
    .sort((a, b) => a - b);
}

function canBuild(entity: EntityState): boolean {
  return typeDef(entity.kind).builds.length > 0;
}

function hasCargoCapacity(entity: EntityState): boolean {
  return typeDef(entity.kind).capacity > 0;
}

function isArmed(entity: EntityState): boolean {
  return typeDef(entity.kind).weapon >= 0;
}

function moveCommand(
  player: number,
  units: readonly number[],
  x: number,
  y: number,
): SimCommand[] {
  if (units.length === 0) return [];
  return [
    { kind: "move", player, units: [...units], xRaw: toRaw(x), yRaw: toRaw(y) },
  ];
}

function isUnderConstruction(entity: EntityState): boolean {
  return hasFlag(entity, ENTITY_FLAGS.underConstruction);
}

/**
 * Commands for a right click at ground (x, y) tiles; xRaw/yRaw = toRaw.
 * Rules, in order (selected ids not owned by `player` or missing are dropped
 * first): empty selection -> []; a single building -> [rally] when its type
 * produces, else []; units (ascending) -> the special command for the entity
 * under the cursor (attack, harvest or resume) followed by a move of the rest.
 */
export function resolveRightClick(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, x, y } = args;
  const own = ownSelected(selected, entities, player);
  if (own.length === 0) return [];

  if (own.length === 1) {
    const only = own[0];
    if (only === undefined) return [];
    const type = typeDef(only.kind);
    if (type.category !== "unit") {
      if (type.category !== "building" || type.produces.length === 0) return [];
      return [
        {
          kind: "rally",
          player,
          building: only.id,
          xRaw: toRaw(x),
          yRaw: toRaw(y),
        },
      ];
    }
  }

  const target = pickEntity(entities, x, y);
  const hovered = entities.find((entity) => entity.id === target) ?? null;
  const cursor =
    hovered !== null && hasFlag(hovered, ENTITY_FLAGS.ghost) ? null : hovered;

  if (cursor !== null) {
    const type = typeDef(cursor.kind);
    if (
      type.category === "unit" &&
      cursor.owner !== player &&
      cursor.owner !== NEUTRAL
    ) {
      const armed = own.filter(isArmed);
      const rest = own.filter((entity) => !isArmed(entity));
      const first: SimCommand[] =
        armed.length === 0
          ? []
          : [
              {
                kind: "attack",
                player,
                units: unitIds(armed),
                target: cursor.id,
              },
            ];
      return [...first, ...moveCommand(player, unitIds(rest), x, y)];
    }
    if (type.category === "depot") {
      const carriers = own.filter(hasCargoCapacity);
      const rest = own.filter((entity) => !hasCargoCapacity(entity));
      const first: SimCommand[] =
        carriers.length === 0
          ? []
          : [
              {
                kind: "harvest",
                player,
                units: unitIds(carriers),
                depot: cursor.id,
              },
            ];
      return [...first, ...moveCommand(player, unitIds(rest), x, y)];
    }
    if (
      type.category === "building" &&
      cursor.owner === player &&
      isUnderConstruction(cursor)
    ) {
      const builders = own.filter(canBuild);
      const rest = own.filter((entity) => !canBuild(entity));
      const first: SimCommand[] =
        builders.length === 0
          ? []
          : [
              {
                kind: "resume",
                player,
                units: unitIds(builders),
                building: cursor.id,
              },
            ];
      return [...first, ...moveCommand(player, unitIds(rest), x, y)];
    }
  }

  return moveCommand(player, unitIds(own), x, y);
}
