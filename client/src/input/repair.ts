import { RULES, typeDef } from "../rules";
import type { FeatureRow } from "../sim/featureSnapshot";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import type { SimCommand } from "../sim/protocol";
import { ORDER_PICK_RADIUS_TILES, pickEntity } from "./entitySelection";

/** Spec 35: a repairable map feature (a bridge) and the cells it covers. */
export interface RepairJob {
  /** Row in the map's feature list: the index the sim uses in `repair`. */
  index: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** From the feature table: below full hit points or broken. */
  damaged?: boolean;
}

/** The parts of the ruleset feature types and map rows read here. */
export interface RepairTypeInfo {
  readonly family: string;
}
export interface RepairMapFeature {
  readonly type: number;
  readonly x: number;
  readonly y: number;
  readonly to?: readonly [number, number];
}

/** The bridges of a map, in the sim's row order. */
export function repairJobsOf(
  features: readonly RepairMapFeature[],
  types: readonly RepairTypeInfo[],
): RepairJob[] {
  const jobs: RepairJob[] = [];
  features.forEach((feature, index) => {
    if (types[feature.type]?.family !== "bridge") return;
    const [x1, y1] = feature.to ?? [feature.x, feature.y];
    jobs.push({ index, x0: feature.x, y0: feature.y, x1, y1 });
  });
  return jobs;
}

/** The jobs with their live damage from the feature table. */
export function withRepairState(
  jobs: readonly RepairJob[],
  rows: readonly FeatureRow[] | null,
): RepairJob[] {
  return jobs.map((job) => {
    const row = rows?.[job.index];
    return {
      ...job,
      damaged: row !== undefined && (!row.alive || row.hpPermille < 1000),
    };
  });
}

/** Dozers and free infantry: the units that work on a repair. */
export function isWorker(entity: EntityState): boolean {
  const def = typeDef(entity.kind);
  if (def.category !== "unit" || hasFlag(entity, ENTITY_FLAGS.inside))
    return false;
  return (
    def.builds.length > 0 || RULES.locomotors[def.locomotor]?.kind === "foot"
  );
}

/** Right click on a damaged bridge with workers selected: they repair it. */
export function resolveRepairClick(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  jobs: readonly RepairJob[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, jobs, x, y } = args;
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const job = jobs.find(
    (candidate) =>
      candidate.damaged === true &&
      cellX >= candidate.x0 &&
      cellX <= candidate.x1 &&
      cellY >= candidate.y0 &&
      cellY <= candidate.y1,
  );
  if (job === undefined) return [];
  const wanted = new Set(selected);
  const units = entities
    .filter(
      (entity) =>
        wanted.has(entity.id) && entity.owner === player && isWorker(entity),
    )
    .map((entity) => entity.id);
  if (units.length === 0) return [];
  return [{ kind: "repair", player, units, feature: job.index }];
}

/** A dozer, excluding passengers and hidden occupants (spec 38). */
export function isDozer(entity: EntityState): boolean {
  return (
    typeDef(entity.kind).category === "unit" &&
    typeDef(entity.kind).builds.length > 0 &&
    !hasFlag(entity, ENTITY_FLAGS.inside)
  );
}

/** Right click an own complete damaged building with dozers selected. */
export function resolveBuildingRepairClick(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, x, y } = args;
  const targetId = pickEntity(entities, x, y, ORDER_PICK_RADIUS_TILES);
  const target = entities.find((entity) => entity.id === targetId);
  if (target === undefined) return [];
  const def = typeDef(target.kind);
  if (
    target.owner !== player ||
    def.category !== "building" ||
    hasFlag(target, ENTITY_FLAGS.underConstruction) ||
    target.hp === 0 ||
    target.hp >= def.hp
  ) {
    return [];
  }
  const wanted = new Set(selected);
  const units = entities
    .filter(
      (entity) =>
        wanted.has(entity.id) && entity.owner === player && isDozer(entity),
    )
    .map((entity) => entity.id);
  if (units.length === 0) return [];
  return [{ kind: "repairBuilding", player, units, building: target.id }];
}

/** Damaged foot infantry free on the map, the patients a barracks takes (spec 40). */
export function isHealableInfantry(entity: EntityState): boolean {
  const def = typeDef(entity.kind);
  return (
    def.category === "unit" &&
    RULES.locomotors[def.locomotor]?.kind === "foot" &&
    entity.hp > 0 &&
    entity.hp < def.hp &&
    !hasFlag(entity, ENTITY_FLAGS.inside)
  );
}

