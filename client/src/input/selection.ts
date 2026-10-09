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

export function pickUnit(
  _units: readonly UnitState[],
  _groundX: number,
  _groundY: number,
): number | null {
  return null;
}

export function rectFromDrag(a: ScreenPoint, _b: ScreenPoint): ScreenRect {
  return { minX: a.x, minY: a.y, maxX: a.x, maxY: a.y };
}

export function unitsInRect(
  _units: readonly UnitState[],
  _rect: ScreenRect,
  _project: (x: number, y: number) => ScreenPoint,
): number[] {
  return [];
}

export function isDrag(_a: ScreenPoint, _b: ScreenPoint): boolean {
  return false;
}
