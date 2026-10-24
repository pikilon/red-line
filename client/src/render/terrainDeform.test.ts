import type { Mesh } from "three";
import { describe, expect, it } from "vitest";
import { createTerrain, terrainDeformerOf } from "./terrain";
import { MAX_SINK, MAX_VEHICLE_SINK } from "./terrainDeform";

function build() {
  const group = createTerrain(16, 16, new Uint8Array(16 * 16), 1);
  const deformer = terrainDeformerOf(group);
  if (deformer === null) throw new Error("no deformer");
  return { group, deformer };
}

describe("terrain relief (spec 22)", () => {
  it("sinks the ground under a crater and moves the mesh", () => {
    const { group, deformer } = build();
    deformer.crater(8, 8, 3, 0.4, 0);
    deformer.update(1000);
    expect(deformer.heightAt(8, 8)).toBeCloseTo(-0.4, 2);
    const grass = group.getObjectByName("grass") as Mesh;
    const position = grass.geometry.getAttribute("position");
    let lowest = 0;
    for (let i = 0; i < position.count; i++) {
      lowest = Math.min(lowest, position.getY(i));
    }
    expect(lowest).toBeCloseTo(-0.4, 2);
  });

  it("caps stacked craters at MAX_SINK", () => {
    const { deformer } = build();
    for (let i = 0; i < 10; i++) deformer.crater(8, 8, 3, 0.4, 0);
    deformer.update(1000);
    expect(deformer.heightAt(8, 8)).toBeGreaterThanOrEqual(-MAX_SINK - 1e-6);
  });

  it("sinks vehicles only on soft ground, and not past the vehicle floor", () => {
    const { deformer } = build();
    deformer.setSoftness(new Float32Array(17 * 17).fill(1));
    for (let i = 0; i < 100; i++) {
      deformer.press([{ id: 1, x: 4 + i * 0.05, y: 8, weight: 1 }], i);
    }
    expect(deformer.heightAt(6, 8)).toBeGreaterThanOrEqual(
      -MAX_VEHICLE_SINK - 1e-6,
    );
    expect(deformer.heightAt(6, 8)).toBeLessThan(0);
    expect(deformer.heightAt(6, 14)).toBe(0);
  });
});
