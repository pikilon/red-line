import { fromRaw } from "./fixed";
import { FLAG_MOVING, SNAPSHOT_HEADER_LEN, UNIT_STRIDE } from "./protocol";

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

export function decodeSnapshot(data: Int32Array): Snapshot {
  const count = data[1] ?? 0;
  const units: UnitState[] = [];
  for (let i = 0; i < count; i++) {
    const base = SNAPSHOT_HEADER_LEN + i * UNIT_STRIDE;
    units.push({
      id: data[base] ?? 0,
      x: fromRaw(data[base + 1] ?? 0),
      y: fromRaw(data[base + 2] ?? 0),
      moving: ((data[base + 3] ?? 0) & FLAG_MOVING) !== 0,
    });
  }
  return { tick: data[0] ?? 0, units };
}

/** alpha clamped to [0, 1]; units matched by id at the same index in `prev`. */
export function interpolateUnits(
  prev: Snapshot,
  next: Snapshot,
  alpha: number,
): UnitState[] {
  const t = Math.min(1, Math.max(0, alpha));
  return next.units.map((unit, index) => {
    const before = prev.units[index];
    if (before === undefined || before.id !== unit.id) {
      return { ...unit };
    }
    return {
      id: unit.id,
      x: before.x + (unit.x - before.x) * t,
      y: before.y + (unit.y - before.y) * t,
      moving: unit.moving,
    };
  });
}
