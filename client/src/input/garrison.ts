import { RULES, typeDef } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import type { SimCommand } from "../sim/protocol";

/** Longest walk, in tiles, from the selection to the building the Garrison button picks. */
export const GARRISON_BUTTON_REACH_TILES = 14;

/** A garrisonable map feature (spec 31 block 2): its row in the map's feature
 *  list is the index the sim uses in `garrison` and `unload`. */
export interface GarrisonFeature {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  slots: number;
}

/** The parts of the ruleset feature types read here. */
export interface GarrisonTypeInfo {
  readonly footprint: readonly [number, number];
  readonly garrison?: { readonly slots: number };
}

/** The parts of a map feature row read here. */
export interface GarrisonMapFeature {
  readonly type: number;
  readonly x: number;
  readonly y: number;
  readonly rot: number;
}

/** The garrisonable features of a map, in the sim's row order. */
export function garrisonFeaturesOf(
  features: readonly GarrisonMapFeature[],
  types: readonly GarrisonTypeInfo[],
): GarrisonFeature[] {
  const found: GarrisonFeature[] = [];
  features.forEach((feature, index) => {
    const info = types[feature.type];
    if (info?.garrison === undefined) return;
    const swap = feature.rot % 2 === 1;
    found.push({
      index,
      x: feature.x,
      y: feature.y,
      width: swap ? info.footprint[1] : info.footprint[0],
      height: swap ? info.footprint[0] : info.footprint[1],
      slots: info.garrison.slots,
    });
  });
  return found;
}

/** The feature whose footprint covers the point (tiles). */
export function featureUnder(
  features: readonly GarrisonFeature[],
  x: number,
  y: number,
): GarrisonFeature | null {
  return (
    features.find(
      (feature) =>
        x >= feature.x &&
        x < feature.x + feature.width &&
        y >= feature.y &&
        y < feature.y + feature.height,
    ) ?? null
  );
}

function isInside(entity: EntityState): boolean {
  return hasFlag(entity, ENTITY_FLAGS.inside);
}

/** Free infantry: a unit on a foot locomotor that is not in a building. */
export function isFreeInfantry(entity: EntityState): boolean {
  const def = typeDef(entity.kind);
  return (
    def.category === "unit" &&
    !isInside(entity) &&
    RULES.locomotors[def.locomotor]?.kind === "foot"
  );
}

/** Garrisoned units standing in `feature`'s footprint (they sit at its centre). */
export function occupantsOf(
  feature: GarrisonFeature,
  entities: readonly EntityState[],
): EntityState[] {
  return entities.filter(
    (entity) =>
      isInside(entity) && featureUnder([feature], entity.x, entity.y) !== null,
  );
}

/** True when `player`'s infantry could join `feature`: room left, and empty or
 *  held by the same player (the sim decides authoritatively). */
function hasRoomFor(
  feature: GarrisonFeature,
  entities: readonly EntityState[],
  player: number,
): boolean {
  const inside = occupantsOf(feature, entities);
  if (inside.length >= feature.slots) return false;
  return inside.every((entity) => entity.owner === player);
}

function ownSelected(
  selected: readonly number[],
  entities: readonly EntityState[],
  player: number,
): EntityState[] {
  const chosen = new Set(selected);
  return entities.filter(
    (entity) => chosen.has(entity.id) && entity.owner === player,
  );
}

/** What the command panel offers for the current selection. */
export interface GarrisonOffers {
  /** Feature the Garrison button sends the selected infantry to. */
  garrison: number | null;
  /** Garrisoned feature the Evacuate button empties. */
  evacuate: number | null;
}

/** Garrison: free infantry selected and a valid building within reach (the
 *  nearest to the group). Evacuate: selected units that are garrisoned. */
export function garrisonOffers(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  features: readonly GarrisonFeature[];
}): GarrisonOffers {
  const { player, selected, entities, features } = args;
  const own = ownSelected(selected, entities, player);
  let evacuate: number | null = null;
  const garrisoned = own.find(isInside);
  if (garrisoned !== undefined) {
    evacuate =
      featureUnder(features, garrisoned.x, garrisoned.y)?.index ?? null;
  }
  const infantry = own.filter(isFreeInfantry);
  if (infantry.length === 0 || features.length === 0) {
    return { garrison: null, evacuate };
  }
  const cx =
    infantry.reduce((sum, entity) => sum + entity.x, 0) / infantry.length;
  const cy =
    infantry.reduce((sum, entity) => sum + entity.y, 0) / infantry.length;
  let best: { index: number; distance: number } | null = null;
  for (const feature of features) {
    if (!hasRoomFor(feature, entities, player)) continue;
    const distance = Math.hypot(
      feature.x + feature.width / 2 - cx,
      feature.y + feature.height / 2 - cy,
    );
    if (distance > GARRISON_BUTTON_REACH_TILES) continue;
    if (best === null || distance < best.distance) {
      best = { index: feature.index, distance };
    }
  }
  return { garrison: best?.index ?? null, evacuate };
}

/** The `garrison` command for the free infantry of the selection toward `feature`. */
export function garrisonCommand(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  feature: number;
}): SimCommand[] {
  const { player, selected, entities, feature } = args;
  const units = ownSelected(selected, entities, player)
    .filter(isFreeInfantry)
    .map((entity) => entity.id)
    .sort((a, b) => a - b);
  return units.length === 0
    ? []
    : [{ kind: "garrison", player, units, feature }];
}

/** Right click at (x, y) tiles: the selected infantry enter the garrisonable
 *  building under the cursor, as in Zero Hour. Empty when nothing applies. */
export function resolveGarrisonClick(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  features: readonly GarrisonFeature[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, features, x, y } = args;
  const feature = featureUnder(features, x, y);
  if (feature === null || !hasRoomFor(feature, entities, player)) return [];
  return garrisonCommand({
    player,
    selected,
    entities,
    feature: feature.index,
  });
}

/** Left click on an own garrisoned building selects its occupants, so the
 *  Evacuate button appears. Empty for any other point. */
export function selectOccupantsAt(args: {
  player: number;
  entities: readonly EntityState[];
  features: readonly GarrisonFeature[];
  x: number;
  y: number;
}): number[] {
  const { player, entities, features, x, y } = args;
  const feature = featureUnder(features, x, y);
  if (feature === null) return [];
  return occupantsOf(feature, entities)
    .filter((entity) => entity.owner === player)
    .map((entity) => entity.id)
    .sort((a, b) => a - b);
}
