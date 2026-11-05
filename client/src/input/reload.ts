import { typeDef } from "../rules";
import {
  type AirState,
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
} from "../sim/matchSnapshot";
import type { SimCommand } from "../sim/protocol";

/** What the Reload button does for a selection (spec 43 §4.6). */
export interface ReloadPlan {
  /** Selected own units with rounds or charges missing: the button shows when
   *  there is one. */
  reloadable: number[];
  /** The command for those a base or supply source can service; null when
   *  there is none (the order is refused). */
  command: Extract<SimCommand, { kind: "reload" }> | null;
}

const NONE: ReloadPlan = { reloadable: [], command: null };

/** True for an own, standing, finished entity. */
function standing(entity: EntityState, player: number): boolean {
  return (
    entity.owner === player &&
    entity.hp > 0 &&
    !hasFlag(entity, ENTITY_FLAGS.underConstruction) &&
    !hasFlag(entity, ENTITY_FLAGS.ghost) &&
    !hasFlag(entity, ENTITY_FLAGS.inside)
  );
}

/**
 * Spec 43 §4.6: the selected units that can reload now and where they would
 * go. A sortie flyer with rounds missing needs an own building that lists its
 * type in `produces`; a launcher crew on foot with charges missing needs an own
 * unit or building that `resupplies`. A launcher with no refill radius (the
 * Sting nest) refills by itself and is a building, so it never counts.
 */
export function reloadPlan(args: {
  player: number;
  selected: ReadonlySet<number>;
  entities: readonly EntityState[];
  air: readonly AirState[];
}): ReloadPlan {
  const { player, selected, entities, air } = args;
  if (selected.size === 0 || air.length === 0) return NONE;
  const states = new Map(air.map((state) => [state.id, state]));
  const reloadable: number[] = [];
  const serviced: number[] = [];
  for (const entity of entities) {
    if (!selected.has(entity.id) || !standing(entity, player)) continue;
    const def = typeDef(entity.kind);
    const state = states.get(entity.id);
    if (def.category !== "unit" || state === undefined) continue;
    if (state.clip <= 0 || state.ammo >= state.clip) continue;
    const walks =
      def.charges !== undefined && def.charges.refillRadiusCenti > 0;
    if (def.sortie === undefined && !walks) continue;
    reloadable.push(entity.id);
    const found = entities.some((other) => {
      if (other.id === entity.id || !standing(other, player)) return false;
      const otherDef = typeDef(other.kind);
      return walks
        ? otherDef.resupplies === true
        : otherDef.category === "building" &&
            otherDef.produces.includes(entity.kind);
    });
    if (found) serviced.push(entity.id);
  }
  return {
    reloadable,
    command:
      serviced.length > 0 ? { kind: "reload", player, units: serviced } : null,
  };
}
