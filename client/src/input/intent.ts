import { typeDef } from "../rules";
import { toRaw } from "../sim/fixed";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  NEUTRAL,
} from "../sim/matchSnapshot";
import type { SimCommand } from "../sim/protocol";
import { ORDER_PICK_RADIUS_TILES, pickEntity } from "./entitySelection";

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

/** Enemy unit or building under (x, y), ignoring ghosts; null otherwise. */
function enemyAt(
  entities: readonly EntityState[],
  player: number,
  x: number,
  y: number,
): number | null {
  const picked = pickEntity(entities, x, y, ORDER_PICK_RADIUS_TILES);
  const entity = entities.find((candidate) => candidate.id === picked);
  if (entity === undefined || hasFlag(entity, ENTITY_FLAGS.ghost)) return null;
  const category = typeDef(entity.kind).category;
  if (category !== "unit" && category !== "building") return null;
  if (entity.owner === player || entity.owner === NEUTRAL) return null;
  return entity.id;
}

/**
 * Ctrl + click (left or right) at (x, y) tiles: the armed selected units of
 * `player` force-fire (spec 20). As in Zero Hour, the cursor pick decides:
 * an enemy unit or building under it is attacked, so moving targets are
 * followed; any other point gets an `AttackGround` order. Unarmed units and
 * buildings keep their order.
 */
export function resolveForceFire(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, x, y } = args;
  const armed = unitIds(
    ownSelected(selected, entities, player).filter(
      (entity) => typeDef(entity.kind).category === "unit" && isArmed(entity),
    ),
  );
  if (armed.length === 0) return [];
  const target = enemyAt(entities, player, x, y);
  if (target !== null) {
    return [{ kind: "attack", player, units: armed, target }];
  }
  return [
    {
      kind: "attackGround",
      player,
      units: armed,
      xRaw: toRaw(x),
      yRaw: toRaw(y),
    },
  ];
}

function isUnderConstruction(entity: EntityState): boolean {
  return hasFlag(entity, ENTITY_FLAGS.underConstruction);
}

/**
 * Commands for a left click at ground (x, y) tiles; xRaw/yRaw = toRaw. The
 * caller uses it only when the click is not on an own selectable entity: an
 * enemy unit or building under the cursor -> attack by the armed units only
 * (unarmed ones keep their order, spec 08 §3.7); a depot -> harvest for the
 * carriers and a move of the rest; an own incomplete building -> resume for
 * the builders and a move of the rest; otherwise a move of the units. A
 * selected building alone produces nothing: rally is the Rally button's job
 * (spec 08 §3.9 D2).
 */
export function resolveClickOrder(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, x, y } = args;
  const own = ownSelected(selected, entities, player);
  if (own.length === 0) return [];

  // A lone producer cannot move: a ground click sets its rally (owner
  // 2026-10-29, spec 08 §3.9 D2).
  const lone = own.length === 1 ? own[0] : undefined;
  if (lone !== undefined && typeDef(lone.kind).category !== "unit") {
    return resolveRally({ player, selected, entities, x, y });
  }

  const target = pickEntity(entities, x, y, ORDER_PICK_RADIUS_TILES);
  const hovered = entities.find((entity) => entity.id === target) ?? null;
  const cursor =
    hovered !== null && hasFlag(hovered, ENTITY_FLAGS.ghost) ? null : hovered;

  if (cursor !== null) {
    const type = typeDef(cursor.kind);
    if (
      (type.category === "unit" || type.category === "building") &&
      cursor.owner !== player &&
      cursor.owner !== NEUTRAL
    ) {
      const armed = unitIds(own.filter(isArmed));
      if (armed.length === 0) return [];
      return [{ kind: "attack", player, units: armed, target: cursor.id }];
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

/**
 * Commands for the Rally button's armed left click: exactly one own complete
 * producing building -> rally at (x, y); anything else -> []. A plain left
 * click on the ground never reaches this (spec 08 §3.9 D2).
 */
export function resolveRally(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, x, y } = args;
  const own = ownSelected(selected, entities, player);
  if (own.length !== 1) return [];
  const only = own[0];
  if (only === undefined) return [];
  const type = typeDef(only.kind);
  if (type.category !== "building" || type.produces.length === 0) return [];
  if (isUnderConstruction(only)) return [];
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
