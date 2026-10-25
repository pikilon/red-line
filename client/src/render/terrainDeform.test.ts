import type { Mesh } from "three";
import { describe, expect, it } from "vitest";
import { createTerrain, terrainDeformerOf } from "./terrain";
import {
  craterProfile,
  MAX_RISE,
  MAX_SINK,
  MAX_VEHICLE_SINK,
  SUB,
} from "./terrainDeform";

function build() {
  const group = createTerrain(16, 16, new Uint8Array(16 * 16), 1);
  const deformer = terrainDeformerOf(group);
  if (deformer === null) throw new Error("no deformer");
  return { group, deformer };
}

describe("terrain relief (spec 24)", () => {
  it("sinks the ground under a crater and moves the mesh", () => {
    const { group, deformer } = build();
    deformer.crater(8, 8, 3, 0.4, 0);
    deformer.update(1000);
    expect(deformer.heightAt(8, 8)).toBeCloseTo(-0.4, 2);
    // The fine patch draws the crater; the coarse tiles under it fold away.
    const patch = group.getObjectByName("grass-relief") as Mesh;
    const position = patch.geometry.getAttribute("position");
    let lowest = 0;
    let highest = 0;
    for (let i = 0; i < position.count; i++) {
      lowest = Math.min(lowest, position.getY(i));
      highest = Math.max(highest, position.getY(i));
    }
    expect(lowest).toBeCloseTo(-0.4, 2);
    // A raised rim around the bowl (spec 29 §4).
    expect(highest).toBeGreaterThan(0.05);
    expect(highest).toBeLessThanOrEqual(MAX_RISE + 1e-6);
    expect(deformer.stats().refined).toBeGreaterThan(0);
  });

  it("digs a bowl with a rim that fades out past the crater", () => {
    expect(craterProfile(0, 0.3)).toBeCloseTo(-1, 5);
    expect(craterProfile(0.92, 0.3)).toBeGreaterThan(0.25);
    expect(craterProfile(1.6, 0.3)).toBe(0);
    // Smooth: no step between neighbouring samples anywhere on the profile.
    for (let t = 0; t < 1.7; t += 0.01) {
      expect(
        Math.abs(craterProfile(t + 0.01, 0.3) - craterProfile(t, 0.3)),
      ).toBeLessThan(0.05);
    }
  });

  it("leaves no seam where crater patches meet the coarse ground", () => {
    const { group, deformer } = build();
    deformer.crater(8.3, 7.6, 1.5, 0.3, 0);
    deformer.update(1000);
    const coarse = group.getObjectByName("grass") as Mesh;
    const patch = group.getObjectByName("grass-relief") as Mesh;
    const heightOf = new Map<string, number>();
    const coarsePosition = coarse.geometry.getAttribute("position");
    for (let i = 0; i < coarsePosition.count; i++) {
      const y = coarsePosition.getY(i);
      // Folded tiles hide far below; every visible corner must match.
      if (y < -1) continue;
      heightOf.set(`${coarsePosition.getX(i)},${coarsePosition.getZ(i)}`, y);
    }
    const patchPosition = patch.geometry.getAttribute("position");
    const drawn =
      (patch.geometry.drawRange.count / (SUB * SUB * 6)) * (SUB + 1) ** 2;
    let shared = 0;
    for (let i = 0; i < drawn; i++) {
      const key = `${patchPosition.getX(i)},${patchPosition.getZ(i)}`;
      const y = heightOf.get(key);
      if (y === undefined) continue;
      shared++;
      expect(patchPosition.getY(i)).toBeCloseTo(y, 5);
    }
    expect(shared).toBeGreaterThan(0);
  });

  it("follows the crater in heightAt for decals", () => {
    const { deformer } = build();
    const seen: number[][] = [];
    deformer.onChange((...box) => seen.push(box));
    deformer.crater(8, 8, 1.2, 0.25, 0);
    deformer.update(1000);
    expect(seen.length).toBeGreaterThan(0);
    expect(deformer.heightAt(8, 8)).toBeLessThan(-0.2);
    expect(deformer.heightAt(12, 12)).toBe(0);
  });

  it("shades the bowl floor soot-black and leaves the outside light", () => {
    const { group, deformer } = build();
    deformer.crater(8, 8, 2, 0.2, 0);
    deformer.update(1000);
    const patch = group.getObjectByName("grass-relief") as Mesh;
    const position = patch.geometry.getAttribute("position");
    const color = patch.geometry.getAttribute("color");
    let centre = 1;
    let outside = 0;
    for (let i = 0; i < position.count; i++) {
      const distance = Math.hypot(position.getX(i) - 8, position.getZ(i) - 8);
      if (distance < 0.2) centre = Math.min(centre, color.getX(i));
      if (distance > 2.4) outside = Math.max(outside, color.getX(i));
    }
    expect(centre).toBeLessThan(0.55);
    expect(outside).toBeGreaterThan(0.85);
    expect(centre).toBeLessThan(outside * 0.7);
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
