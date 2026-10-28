import { Group, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { FeatureRow } from "../../sim/featureSnapshot";
import { flatElevation } from "../elevation";
import {
  type FeatureContext,
  type FeatureFamily,
  type FeatureInstance,
  type FeatureTypeInfo,
  featureInstancesOf,
  terrainLayersOf,
} from "./layers";
import { LiveFeatures } from "./live";

const type = (
  id: string,
  family: FeatureFamily,
  footprint: [number, number],
): FeatureTypeInfo => ({
  id,
  family,
  footprint,
  blocks: "all",
  variants: 1,
  render: {},
});

const TYPES = [
  type("pine", "vegetation", [1, 1]),
  type("tree-stump", "vegetation", [1, 1]),
  type("house", "building", [2, 2]),
  type("rubble-2x2", "prop", [2, 2]),
  type("bridge", "bridge", [1, 1]),
];
const MAP = {
  width: 20,
  height: 20,
  features: [
    { type: 0, x: 3, y: 3, rot: 0, variant: 0, state: 0 },
    { type: 2, x: 8, y: 8, rot: 0, variant: 0, state: 0 },
    {
      type: 4,
      x: 2,
      y: 12,
      rot: 0,
      variant: 0,
      state: 0,
      to: [2, 15] as [number, number],
    },
  ],
};

const row = (
  patch: Partial<FeatureRow> & { index: number; kind: number },
): FeatureRow => ({
  state: 0,
  alive: true,
  burning: false,
  collapsing: false,
  hpPermille: 1000,
  ...patch,
});

function setup() {
  const drawn: Record<string, FeatureInstance[]> = {};
  const ctx: FeatureContext = {
    elevation: flatElevation(20, 20),
    layers: terrainLayersOf(MAP),
    mapWidth: 20,
    mapHeight: 20,
  };
  const live = new LiveFeatures(
    featureInstancesOf(MAP, TYPES),
    TYPES,
    ctx,
    (family, instances): Object3D => {
      drawn[family] = [...instances];
      const group = new Group();
      group.name = family;
      return group;
    },
  );
  return { live, drawn };
}

describe("LiveFeatures", () => {
  it("draws every family at first", () => {
    const { drawn } = setup();
    expect(drawn.vegetation?.map((i) => i.type.id)).toEqual(["pine"]);
    expect(drawn.building?.map((i) => i.type.id)).toEqual(["house"]);
    expect(drawn.bridge).toHaveLength(1);
  });

  it("turns a felled tree into a stump and rubble into a footprint-sized prop", () => {
    const { live, drawn } = setup();
    live.apply([row({ index: 0, kind: 1 }), row({ index: 1, kind: 3 })], 1000);
    expect(drawn.vegetation?.map((i) => i.type.id)).toEqual(["tree-stump"]);
    expect(drawn.prop?.map((i) => [i.type.id, i.width, i.height])).toEqual([
      ["rubble-2x2", 2, 2],
    ]);
    expect(drawn.building).toHaveLength(1);
    expect(live.object.getObjectByName("building")).toBeUndefined();
  });

  it("passes the damage state to the building and drops a broken bridge", () => {
    const { live, drawn } = setup();
    live.apply([row({ index: 1, kind: 2, state: 1 })], 1000);
    expect(drawn.building?.[0]?.state).toBe(1);
    live.apply([row({ index: 2, kind: 4, state: 2 })], 2000);
    expect(live.object.getObjectByName("bridge")).toBeUndefined();
  });

  it("puts flames on burning features and removes them when the fire is out", () => {
    const { live } = setup();
    live.apply([row({ index: 0, kind: 0, burning: true })], 1000);
    expect(live.object.getObjectByName("feature-fire")).toBeDefined();
    live.apply([row({ index: 0, kind: 0 })], 2000);
    expect(live.object.getObjectByName("feature-fire")).toBeUndefined();
  });

  it("rebuilds a family at most every quarter second", () => {
    const { live, drawn } = setup();
    live.apply([row({ index: 0, kind: 1 })], 1000);
    live.apply([row({ index: 0, kind: 0 })], 1100);
    expect(drawn.vegetation?.[0]?.type.id).toBe("tree-stump");
    live.update(1300);
    expect(drawn.vegetation?.[0]?.type.id).toBe("pine");
  });
});
