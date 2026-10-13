/** Spec 14: every building and unit of both sides, in formation. */
export interface ShowcaseSpawn {
  player: number;
  typeIndex: number;
  /** Tiles; buildings use the origin cell, units the centre of the cell. */
  x: number;
  y: number;
}

export interface ShowcaseType {
  readonly faction: number;
  readonly category: "unit" | "building" | "depot";
}

export interface ShowcaseRules {
  readonly types: readonly ShowcaseType[];
  readonly factions: readonly { readonly hq: number; readonly dozer: number }[];
}

export interface ShowcaseMap {
  readonly starts: readonly {
    readonly faction: number;
    readonly hq: readonly number[];
  }[];
}

const BUILDING_PITCH = 5;
const UNIT_PITCH = 4;
const UNITS_PER_ROW = 4;
const UNIT_ROWS_Y = [16.5, 20.5] as const;
const UNIT_X_OFFSET = 3.5;

/** Every building and unit type of each player's faction, in ruleset order,
 *  except the HQ and the dozer that the map start already provides. */
export function showcasePlan(
  rules: ShowcaseRules,
  map: ShowcaseMap,
): ShowcaseSpawn[] {
  const plan: ShowcaseSpawn[] = [];
  map.starts.forEach((start, player) => {
    const faction = rules.factions[start.faction];
    const x0 = start.hq[0] ?? 0;
    const y0 = start.hq[1] ?? 0;
    let building = 0;
    let unit = 0;
    rules.types.forEach((type, typeIndex) => {
      if (type.faction !== start.faction) return;
      if (type.category === "building") {
        const slot = building++;
        if (typeIndex === faction?.hq) return;
        plan.push({
          player,
          typeIndex,
          x: x0 + BUILDING_PITCH * slot,
          y: y0,
        });
      } else if (type.category === "unit") {
        const slot = unit++;
        if (typeIndex === faction?.dozer) return;
        plan.push({
          player,
          typeIndex,
          x: x0 + UNIT_X_OFFSET + UNIT_PITCH * (slot % UNITS_PER_ROW),
          y: UNIT_ROWS_Y[Math.floor(slot / UNITS_PER_ROW)] ?? 0,
        });
      }
    });
  });
  return plan;
}
