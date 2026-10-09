import ruleset from "@data/ruleset.json";
import { type MessageKey, t } from "./i18n";

export interface TypeDef {
  id: string;
  faction: number;
  category: "unit" | "building" | "depot";
  armor: number;
  hp: number;
  sightCenti: number;
  cost: number;
  buildTicks: number;
  speedCenti: number;
  weapon: number;
  requires: number[];
  produces: number[];
  builds: number[];
  footprint: [number, number];
  power: number;
  requiresPower: boolean;
  dropOff: boolean;
  capacity: number;
  loadTicks: number;
  unloadTicks: number;
  freeUnit: number;
  render: { size: [number, number, number] };
}

export interface FactionDef {
  id: string;
  hq: number;
  dozer: number;
} // other keys unused

export interface Ruleset {
  maxQueue: number;
  types: TypeDef[];
  factions: FactionDef[];
} // other keys unused

export const RULES: Ruleset = {
  maxQueue: ruleset.maxQueue,
  types: ruleset.types as unknown as TypeDef[],
  factions: ruleset.factions as FactionDef[],
};

// typeIndex(id): the index of a type by id, -1 if absent.
export function typeIndex(id: string): number {
  const index = RULES.types.findIndex((type) => type.id === id);
  return index < 0 ? -1 : index;
}

// typeDef(kind): the TypeDef at that index; throws RangeError out of range.
export function typeDef(kind: number): TypeDef {
  const type = RULES.types[kind];
  if (type === undefined) {
    throw new RangeError(`Unknown type index: ${kind}`);
  }
  return type;
}

// typeName(kind): t(`type.${id}`), the English name from i18n.
export function typeName(kind: number): string {
  return t(`type.${typeDef(kind).id}` as MessageKey);
}

// factionName(faction): t(`faction.${id}`).
export function factionName(faction: number): string {
  const factionDef = RULES.factions[faction];
  if (factionDef === undefined) {
    throw new RangeError(`Unknown faction index: ${faction}`);
  }
  return t(`faction.${factionDef.id}` as MessageKey);
}
