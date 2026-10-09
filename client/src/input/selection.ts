import type { UnitState } from "../sim/snapshot";

export interface ScreenPoint {
  x: number;
  y: number;
}
export interface ScreenRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export const CLICK_PICK_RADIUS_TILES = 0.5;
export const DRAG_THRESHOLD_PX = 4;

/** Nearest unit within CLICK_PICK_RADIUS_TILES of the point; ties go to the lowest id. */
export function pickUnit(
  units: readonly UnitState[],
  groundX: number,
  groundY: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const unit of units) {
    const distance = Math.hypot(unit.x - groundX, unit.y - groundY);
    if (distance > CLICK_PICK_RADIUS_TILES) continue;
    const closer = distance < bestDistance;
    const tiedLowerId =
      distance === bestDistance && best !== null && unit.id < best;
    if (closer || tiedLowerId) {
      best = unit.id;
      bestDistance = distance;
    }
  }
  return best;
}

export function rectFromDrag(a: ScreenPoint, b: ScreenPoint): ScreenRect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** Ids (ascending) whose projected point lies inside rect, edges inclusive. */
export function unitsInRect(
  units: readonly UnitState[],
  rect: ScreenRect,
  project: (x: number, y: number) => ScreenPoint,
): number[] {
  const ids: number[] = [];
  for (const unit of units) {
    const p = project(unit.x, unit.y);
    if (
      p.x >= rect.minX &&
      p.x <= rect.maxX &&
      p.y >= rect.minY &&
      p.y <= rect.maxY
    ) {
      ids.push(unit.id);
    }
  }
  return ids.sort((a, b) => a - b);
}

export function isDrag(a: ScreenPoint, b: ScreenPoint): boolean {
  return Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) > DRAG_THRESHOLD_PX;
}

/** Every unit id, ascending (AC-02-45). */
export function selectAll(_units: readonly UnitState[]): number[] {
  return [];
}

/** code === "KeyA" && (ctrlKey || metaKey); physical key, like PAN_KEYS. */
export function isSelectAllShortcut(
  _event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey">,
): boolean {
  return false;
}
