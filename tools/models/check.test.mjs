import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkModel, checkModels, parseGlb } from "./check.mjs";

const TYPE = { id: "x-tank", category: "unit", render: { size: [80, 55, 125] } };
const RULESET = { types: [TYPE, { id: "x-hq", category: "building", render: { size: [400, 80, 400] } }] };

/** A glTF document with one box mesh per node: [name, min, max, tris, children]. */
function gltf({ root = "x-tank", turret = true, materials = ["body", "team", "dark"], min = [-0.4, 0, -0.6], max = [0.4, 0.5, 0.6], tris = 300 } = {}) {
  const nodes = [{ name: root, mesh: 0, children: turret ? [1] : [] }];
  if (turret) nodes.push({ name: "turret", mesh: 0, translation: [0, 0, 0] });
  return {
    scene: 0, scenes: [{ nodes: [0] }], nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ count: 8, min, max }, { count: tris * 3 }],
    materials: materials.map((name) => ({ name })),
  };
}

function glb(doc) {
  const json = Buffer.from(JSON.stringify(doc).padEnd(Math.ceil(JSON.stringify(doc).length / 4) * 4, " "));
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, json]);
}

test("AC-06-01: model check", () => {
  assert.deepEqual(checkModel("x-tank.glb", TYPE, gltf()), []);
  const rules = (doc) => checkModel("x-tank.glb", TYPE, doc).map((e) => e.split(": ")[1]);
  assert.deepEqual(rules(gltf({ root: "other" })), ["root"]);
  assert.deepEqual(rules(gltf({ materials: ["body", "chrome"] })), ["materials"]);
  assert.deepEqual(rules(gltf({ turret: false })), []); // x-tank is not in TURRETED
  assert.deepEqual(rules(gltf({ tris: 900 })), ["budget"]); // two nodes share the mesh: 1800 > 1500
  assert.deepEqual(rules(gltf({ max: [0.5, 0.5, 0.6] })), ["bounds"]);
  assert.deepEqual(rules(gltf({ min: [-0.1, 0, -0.6], max: [0.1, 0.5, 0.6] })), ["fill"]);
  assert.deepEqual(rules(gltf({ max: [0.4, 0.7, 0.6] })), ["bounds"]);

  const turreted = { ...TYPE, id: "ru-t-72b3" };
  assert.deepEqual(checkModel("ru-t-72b3.glb", turreted, gltf({ root: "ru-t-72b3", turret: false })).map((e) => e.split(": ")[1]), ["turret"]);

  assert.deepEqual(parseGlb(glb(gltf())).nodes[0].name, "x-tank");
  const dir = mkdtempSync(join(tmpdir(), "models-"));
  writeFileSync(join(dir, "x-tank.glb"), glb(gltf()));
  writeFileSync(join(dir, "stray.glb"), glb(gltf({ root: "stray" })));
  const loose = checkModels(dir, RULESET, false);
  assert.deepEqual(loose.errors.map((e) => e.split(":")[0]), ["stray.glb"]);
  assert.deepEqual(loose.warnings, ["x-hq.glb: missing"]);
  assert.deepEqual(checkModels(dir, RULESET, true).errors.map((e) => e.split(":")[0]), ["stray.glb", "x-hq.glb"]);
});
