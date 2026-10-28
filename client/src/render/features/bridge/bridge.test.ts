import ruleset from "@data/ruleset.json";
import { afterEach, describe, expect, it } from "vitest";
import {
  elevationOf,
  groundY,
  setDeckHeights,
  setGroundElevation,
} from "../../elevation";
import {
  type FeatureMap,
  type FeatureRules,
  featureInstancesOf,
} from "../layers";
import { deckLookup, deckOf } from "./deck";
import { bridgeGeometry } from "./model";

const rules = ruleset as unknown as FeatureRules;
const map = ruleset.maps.find(
  (m) => m.id === "demo-bridges",
) as unknown as FeatureMap;
const elevation = elevationOf(map);
const ctx = {
  elevation,
  layers: {} as never,
  mapWidth: map.width,
  mapHeight: map.height,
};
const bridges = featureInstancesOf(map, rules.featureTypes ?? []).filter(
  (i) => i.type.family === "bridge",
);

afterEach(() => {
  setGroundElevation(null);
});

describe("bridge decks", () => {
  it("reads the three bridges of demo-bridges as deck rectangles", () => {
    expect(bridges.map((b) => b.type.id).sort()).toEqual([
      "road-bridge",
      "stone-arch",
      "wooden-bridge",
    ]);
    const wooden = deckOf(
      bridges.find((b) => b.type.id === "wooden-bridge") as never,
      ctx,
    );
    expect(wooden).toMatchObject({
      x0: 28,
      y0: 24,
      x1: 35,
      y1: 24,
      horizontal: true,
      length: 8,
      width: 1,
    });
  });

  it("raises units over a deck, ramping at the ends, and leaves other ground alone", () => {
    const decks = bridges.map((b) => deckOf(b, ctx));
    const wooden = decks.find((d) => d.y0 === 24) as (typeof decks)[number];
    setGroundElevation(elevation);
    setDeckHeights(deckLookup(decks));
    expect(groundY(32, 24.5)).toBeCloseTo(wooden.height, 5);
    expect(groundY(28.5, 24.5)).toBeCloseTo(wooden.height * 0.5, 5);
    expect(groundY(32, 20)).toBe(0);
    setDeckHeights(null);
    expect(groundY(32, 24.5)).toBe(0);
  });

  it("merges every bridge into one geometry and whitens the tops under snow", () => {
    const builds = bridges.map((b) => ({
      deck: deckOf(b, ctx),
      kind: String(b.type.render.kind),
      variant: b.variant,
    }));
    const plain = bridgeGeometry(builds, 0);
    const snowy = bridgeGeometry(builds, 1);
    expect(plain).not.toBeNull();
    expect(plain?.getAttribute("position").count).toBeGreaterThan(500);
    const brightness = (g: typeof plain): number => {
      const c = g?.getAttribute("color");
      let sum = 0;
      for (let i = 0; i < (c?.count ?? 0); i++) sum += c?.getX(i) ?? 0;
      return sum;
    };
    expect(brightness(snowy)).toBeGreaterThan(brightness(plain));
    expect(bridgeGeometry([], 0)).toBeNull();
  });
});
