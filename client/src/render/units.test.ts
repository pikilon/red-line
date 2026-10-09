import { Color, InstancedMesh, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { UnitState } from "../sim/snapshot";
import { createUnitsRenderer, SELECTED_COLOR, UNIT_COLOR } from "./units";

function expectInstanceColor(
  mesh: InstancedMesh,
  index: number,
  hex: number,
): void {
  const actual = new Color();
  mesh.getColorAt(index, actual);
  const expected = new Color(hex);
  expect(actual.r).toBeCloseTo(expected.r, 6);
  expect(actual.g).toBeCloseTo(expected.g, 6);
  expect(actual.b).toBeCloseTo(expected.b, 6);
}

describe("units renderer", () => {
  it("AC-02-37: renders units as instances", () => {
    const renderer = createUnitsRenderer(500);
    expect(renderer.mesh).toBeInstanceOf(InstancedMesh);
    expect(renderer.mesh.instanceMatrix.count).toBe(500);
    const units: UnitState[] = [
      { id: 0, x: 1.5, y: 2.5, moving: false },
      { id: 1, x: 3, y: 4, moving: true },
      { id: 2, x: 10.25, y: 7.75, moving: false },
    ];
    renderer.update(units, new Set([1]));
    expect(renderer.mesh.count).toBe(3);
    expectInstanceColor(renderer.mesh, 1, SELECTED_COLOR);
    expectInstanceColor(renderer.mesh, 0, UNIT_COLOR);
    const matrix = new Matrix4();
    renderer.mesh.getMatrixAt(2, matrix);
    const translation = new Vector3().setFromMatrixPosition(matrix);
    expect(translation.x).toBeCloseTo(10.25, 6);
    expect(translation.y).toBeCloseTo(0.25, 6);
    expect(translation.z).toBeCloseTo(7.75, 6);
  });
});