/** Right click an own complete barracks with damaged infantry selected (spec 40). */
export function resolveInfirmaryClick(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, x, y } = args;
  const targetId = pickEntity(entities, x, y, ORDER_PICK_RADIUS_TILES);
  const target = entities.find((entity) => entity.id === targetId);
  if (target === undefined) return [];
  const targetDef = typeDef(target.kind);
  if (
    target.owner !== player ||
    targetDef.category !== "building" ||
    targetDef.healsInfantry !== true ||
    hasFlag(target, ENTITY_FLAGS.underConstruction) ||
    target.hp === 0
  ) {
    return [];
  }
  const wanted = new Set(selected);
  const units = entities
    .filter(
      (entity) =>
        wanted.has(entity.id) &&
        entity.owner === player &&
        isHealableInfantry(entity),
    )
    .map((entity) => entity.id);
  if (units.length === 0) return [];
  return [{ kind: "healAt", player, units, building: target.id }];
}

/** Ids of the selected own damaged vehicles that can dock for repair. */
function repairableVehicles(
  player: number,
  selected: readonly number[],
  entities: readonly EntityState[],
): EntityState[] {
  const wanted = new Set(selected);
  return entities.filter((entity) => {
    if (!wanted.has(entity.id) || entity.owner !== player) return false;
    const def = typeDef(entity.kind);
    return (
      def.category === "unit" &&
      RULES.locomotors[def.locomotor]?.kind !== "foot" &&
      entity.hp > 0 &&
      entity.hp < def.hp &&
      !hasFlag(entity, ENTITY_FLAGS.inside)
    );
  });
}

/** Spec 39: the Repair button. Sends the selected damaged vehicles to the own
 *  repair factory nearest the first one; empty when there is none. */
export function resolveRepairButton(
  player: number,
  selected: readonly number[],
  entities: readonly EntityState[],
): SimCommand[] {
  const vehicles = repairableVehicles(player, selected, entities);
  const first = vehicles[0];
  if (first === undefined) return [];
  let best: EntityState | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entity of entities) {
    const def = typeDef(entity.kind);
    if (
      entity.owner !== player ||
      def.category !== "building" ||
      def.repairsVehicles !== true ||
      hasFlag(entity, ENTITY_FLAGS.underConstruction)
    ) {
      continue;
    }
    const distance = (entity.x - first.x) ** 2 + (entity.y - first.y) ** 2;
    if (distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  if (best === undefined) return [];
  return [
    {
      kind: "repairVehicle",
      player,
      units: vehicles.map((entity) => entity.id),
      factory: best.id,
    },
  ];
}

/** True when the Repair button shows: a damaged vehicle is selected and an
 *  own repair factory stands. */
export function canRepairVehicles(
  player: number,
  selected: readonly EntityState[],
  entities: readonly EntityState[],
): boolean {
  return (
    resolveRepairButton(
      player,
      selected.map((entity) => entity.id),
      entities,
    ).length > 0
  );
}

/** Right click an own repair factory with damaged vehicles selected (spec 39). */
export function resolveVehicleRepairClick(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  x: number;
  y: number;
}): SimCommand[] {
  const { player, selected, entities, x, y } = args;
  const targetId = pickEntity(entities, x, y, ORDER_PICK_RADIUS_TILES);
  const target = entities.find((entity) => entity.id === targetId);
  if (target === undefined) return [];
  const targetDef = typeDef(target.kind);
  if (
    target.owner !== player ||
    targetDef.category !== "building" ||
    targetDef.repairsVehicles !== true ||
    hasFlag(target, ENTITY_FLAGS.underConstruction)
  ) {
    return [];
  }
  const wanted = new Set(selected);
  const units = entities
    .filter((entity) => {
      if (!wanted.has(entity.id) || entity.owner !== player) return false;
      const def = typeDef(entity.kind);
      return (
        def.category === "unit" &&
        RULES.locomotors[def.locomotor]?.kind !== "foot" &&
        entity.hp > 0 &&
        entity.hp < def.hp &&
        !hasFlag(entity, ENTITY_FLAGS.inside)
      );
    })
    .map((entity) => entity.id);
  if (units.length === 0) return [];
  return [{ kind: "repairVehicle", player, units, factory: target.id }];
}

