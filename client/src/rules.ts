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
  turnRateDeg: number;
  turretTurnRateDeg: number;
  /** Moving part of the model: `launcher` stows while driving, `blade` is a dozer blade. */
  articulation: "none" | "launcher" | "blade";
  /** Ticks a missile team needs to stow or set up its launcher, 0 otherwise. */
  stowTicks: number;
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
  /** Index into `Ruleset.locomotors`, -1 for types without one (spec 11 §4.1). */
  locomotor: number;
  /** Collision radius in centi-tiles; 0 uses the sim default. */
  radiusCenti?: number;
  /** Spec 40: damaged infantry heal inside this building. */
  healsInfantry?: boolean;
  /** Spec 39: this building repairs damaged vehicles. */
  repairsVehicles?: boolean;
  /** Spec 34: infantry can ride this vehicle. */
  transport?: {
    slots: number;
    fireFromInside?: boolean;
    damagePct: number;
    exitTicks: number;
  };
  /** Spec 43 §4.2: attacks by detonating `warhead` on arrival. */
  oneWay?: { warhead: number; fuelTicks?: number; armTiles?: number };
  /** Spec 43 §4.3: a flyer's clip and the ticks a reload takes. */
  sortie?: { clip: number; reloadTicks: number };
  /** Spec 43 §4.5: how the unit is steered; absent is unjammable. */
  link?: "radio" | "fibre" | "gnss" | "autonomous";
  /** Spec 43 §4.5: enemy radio and GNSS links fail inside this radius. */
  jammer?: { radiusCenti: number };
  gnssScatterCenti?: number;
  /** Spec 43 §4.1: an enemy weapon engages it only inside a third of its range. */
  lowObservable?: boolean;
  /** Spec 43 §4.1: a rotorcraft; every other flyer is fixed-wing and never stops. */
  hover?: boolean;
  /** Spec 43 §4.4: a launcher's drone charges and how they refill (radius 0: by itself). */
  charges?: { max: number; refillTicks: number; refillRadiusCenti: number };
  /** Spec 43 §4.4: launcher crews refill their charges next to this unit or building. */
  resupplies?: boolean;
  /** Spec 50 §3.1: experience worth per rank and the totals for each promotion. */
  experience?: { value: number[]; required?: number[] };
  render: { size: [number, number, number] };
}

export interface LocomotorDef {
  id: string;
  kind: "foot" | "tracks" | "wheels" | "air";
  /** Air only: which anti-air weapons reach it (spec 43 §4.1). */
  class?: "low" | "high";
  /** Air only: cruise height in centi-tiles. */
  altitudeCenti?: number;
  /** Air only: percent of top speed a fixed-wing flyer never drops below. */
  minSpeedPercent?: number;
  /** Air only: half-angle of the firing cone of a fixed-wing flyer, degrees. */
  noseConeDeg?: number;
  /** Zero Hour `CrusherLevel`: 1 crushes infantry (spec 28). */
  crusherLevel?: number;
  /** Damage dealt to an enemy soldier shoved aside (spec 28). */
  shoveDamage?: number;
}

export interface FactionDef {
  id: string;
  hq: number;
  dozer: number;
} // other keys unused

export interface Ruleset {
  maxQueue: number;
  sellRefundPercent: number;
  locomotors: LocomotorDef[];
  types: TypeDef[];
  factions: FactionDef[];
} // other keys unused

export const RULES: Ruleset = {
  maxQueue: ruleset.maxQueue,
  sellRefundPercent: ruleset.sellRefundPercent,
  locomotors: ruleset.locomotors as LocomotorDef[],
  types: ruleset.types as unknown as TypeDef[],
  factions: ruleset.factions as FactionDef[],
};

/** Visual block of a weapon (spec 17 §3.2); the simulation ignores it. */
export interface WeaponRender {
  model: string;
  flight: string;
  apexCenti: number;
  launch: string;
  trail: string;
}

export interface WeaponDef {
  id: string;
  damageType: number;
  damage: number;
  rangeCenti: number;
  minRangeCenti: number;
  cooldownTicks: number;
  splashCenti: number;
  projectileTicks: number;
  speedCenti: number;
  delivery: number;
  scatterCenti: number;
  salvo: number;
  salvoIntervalTicks: number;
  /** Spec 43 §4.1: which airborne units it reaches; absent is `none`. */
  antiAir?: "none" | "low" | "all";
  /** Spec 43 §4.1: absent is true. */
  antiGround?: boolean;
  /** Spec 43 §4.4: type index of the drone firing it launches. */
  launches?: number;
  render: WeaponRender;
}

/** Spec 17 §3.2 defaults for a weapon with no `render` block. */
const DEFAULT_WEAPON_RENDER: WeaponRender = {
  model: "tracer",
  flight: "straight",
  apexCenti: 0,
  launch: "muzzle",
  trail: "none",
};

// WEAPONS: every generated weapon with its `render` block resolved to §3.2.
export const WEAPONS: WeaponDef[] = ruleset.weapons.map((weapon) => ({
  ...weapon,
  render: { ...DEFAULT_WEAPON_RENDER, ...weapon.render },
})) as WeaponDef[];

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
