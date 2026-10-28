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
      y0: 23,
      x1: 35,
      y1: 24,
      horizontal: true,
      length: 8,
      width: 2,
    });
  });

  it("raises units over a deck, ramping at the ends, and leaves other ground alone", () => {
    const decks = bridges.map((b) => deckOf(b, ctx));
    const wooden = decks.find((d) => d.y0 === 23) as (typeof decks)[number];
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

describe("rendered decks match the walkable cells", () => {
  const raw = map as unknown as { bridges: string; width: number };
  const bytes = (hex: string): number[] =>
    (hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16));

  it("covers exactly the deck cells of the compiled layer", () => {
    const layer = bytes(raw.bridges);
    const decks = bridges.map((b) => deckOf(b, ctx));
    layer.forEach((value, i) => {
      const x = i % raw.width;
      const y = Math.floor(i / raw.width);
      const inside = decks.some(
        (d) => x >= d.x0 && x <= d.x1 && y >= d.y0 && y <= d.y1,
      );
      expect(inside, `cell ${x},${y}`).toBe(value !== 0);
    });
  });

  it("builds each model inside its deck rectangle, horizontal or vertical", () => {
    for (const b of bridges) {
      const deck = deckOf(b, ctx);
      for (const d of [
        deck,
        { ...deck, horizontal: false, length: deck.width + 6, width: 2 },
      ]) {
        const g = bridgeGeometry(
          [{ deck: d, kind: String(b.type.render.kind), variant: 0 }],
          0,
        );
        g?.computeBoundingBox();
        const box = g?.boundingBox;
        const w = d.horizontal ? d.length : d.width;
        const h = d.horizontal ? d.width : d.length;
        expect(box?.min.x).toBeGreaterThanOrEqual(d.x0 - 0.05);
        expect(box?.max.x).toBeLessThanOrEqual(d.x0 + w + 0.05);
        expect(box?.min.z).toBeGreaterThanOrEqual(d.y0 - 0.05);
        expect(box?.max.z).toBeLessThanOrEqual(d.y0 + h + 0.05);
      }
    }
  });
});
