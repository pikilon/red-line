import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { buildRuleset, readSources } from "./build-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Compiles demo-bridges after `edit`; returns { errors, map }. */
function compile(edit) {
  const sources = readSources(root);
  const demo = parse(sources.maps.find((m) => m.file.endsWith("demo-bridges.yaml")).text);
  edit(demo);
  const maps = sources.maps.map((m) => (m.file.endsWith("demo-bridges.yaml") ? { ...m, text: stringify(demo) } : m));
  const { ruleset, errors } = buildRuleset({ ...sources, maps });
  return { errors, map: ruleset?.maps.find((m) => m.id === "demo-bridges") };
}

test("demo-bridges compiles with three decks over the river", () => {
  const { errors, map } = compile(() => {});
  assert.deepEqual(errors, []);
  const decks = map.features.filter((f) => f.to);
  assert.equal(decks.length, 3);
  // road-bridge 2 lanes, wooden 1 lane, stone arch 2 lanes: deck cells = 8 columns x lanes.
  const bytes = map.bridges.match(/../g).filter((b) => b !== "00");
  assert.equal(bytes.length, 8 * (2 + 1 + 2));
});

test("a bridge must be straight, at least 3 cells, connect to land at both ends and not overlap", () => {
  const first = (m) => m.features.findIndex((f) => f.from);
  const messages = (edit) => compile(edit).errors.map((e) => e.message);
  assert.ok(messages((m) => (m.features[first(m)].to = [35, 12])).some((e) => /straight/.test(e)));
  assert.ok(messages((m) => (m.features[first(m)].to = [29, 9])).some((e) => /at least 3/.test(e)));
  // Ends inside the deep river: no land beside the deck end.
  assert.ok(messages((m) => Object.assign(m.features[first(m)], { from: [31, 9], to: [33, 9] })).some((e) => /connect to land/.test(e)));
  assert.ok(messages((m) => m.features.push({ type: "road-bridge", from: [30, 10], to: [37, 10] })).some((e) => /connect to land|overlaps/.test(e)));
  assert.ok(messages((m) => (m.features[first(m)].type = "pine")).some((e) => /not a bridge type/.test(e)));
});
