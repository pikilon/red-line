/** Feature table of the snapshot (spec 31): the runtime state of the map
 *  features, in map order. Mirrors `encode_features` in `crates/sim`. */

/** Ints per feature record: index, kind, state, flags, hit points permille,
 *  garrison owner, occupant count. */
export const FEATURE_STRIDE = 7;
/** Garrison owner of an empty building (the sim's `NEUTRAL`). */
export const FEATURE_NO_OWNER = 255;
export const FEATURE_ALIVE = 1;
export const FEATURE_BURNING = 2;
export const FEATURE_COLLAPSING = 4;

export interface FeatureRow {
  /** Row in map order; stable for the whole match. */
  readonly index: number;
  /** Index into the ruleset `featureTypes`; changes when a feature is
   *  destroyed into another type (tree to stump, building to rubble). */
  readonly kind: number;
  /** 0 intact, 1 damaged, 2 wrecked, 3 abandoned. */
  readonly state: number;
  readonly alive: boolean;
  readonly burning: boolean;
  /** A building at zero hit points that is about to turn into rubble. */
  readonly collapsing: boolean;
  /** Hit points in 1/1000 of the type's maximum. */
  readonly hpPermille: number;
  /** Spec 31 block 2: player holding the building, `FEATURE_NO_OWNER` when empty. */
  readonly owner: number;
  /** Spec 31 block 2: infantry inside. */
  readonly occupants: number;
}

/** Decodes a `features_for` `Int32Array`; an empty array means "unchanged"
 *  and decodes to `null`. */
export function decodeFeatures(data: Int32Array): FeatureRow[] | null {
  if (data.length === 0) return null;
  const count = data[0] ?? 0;
  const rows: FeatureRow[] = [];
  for (let i = 0; i < count; i++) {
    const base = 1 + i * FEATURE_STRIDE;
    const flags = data[base + 3] ?? 0;
    rows.push({
      index: data[base] ?? 0,
      kind: data[base + 1] ?? 0,
      state: data[base + 2] ?? 0,
      alive: (flags & FEATURE_ALIVE) !== 0,
      burning: (flags & FEATURE_BURNING) !== 0,
      collapsing: (flags & FEATURE_COLLAPSING) !== 0,
      hpPermille: data[base + 4] ?? 0,
      owner: data[base + 5] ?? FEATURE_NO_OWNER,
      occupants: data[base + 6] ?? 0,
    });
  }
  return rows;
}
