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

/** Counts the particles the features ask for, by kind. */
function fakeParticles() {
  const counts = { fire: 0, smoke: 0, chunks: 0 };
  return {
    counts,
    particles: {
      fire: () => {
        counts.fire++;
      },
      smoke: () => {
        counts.smoke++;
      },
      chunks: (_x: number, _y: number, _z: number, n: number) => {
        counts.chunks += n;
      },
    },
  };
}

/** Plays frames of 50 ms from `from` to `to`. */
function frames(live: LiveFeatures, from: number, to: number): void {
  for (let t = from; t <= to; t += 50) live.update(t);
}

/** Whether a family is drawn as a whole (not a feature drawn on its own). */
const familyDrawn = (live: LiveFeatures, family: string) =>
  live.object.children.some((child) => child.name === family);

function setup(particles: ReturnType<typeof fakeParticles> | null = null) {
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
    particles?.particles ?? null,
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
    expect(familyDrawn(live, "bridge")).toBe(false);
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
    live.apply([row({ index: 1, kind: 2, state: 1 })], 1000);
    live.apply([row({ index: 1, kind: 2, state: 2 })], 1100);
    expect(drawn.building?.[0]?.state).toBe(1);
    live.update(1300);
    expect(drawn.building?.[0]?.state).toBe(2);
  });

  it("sinks a collapsing building on its own, then leaves smoking rubble", () => {
    const fx = fakeParticles();
    const { live, drawn } = setup(fx);
    live.apply([row({ index: 1, kind: 2, state: 2, collapsing: true })], 1000);
    expect(drawn.building).toHaveLength(1);
    expect(live.object.getObjectByName("feature-collapse")).toBeDefined();
    expect(familyDrawn(live, "building")).toBe(false);
    frames(live, 1000, 2000);
    expect(fx.counts.fire).toBeGreaterThan(5);
    expect(fx.counts.smoke).toBeGreaterThan(5);
    const smokeBefore = fx.counts.smoke;
    live.apply([row({ index: 1, kind: 3 })], 4000);
    expect(live.object.getObjectByName("feature-collapse")).toBeUndefined();
    expect(drawn.prop?.map((i) => i.type.id)).toEqual(["rubble-2x2"]);
    expect(fx.counts.chunks).toBeGreaterThan(10);
    frames(live, 4000, 9000);
    expect(fx.counts.smoke).toBeGreaterThan(smokeBefore + 20);
  });

  it("topples a felled tree beside its stump and then lets it go", () => {
    const { live, drawn } = setup(fakeParticles());
    live.apply([row({ index: 0, kind: 1 })], 1000);
    expect(drawn.vegetation?.map((i) => i.type.id)).toEqual(["tree-stump"]);
    expect(live.fallingCount()).toBe(1);
    live.update(1500);
    const tree = live.object.getObjectByName("feature-topple");
    expect(
      Math.hypot(tree?.rotation.x ?? 0, tree?.rotation.z ?? 0),
    ).toBeGreaterThan(0.2);
    live.update(6000);
    expect(live.fallingCount()).toBe(0);
  });

  it("smokes a damaged building and burns a wrecked one, with particles not cones", () => {
    const fx = fakeParticles();
    const { live } = setup(fx);
    live.apply([row({ index: 1, kind: 2, state: 1 })], 1000);
    frames(live, 1000, 3000);
    expect(fx.counts.smoke).toBeGreaterThan(0);
    expect(fx.counts.fire).toBe(0);
    live.apply([row({ index: 1, kind: 2, state: 2 })], 3000);
    frames(live, 3000, 5000);
    expect(fx.counts.fire).toBeGreaterThan(0);
    live.apply([row({ index: 0, kind: 0, burning: true })], 5000);
    expect(live.object.getObjectByName("feature-fire")).toBeUndefined();
  });

  it("drops a broken bridge into the river instead of removing it at once", () => {
    const fx = fakeParticles();
    const { live } = setup(fx);
    live.apply([row({ index: 2, kind: 4, state: 2 })], 1000);
    expect(familyDrawn(live, "bridge")).toBe(false);
    expect(live.object.getObjectByName("feature-collapse")).toBeDefined();
    expect(fx.counts.chunks).toBeGreaterThan(0);
    frames(live, 1000, 14_000);
    expect(live.object.getObjectByName("feature-collapse")).toBeUndefined();
    expect(familyDrawn(live, "bridge")).toBe(false);
  });
});
