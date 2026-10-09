import { Color, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { BLOCKED_COLOR, createTerrain, PASSABLE_COLOR } from "./terrain";

function expectVertexColor(mesh: Mesh, vertex: number, hex: number): void {
  const color = mesh.geometry.getAttribute("color");
  const expected = new Color(hex);
  expect(color.getX(vertex)).toBeCloseTo(expected.r, 6);
  expect(color.getY(vertex)).toBeCloseTo(expected.g, 6);
  expect(color.getZ(vertex)).toBeCloseTo(expected.b, 6);
}

describe("terrain renderer", () => {
  it("AC-02-36: builds one terrain mesh with tile colours", () => {
    const mesh = createTerrain(3, 2, new Uint8Array([0, 1, 0, 0, 0, 0]));
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.geometry.getAttribute("position").count).toBe(24);
    expect(mesh.geometry.getIndex()?.count).toBe(36);
    for (let vertex = 0; vertex < 4; vertex++) {
      expectVertexColor(mesh, vertex, PASSABLE_COLOR);
    }
    for (let vertex = 4; vertex < 8; vertex++) {
      expectVertexColor(mesh, vertex, BLOCKED_COLOR);
    }
  });
});
