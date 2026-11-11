/**
 * Veterancy on the client (spec 50): the rank a snapshot row carries in its
 * flags and the hit points that rank gives, matching `World::max_hp`.
 */
import ruleset from "@data/ruleset.json";
import { type MessageKey, t } from "../i18n";
import { typeDef } from "../rules";
import type { EntityState } from "./matchSnapshot";

/** The rank sits in two bits of the entity flags from this shift. */
export const RANK_SHIFT = 9;
export const MAX_RANK = 3;

const NO_BONUS: readonly number[] = [100, 100, 100, 100];
const HEALTH_PERCENT: readonly number[] =
  (ruleset as { veterancy?: { healthPercent?: number[] } }).veterancy
    ?.healthPercent ?? NO_BONUS;

/** 0 regular, 1 veteran, 2 elite, 3 heroic. */
export function rankOf(entity: Pick<EntityState, "flags">): number {
  return (entity.flags >> RANK_SHIFT) & MAX_RANK;
}

/** Maximum hit points of a `kind` unit at `rank`, as the simulation counts them. */
export function maxHpAt(kind: number, rank: number): number {
  const percent = HEALTH_PERCENT[Math.min(MAX_RANK, Math.max(0, rank))] ?? 100;
  return Math.floor((typeDef(kind).hp * percent) / 100);
}

/** Maximum hit points of `entity` at its rank. */
export function maxHpOf(entity: Pick<EntityState, "kind" | "flags">): number {
  return maxHpAt(entity.kind, rankOf(entity));
}

const RANK_KEYS: readonly (MessageKey | null)[] = [
  null,
  "rank.veteran",
  "rank.elite",
  "rank.heroic",
];

/** "Leopard 2A4" for a regular unit, "Leopard 2A4 (Veteran)" for a promoted one. */
export function rankedName(name: string, rank: number): string {
  const key = RANK_KEYS[rank] ?? null;
  return key === null ? name : t("rank.label", { name, rank: t(key) });
}
