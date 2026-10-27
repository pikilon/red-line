import ruleset from "@data/ruleset.json";
import { describe, expect, it } from "vitest";
import { flatElevation } from "../../elevation";
import { type FeatureRules, featureInstancesOf } from "../layers";
import { MeshBag } from "./bag";
import { Build, rngOf, STATE_KINDS } from "./build";
import { BUILDERS } from "./buildings";
import { PROP_BUILDERS } from "./props";
import { buildBag } from "./render";

const rules = ruleset as unknown as FeatureRules;

describe("civilian builders", () => {
  const all = { ...BUILDERS, ...PROP_BUILDERS };
  it("every feature type of buildings.yaml has a builder", () => {
    const types = (rules.featureTypes ?? []).filter(
      (t) =>
        t.family === "building" || t.family === "wall" || t.family === "prop",
    );
    expect(types.length).toBeGreaterThanOrEqual(15);
    for (const t of types)
      expect(all[String(t.render.model ?? t.id)]).toBeDefined();
  });

  it("draws finite geometry for every variant and state", () => {
    for (const [id, builder] of Object.entries(all)) {
      for (let variant = 0; variant < 3; variant++) {
        for (const state of STATE_KINDS) {
          const bag = new MeshBag();
          builder(new Build(bag, rngOf(variant + 7), state, variant, 3, 3));
          expect(bag.triangles, `${id} ${state}`).toBeGreaterThan(0);
          for (const v of [...bag.solid.pos, ...bag.solid.nor]) {
            expect(Number.isFinite(v)).toBe(true);
          }
        }
      }
    }
  });

  it("builds the demo town into two meshes worth of geometry", () => {
    const map = ruleset.maps.find((m) => m.id === "demo-town");
    expect(map).toBeDefined();
    const instances = featureInstancesOf(
      map as never,
      rules.featureTypes ?? [],
    );
    const ctx = {
      elevation: flatElevation(64, 56),
      layers: {} as never,
      mapWidth: 64,
      mapHeight: 56,
    };
    const buildings = instances.filter((i) => i.type.family === "building");
    expect(buildings.length).toBeGreaterThan(60);
    const states = new Set(buildings.map((i) => i.state));
    expect(states.size).toBe(4);
    const bag = buildBag(buildings, ctx, BUILDERS);
    expect(bag.solid.triangles).toBeGreaterThan(10000);
  });
});