/** Spec 35: the trench dig a click at `(x, y)` orders for the selected
 *  workers: the 2x1 trench centred on the click, turned when `turned`. */
export function resolveDigClick(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  x: number;
  y: number;
  turned: boolean;
}): SimCommand[] {
  const { player, selected, entities, x, y, turned } = args;
  const wanted = new Set(selected);
  const units = entities
    .filter(
      (entity) =>
        wanted.has(entity.id) && entity.owner === player && isWorker(entity),
    )
    .map((entity) => entity.id);
  if (units.length === 0) return [];
  const origin = turned
    ? { x: Math.floor(x), y: Math.floor(y - 0.5) }
    : { x: Math.floor(x - 0.5), y: Math.floor(y) };
  return [
    {
      kind: "dig",
      player,
      units,
      x: origin.x,
      y: origin.y,
      rot: turned ? 1 : 0,
    },
  ];
}

/** Spec 35 §5b: marks (1) the cells of a map where nothing can be dug: every
 *  road cell and every ground material listed in `hardGround` (ids of
 *  `layerNames.ground`, the earthwork type's `hardGround`). `ground` and
 *  `roads` are the map's hex layers, two digits per cell; a map without them
 *  has no hard cells. */
export function undiggableCells(
  map: { width: number; height: number; ground?: string; roads?: string },
  hardGround: readonly number[],
): Uint8Array {
  const cells = map.width * map.height;
  const hard = new Uint8Array(cells);
  const byteAt = (hex: string | undefined, i: number): number =>
    hex === undefined || hex.length !== cells * 2
      ? 0
      : Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  for (let i = 0; i < cells; i++) {
    if (
      byteAt(map.roads, i) !== 0 ||
      hardGround.includes(byteAt(map.ground, i))
    ) {
      hard[i] = 1;
    }
  }
  return hard;
}

/** One 2x1 trench of a line: top-left cell and turn (0 along x, 1 along y). */
export interface TrenchSegment {
  x: number;
  y: number;
  rot: number;
}

/** Spec 35 §5b.1: the trench segments along a line drawn from `from` to `to`
 *  (tile coordinates). The line runs along its longer axis, snapped to cells
 *  and cut into consecutive 2-cell trenches in drawing order. */
export function trenchLineSegments(
  from: { x: number; y: number },
  to: { x: number; y: number },
): TrenchSegment[] {
  const x0 = Math.floor(from.x);
  const y0 = Math.floor(from.y);
  const x1 = Math.floor(to.x);
  const y1 = Math.floor(to.y);
  const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const [a0, b0, a1, b1] = horizontal ? [x0, y0, x1, y1] : [y0, x0, y1, x1];
  const sign = a1 >= a0 ? 1 : -1;
  const cells = Math.abs(a1 - a0) + 1;
  const segments: TrenchSegment[] = [];
  for (let k = 0; k < cells; k += 2) {
    const first = a0 + sign * k;
    const second = k + 1 < cells ? first + sign : first;
    const along = Math.min(first, second);
    const across =
      cells === 1 ? b0 : Math.round(b0 + ((b1 - b0) * k) / (cells - 1));
    segments.push(
      horizontal
        ? { x: along, y: across, rot: 0 }
        : { x: across, y: along, rot: 1 },
    );
  }
  return segments;
}

/** Spec 35 §5b.1: the line dig ordered for the selected workers. */
export function resolveDigLine(args: {
  player: number;
  selected: readonly number[];
  entities: readonly EntityState[];
  from: { x: number; y: number };
  to: { x: number; y: number };
}): SimCommand[] {
  const { player, selected, entities, from, to } = args;
  const wanted = new Set(selected);
  const units = entities
    .filter(
      (entity) =>
        wanted.has(entity.id) && entity.owner === player && isWorker(entity),
    )
    .map((entity) => entity.id);
  if (units.length === 0) return [];
  return [
    {
      kind: "digLine",
      player,
      units,
      segments: trenchLineSegments(from, to).flatMap((s) => [s.x, s.y, s.rot]),
    },
  ];
}

/** True when the selection holds a worker of `player`: the Dig button shows. */
export function canDig(
  player: number,
  selected: readonly EntityState[],
): boolean {
  return selected.some((entity) => entity.owner === player && isWorker(entity));
}
