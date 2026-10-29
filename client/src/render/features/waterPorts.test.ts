import ruleset from "@data/ruleset.json";
import { type Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { elevationOf, groundY, setGroundElevation } from "../elevation";
import {
  createMapFeatures,
  type FeatureMap,
  type FeatureRules,
  featureInstancesOf,
  terrainLayersOf,
} from "./index";
import { waterFieldOf } from "./renderers/water";

const rules = ruleset as unknown as FeatureRules;
const coast = ruleset.maps.find((m) => m.id === "demo-coast") as FeatureMap;

describe("water and ports (spec 26 phase 4)", () => {
  it("draws the water as one shader mesh and the harbour as at most two meshes", () => {
    const group = createMapFeatures(
      rules,
      coast,
      elevationOf(coast as unknown as Parameters<typeof elevationOf>[0]),
    );
    expect(group.getObjectByName("water")).toBeInstanceOf(Mesh);
    const port = group.getObjectByName("features-port") as Group;
    expect(port.children.length).toBeGreaterThanOrEqual(1);
    expect(port.children.length).toBeLessThanOrEqual(2);
  });

  it("uses every port type in the demo map", () => {
    const used = new Set(
      featureInstancesOf(coast, rules.featureTypes ?? [])
        .filter((i) => i.type.family === "port")
        .map((i) => i.type.id),
    );
    const defined = (rules.featureTypes ?? [])
      .filter((t) => t.family === "port")
      .map((t) => t.id);
    expect(defined.length).toBe(9);
    for (const id of defined) expect(used.has(id)).toBe(true);
  });

  it("makes a coverage field that is wet in the sea and dry inland", () => {
    const layers = terrainLayersOf(coast, rules.layerNames);
    const data = waterFieldOf(layers).image.data as Uint8Array;
    const w = layers.width * 4;
    const coverageAt = (x: number, y: number): number =>
      data[(y * 4 * w + x * 4) * 4] ?? 0;
    expect(coverageAt(2, 2)).toBeGreaterThan(240);
    expect(coverageAt(2, 30)).toBeLessThan(10);
  });

  it("stands walkers on the pier planks, not in the water under them (spec 32)", () => {
    const port = ruleset.maps.find((m) => m.id === "river-port") as FeatureMap;
    const elevation = elevationOf(
      port as unknown as Parameters<typeof elevationOf>[0],
    );
    setGroundElevation(elevation);
    const water = groundY(19.5, 88.5);
    createMapFeatures(rules, port, elevation);
    // The west pier covers cells 20..21 x 84..89.
    expect(groundY(20.5, 88.5)).toBeGreaterThan(water + 0.3);
    expect(groundY(19.5, 88.5)).toBe(water);
    setGroundElevation(null);
  });
});
