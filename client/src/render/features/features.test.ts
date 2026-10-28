import ruleset from "@data/ruleset.json";
import { Group, InstancedMesh, Mesh, Object3D } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { elevationOf, flatElevation } from "../elevation";
import {
  createMapFeatures,
  type FeatureMap,
  type FeatureRules,
  featureInstancesOf,
  registerFeatureRenderer,
  registerGroundLayerRenderer,
  registerWaterRenderer,
  resetFeatureRenderers,
  terrainLayersOf,
  WATER_DEEP,
  WATER_DEPTH_MASK,
} from "./index";

const rules = ruleset as unknown as FeatureRules;
const lab = ruleset.maps.find((m) => m.id === "landscape-lab") as FeatureMap;

afterEach(resetFeatureRenderers);

describe("map feature layers", () => {
  it("decodes the layers and instances of landscape-lab", () => {
    const layers = terrainLayersOf(lab, rules.layerNames);
    expect(layers.present).toBe(true);
    expect(layers.ground).toHaveLength(64 * 64);
    expect(layers.names.ground).toContain("snow-field");
    const deep = layers.water.filter(
      (b) => (b & WATER_DEPTH_MASK) === WATER_DEEP,
    ).length;
    expect(deep).toBeGreaterThan(100);
    const instances = featureInstancesOf(lab, rules.featureTypes ?? []);
    expect(instances.map((i) => i.type.family)).toContain("building");
    const house = instances.find((i) => i.type.id === "house-small");
    expect(house).toMatchObject({ width: 2, height: 2 });
  });

  it("leaves a legacy map without layers or features", () => {
    const first = ruleset.maps.find((m) => m.id === "first-line") as FeatureMap;
    expect(terrainLayersOf(first).present).toBe(false);
    expect(featureInstancesOf(first, rules.featureTypes ?? [])).toHaveLength(0);
    const group = createMapFeatures(rules, first, flatElevation(128, 128));
    expect(group.children).toHaveLength(0);
  });

  it("draws one object per family plus one for the water by default", () => {
    const group = createMapFeatures(
      rules,
      lab,
      elevationOf({ width: 64, height: 64 }),
    );
    const names = group.children.map((c) => c.name).sort();
    expect(names).toEqual([
      "features-bridge",
      "features-building",
      "features-prop",
      "features-vegetation",
      "water",
    ]);
    const pines = group.children.find((c) => c.name === "features-vegetation");
    expect(pines).toBeInstanceOf(InstancedMesh);
    expect((pines as InstancedMesh).count).toBeGreaterThan(20);
    expect(group.children.find((c) => c.name === "water")).toBeInstanceOf(Mesh);
  });

  it("lets a registered renderer replace the placeholder", () => {
    const seen: string[] = [];
    registerFeatureRenderer("building", (instances) => {
      seen.push(...instances.map((i) => i.type.id));
      const marker = new Object3D();
      marker.name = "custom-buildings";
      return marker;
    });
    registerWaterRenderer(() => new Group());
    registerGroundLayerRenderer((layers) => {
      const marker = new Object3D();
      marker.name = `ground-${layers.width}`;
      return marker;
    });
    const group = createMapFeatures(rules, lab, flatElevation(64, 64));
    const names = group.children.map((c) => c.name);
    expect(names).toContain("custom-buildings");
    expect(names).toContain("ground-64");
    expect(seen).toEqual(["house-small", "house-small"]);
  });
});
