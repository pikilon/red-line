import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { buildRuleset, readSources } from "./build-data.mjs";
import { cellHash, expandFeatures, pathCoversCell, rasterizeTerrain } from "./map-layers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const map = (extra) => ({ id: "t", width: 16, height: 16, blocked: [], ...extra });
const pine = { id: "pine", family: "vegetation", footprint: [1, 1], blocks: "all", variants: 3, render: {} };
const house = { id: "house", family: "building", footprint: [2, 1], blocks: "all", variants: 1, render: {} };

test("path coverage is exact and symmetric", () => {
  // A 2 wide horizontal road along y = 5 covers rows 4 and 5 (centres 0.5 away) and no others.
  const road = [[2, 5], [10, 5]];
  assert.ok(pathCoversCell(road, 2, 6, 4));
  assert.ok(pathCoversCell(road, 2, 6, 5));
  assert.ok(!pathCoversCell(road, 2, 6, 3));
  assert.ok(!pathCoversCell(road, 2, 6, 6));
  assert.ok(!pathCoversCell(road, 2, 13, 5));
});

test("terrain layers paint in order and fords are shallow", () => {
  const layers = rasterizeTerrain(
    map({
      terrain: {
        ground: { default: "dirt", patches: [{ material: "sand", rect: [0, 0, 3, 3] }] },
        roads: [{ type: "asphalt", path: [[0, 8], [15, 8]], width: 2 }],
        water: [{ kind: "river", depth: "deep", path: [[8, 0], [8, 15]], width: 2, fords: [[8, 4, 1]] }],
      },
    }),
  );
  assert.equal(layers.ground[0], 2); // sand
  assert.equal(layers.ground[15 * 16 + 15], 1); // dirt default
  assert.equal(layers.roads[8 * 16 + 3], 1);
  assert.equal(layers.water[10 * 16 + 8], (1 << 2) | 2); // river, deep
  assert.equal(layers.water[4 * 16 + 8], (1 << 2) | 1); // river, shallow ford
  assert.equal(rasterizeTerrain(map({})), null);
});

test("area features expand the same way every time and respect blocked cells", () => {
  const entries = { features: [{ type: "pine", area: [0, 0, 15, 15], density: 40, seed: 5 }] };
  const run = () => expandFeatures(map(entries), [pine], new Set(["3,3"]));
  const a = run();
  assert.deepEqual(a, run());
  assert.ok(a.instances.length > 40 && a.instances.length < 140);
  assert.ok(!a.instances.some((i) => i.x === 3 && i.y === 3));
  assert.ok(a.instances.every((i) => i.variant < 3));
  assert.notEqual(cellHash(5, 1, 2), cellHash(6, 1, 2));
});

test("explicit features win over area ones and a clash is an error", () => {
  const entries = {
    features: [
      { type: "pine", area: [0, 0, 15, 15], density: 100, seed: 1 },
      { type: "house", at: [4, 4], rot: 1 },
    ],
  };
  const { instances, problems } = expandFeatures(map(entries), [pine, house], new Set());
  assert.deepEqual(problems, []);
  const placed = instances.find((i) => i.type === 1);
  assert.deepEqual([placed.x, placed.y, placed.rot], [4, 4, 1]);
  // rot 1 makes the 2x1 house 1x2: (4, 5) belongs to it, so no pine stands there.
  assert.ok(!instances.some((i) => i.type === 0 && i.x === 4 && i.y === 5));

  const clash = expandFeatures(map({ features: [{ type: "house", at: [4, 4] }, { type: "pine", at: [5, 4] }] }), [pine, house], new Set());
  assert.equal(clash.problems.length, 1);
});

test("maps without the new keys compile exactly as before", () => {
  const { ruleset, errors } = buildRuleset(readSources(root));
  assert.deepEqual(errors, []);
  for (const id of ["first-line", "showcase"]) {
    const compiled = ruleset.maps.find((m) => m.id === id);
    for (const key of ["ground", "roads", "water", "features"]) assert.ok(!(key in compiled), `${id}.${key}`);
  }
  const lab = ruleset.maps.find((m) => m.id === "landscape-lab");
  assert.ok(lab.features.length > 20 && lab.water.length === 64 * 64 * 2);
});

test("a road on deep water or a feature on a start is rejected", () => {
  const sources = readSources(root);
  const lab = parse(sources.maps.find((m) => m.file.endsWith("landscape-lab.yaml")).text);
  const compile = (edit) => {
    const copy = structuredClone(lab);
    edit(copy);
    const maps = sources.maps.map((m) => (m.file.endsWith("landscape-lab.yaml") ? { ...m, text: stringify(copy) } : m));
    return buildRuleset({ ...sources, maps }).errors;
  };
  assert.ok(compile((m) => m.terrain.roads.push({ type: "dirt", path: [[5, 1], [20, 1]], width: 1 })).some((e) => /road on deep water/.test(e.message)));
  assert.ok(compile((m) => m.features.push({ type: "house-small", at: [8, 28] })).some((e) => /overlaps/.test(e.message)));
  assert.ok(compile((m) => m.features.push({ type: "oak", at: [1, 20] })).some((e) => e.code === "unknown-reference"));
});
