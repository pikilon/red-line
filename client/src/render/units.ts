import type { InstancedMesh } from "three";
import type { UnitState } from "../sim/snapshot";

export const UNIT_COLOR = 0x3b82f6;
export const SELECTED_COLOR = 0xfacc15;

export interface UnitsRenderer {
  readonly mesh: InstancedMesh;
  update(units: readonly UnitState[], selected: ReadonlySet<number>): void;
}

export function createUnitsRenderer(_capacity: number): UnitsRenderer {
  throw new Error("not implemented");
}
