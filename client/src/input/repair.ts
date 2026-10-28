import { RULES, typeDef } from "../rules";
import type { FeatureRow } from "../sim/featureSnapshot";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import type { SimCommand } from "../sim/protocol";

/** Spec 33: a repairable map feature (a bridge) and the cells it covers. */
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
