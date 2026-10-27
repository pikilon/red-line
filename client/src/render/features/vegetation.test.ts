import ruleset from "@data/ruleset.json";
import { InstancedMesh } from "three";
import { describe, expect, it } from "vitest";
import { flatElevation } from "../elevation";
import {
  createMapFeatures,
  type FeatureMap,
  type FeatureRules,
  featureInstancesOf,
} from "./index";
import { cellHash } from "./renderers/vegetation";

const rules = ruleset as unknown as FeatureRules;
const forest = ruleset.maps.find((m) => m.id === "demo-forest") as FeatureMap;

describe("vegetation renderer", () => {
  it("draws one instanced mesh per vegetation type of demo-forest", () => {
    const group = createMapFeatures(rules, forest, flatElevation(64, 48));
    const family = group.children.find((c) => c.name === "features-vegetation");
    const meshes = (family?.children ?? []) as InstancedMesh[];
    const typeIds = new Set(
      featureInstancesOf(forest, rules.featureTypes ?? []).map(
        (i) => i.type.id,
      ),
    );
    expect(typeIds.size).toBe(10);
    expect(meshes).toHaveLength(typeIds.size);
    expect(meshes.every((m) => m instanceof InstancedMesh)).toBe(true);
    const total = meshes.reduce((sum, m) => sum + m.count, 0);
    expect(total).toBe(forest.features?.length);
  });

  it("hashes a cell the same way every time", () => {
    expect(cellHash(3, 9, 1)).toBe(cellHash(3, 9, 1));
    expect(cellHash(3, 9, 1)).not.toBe(cellHash(9, 3, 1));
  });
});
