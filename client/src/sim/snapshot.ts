export interface UnitState {
  id: number;
  x: number;
  y: number;
  moving: boolean;
}

export interface Snapshot {
  tick: number;
  units: UnitState[];
}

export function decodeSnapshot(_data: Int32Array): Snapshot {
  return { tick: 0, units: [] };
}

export function interpolateUnits(
  _prev: Snapshot,
  _next: Snapshot,
  _alpha: number,
): UnitState[] {
  return [];
}
