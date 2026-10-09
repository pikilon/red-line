import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
} from "three";
import type { UnitState } from "../sim/snapshot";

export const UNIT_COLOR = 0x3b82f6;
export const SELECTED_COLOR = 0xfacc15;

const UNIT_Y = 0.25;

export interface UnitsRenderer {
  readonly mesh: InstancedMesh;
  /** mesh.count = units.length; instance i at world (x, 0.25, y);
   *  instance colour SELECTED_COLOR if selected.has(id) else UNIT_COLOR. */
  update(units: readonly UnitState[], selected: ReadonlySet<number>): void;
}

/** BoxGeometry(0.4, 0.5, 0.4), MeshBasicMaterial; capacity instances. */
export function createUnitsRenderer(capacity: number): UnitsRenderer {
  const mesh = new InstancedMesh(
    new BoxGeometry(0.4, 0.5, 0.4),
    new MeshBasicMaterial(),
    capacity,
  );
  mesh.count = 0;
  // Instances move every frame; bounds computed at creation would cull them.
  mesh.frustumCulled = false;
  const matrix = new Matrix4();
  const unitColor = new Color(UNIT_COLOR);
  const selectedColor = new Color(SELECTED_COLOR);

  return {
    mesh,
    update(units, selected) {
      const count = Math.min(units.length, capacity);
      for (let i = 0; i < count; i++) {
        const unit = units[i] as UnitState;
        matrix.makeTranslation(unit.x, UNIT_Y, unit.y);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, selected.has(unit.id) ? selectedColor : unitColor);
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}
