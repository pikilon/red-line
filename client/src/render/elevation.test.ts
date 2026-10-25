import ruleset from "@data/ruleset.json";
import { Euler, type Mesh, Ray, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  drapedGrid,
  elevationOf,
  footprintGround,
  fromCorners,
  groundTilt,
  groundY,
  pickGround,
  setGroundElevation,
  setGroundRelief,
} from "./elevation";
import { createTerrain, terrainDeformerOf } from "./terrain";

/** A 1 x 1 map with corners (0,0)=0, (1,0)=16, (0,1)=32, (1,1)=48 steps. */
const ONE_CELL = { width: 1, height: 1, heights: "00102030" };

/** A ramp along +z: corner height = z / 2 tiles. */
function ramp(size: number) {
  const corners = new Float32Array((size + 1) * (size + 1));
  for (let z = 0; z <= size; z++) {
    for (let x = 0; x <= size; x++) corners[z * (size + 1) + x] = z / 2;
  }
  return fromCorners(size, size, corners);
}

afterEach(() => setGroundElevation(null));

describe("elevation (spec 30)", () => {
  it("AC-30-07: decodes the ruleset hex and samples like the sim", () => {
    const elevation = elevationOf(ONE_CELL);
    expect(elevation.raised).toBe(true);
    // Same points as the sim's ac_30_01.
    expect(elevation.at(0, 0)).toBe(0);
    expect(elevation.at(1, 0)).toBe(1);
    expect(elevation.at(0, 1)).toBe(2);
    expect(elevation.at(1, 1)).toBe(3);
    expect(elevation.at(0.5, 0.25)).toBeCloseTo(1, 6);
    expect(elevation.at(0.25, 0.5)).toBeCloseTo(1.25, 6);
    expect(elevation.at(-3, 0)).toBe(0);
  });

  it("AC-30-07: a missing or malformed string is flat", () => {
    expect(elevationOf({ width: 2, height: 2 }).raised).toBe(false);
    expect(elevationOf({ width: 2, height: 2, heights: "zz" }).raised).toBe(
      false,
    );
  });

  it("AC-30-08: first-line ships its heights to the client", () => {
    const map = ruleset.maps.find((entry) => entry.id === "first-line");
    expect(map).toBeDefined();
    const elevation = elevationOf(map as never);
    expect(elevation.raised).toBe(true);
    expect(elevation.top).toBeGreaterThanOrEqual(2);
  });

  it("AC-30-09: vehicles lift the nose uphill and the right side on a side slope", () => {
    setGroundElevation(ramp(8));
    const uphill = groundTilt(4, 4, 0, 2, 1);
    expect(uphill.pitch).toBeLessThan(0);
    expect(uphill.roll).toBeCloseTo(0, 6);
    // The nose (+z of the model) ends up higher than the tail.
    const nose = new Vector3(0, 0, 1).applyEuler(
      new Euler(uphill.pitch, 0, 0, "YXZ"),
    );
    expect(nose.y).toBeGreaterThan(0);
    expect(Math.tan(-uphill.pitch)).toBeCloseTo(0.5, 6);
    // Facing +x (yaw pi/2), the right side points to -z, downhill.
    const across = groundTilt(4, 4, Math.PI / 2, 2, 1);
    expect(across.pitch).toBeCloseTo(0, 6);
    const right = new Vector3(1, 0, 0).applyEuler(
      new Euler(across.pitch, Math.PI / 2, across.roll, "YXZ"),
    );
    expect(right.z).toBeLessThan(0);
    expect(right.y).toBeLessThan(0);
  });

  it("AC-30-10: buildings stand on the lowest point of their footprint", () => {
    setGroundElevation(ramp(8));
    expect(footprintGround(4, 4, 2, 2)).toBeCloseTo(1.5, 6);
    expect(groundY(4, 4)).toBeCloseTo(2, 6);
  });

  it("AC-30-16: units and their tilt follow the crater relief", () => {
    const elevation = ramp(8);
    setGroundElevation(elevation);
    // Dig a crater under the unit and leave a lower lip on its left side:
    // the hook returns the whole surface, like TerrainDeformer.heightAt.
    setGroundRelief(
      (x, y) =>
        elevation.at(x, y) + (x === 4 && y === 4 ? -0.3 : x < 4 ? -0.2 : 0),
    );
    expect(groundY(4, 4)).toBeCloseTo(1.7, 6);
    const tilt = groundTilt(4, 4, 0, 2, 1);
    // The left side sits 0.2 tiles lower than the right.
    expect(tilt.roll).toBeGreaterThan(0.15);
    // Clearing the elevation clears the relief with it.
    setGroundElevation(null);
    expect(groundY(4, 4)).toBe(0);
    expect(groundTilt(4, 4, 0, 2, 1)).toEqual({ pitch: 0, roll: 0 });
  });

  it("AC-30-11: a click picks the hill the ray meets first", () => {
    setGroundElevation(ramp(8));
    // Straight down onto (3, 5): the ground there is 2.5 tiles up.
    const down = new Ray(new Vector3(3, 50, 5), new Vector3(0, -1, 0));
    const hit = pickGround(down);
    expect(hit?.x).toBeCloseTo(3, 3);
    expect(hit?.y).toBeCloseTo(5, 3);
    // A slanted ray hits the slope before it would reach y = 0.
    const slanted = new Ray(
      new Vector3(3, 20, -10),
      new Vector3(0, -1, 1).normalize(),
    );
    const onSlope = pickGround(slanted);
    expect(onSlope).not.toBeNull();
    const z = onSlope?.y ?? 0;
    expect(20 - (z + 10)).toBeCloseTo(z / 2, 2);
  });

  it("AC-30-12: the terrain mesh, the relief and the drape follow the heights", () => {
    const elevation = ramp(4);
    const group = createTerrain(
      4,
      4,
      new Uint8Array(16),
      1,
      undefined,
      elevation,
    );
    const grass = group.getObjectByName("grass") as Mesh;
    const position = grass.geometry.getAttribute("position");
    let top = 0;
    for (let i = 0; i < position.count; i++)
      top = Math.max(top, position.getY(i));
    expect(top).toBeCloseTo(2, 6);
    expect(grass.geometry.getAttribute("aCliff")).toBeDefined();
    const relief = terrainDeformerOf(group);
    expect(relief?.heightAt(2, 2)).toBeCloseTo(1, 6);
    relief?.crater(2, 2, 1.5, 0.2, 0);
    relief?.update(1000);
    expect(relief?.heightAt(2, 2)).toBeLessThan(1);
    const drape = drapedGrid(elevation, 0.02).getAttribute("position");
    expect(drape.getY(drape.count - 1)).toBeCloseTo(2.02, 6);
  });

  it("AC-30-12: a flat map keeps the flat ground", () => {
    const group = createTerrain(2, 2, new Uint8Array(4), 1);
    const flat = group.getObjectByName("grass") as Mesh;
    expect(flat.geometry.getAttribute("aCliff")).toBeUndefined();
    expect(terrainDeformerOf(group)?.heightAt(1, 1)).toBe(0);
  });
});
