/** Control groups 1-9 and 0 (spec 41 §3.2). Pure logic: no DOM, no camera. */
import type { EntityState } from "../sim/matchSnapshot";

/** Group digits in display order: 1..9 then 0. */
export const GROUP_DIGITS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/** Two taps on the same slot within this window centre the camera. */
export const DOUBLE_TAP_MS = 400;

export interface ControlGroups {
  /** Replaces the group with `ids`; an empty list clears it. */
  set(digit: number, ids: Iterable<number>): void;
  /** Adds `ids` to the group. */
  add(digit: number, ids: Iterable<number>): void;
  /** The group's ids, ascending. */
  get(digit: number): number[];
  /** Drops ids that are not in `alive`; true when anything changed. */
  prune(alive: ReadonlySet<number>): boolean;
  /** What a tap or key press on `digit` at `nowMs` does: the second press on
   *  the same slot within DOUBLE_TAP_MS centres, any other selects. */
  press(digit: number, nowMs: number): "select" | "centre";
}

export function createControlGroups(): ControlGroups {
  const groups = new Map<number, Set<number>>();
  let last: { digit: number; atMs: number } | null = null;
  return {
    set(digit, ids) {
      const next = new Set(ids);
      if (next.size === 0) groups.delete(digit);
      else groups.set(digit, next);
    },
    add(digit, ids) {
      const next = groups.get(digit) ?? new Set<number>();
      for (const id of ids) next.add(id);
      if (next.size > 0) groups.set(digit, next);
    },
    get(digit) {
      return [...(groups.get(digit) ?? [])].sort((a, b) => a - b);
    },
    prune(alive) {
      let changed = false;
      for (const [digit, ids] of groups) {
        for (const id of [...ids]) {
          if (alive.has(id)) continue;
          ids.delete(id);
          changed = true;
        }
        if (ids.size === 0) groups.delete(digit);
      }
      return changed;
    },
    press(digit, nowMs) {
      const double =
        last !== null &&
        last.digit === digit &&
        nowMs - last.atMs <= DOUBLE_TAP_MS;
      // A centring press ends the pair, so a third tap selects again.
      last = double ? null : { digit, atMs: nowMs };
      return double ? "centre" : "select";
    },
  };
}

/** The digit a key event names (`Digit0..9`, `Numpad0..9`), else null. */
export function digitOfKey(code: string): number | null {
  const match = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  return match === null ? null : Number(match[1]);
}

/** The kind that most ids have; ties go to the lowest kind. Null when empty. */
export function dominantKind(
  ids: readonly number[],
  entities: readonly EntityState[],
): number | null {
  const wanted = new Set(ids);
  const counts = new Map<number, number>();
  for (const entity of entities) {
    if (wanted.has(entity.id)) {
      counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1);
    }
  }
  let best: number | null = null;
  for (const [kind, count] of counts) {
    const bestCount = best === null ? 0 : (counts.get(best) ?? 0);
    if (
      count > bestCount ||
      (count === bestCount && best !== null && kind < best)
    ) {
      best = kind;
    }
  }
  return best;
}

/** Mean position of the ids' entities, or null when none exists. */
export function centreOf(
  ids: readonly number[],
  entities: readonly EntityState[],
): { x: number; y: number } | null {
  const wanted = new Set(ids);
  let x = 0;
  let y = 0;
  let n = 0;
  for (const entity of entities) {
    if (!wanted.has(entity.id)) continue;
    x += entity.x;
    y += entity.y;
    n++;
  }
  return n === 0 ? null : { x: x / n, y: y / n };
}

/** The next building of a kind after `currentId` in ascending id order,
 *  wrapping; used by the structure shortcuts to cycle (spec 41 §3.2). */
export function nextInCycle(
  ids: readonly number[],
  currentId: number | null,
): number | null {
  if (ids.length === 0) return null;
  const sorted = [...ids].sort((a, b) => a - b);
  if (currentId === null) return sorted[0] ?? null;
  return sorted.find((id) => id > currentId) ?? sorted[0] ?? null;
}
