import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkColors, checkModel, checkModels, parseGlb, parseGlbBinary } from "./check.mjs";

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

/** A one-node x-tank GLB whose primitive has COLOR_0 `colors` (RGBA rows),
 *  stored as `float` or normalized `ushort`; `null` omits COLOR_0. */
function coloured(colors, storage = "float") {
  const doc = gltf({ turret: false });
  const values = colors?.flat() ?? [];
  const bin = storage === "float"
    ? Buffer.from(new Float32Array(values).buffer)
    : Buffer.from(new Uint16Array(values.map((v) => Math.round(v * 65535))).buffer);
  const padded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  if (colors !== null) {
    doc.buffers = [{ byteLength: padded.length }];
    doc.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: bin.length }];
    doc.accessors.push({
      bufferView: 0, componentType: storage === "float" ? 5126 : 5123, normalized: storage !== "float",
      count: colors.length, type: "VEC4",
    });
    doc.meshes[0].primitives[0].attributes.COLOR_0 = 2;
  }
  const json = Buffer.from(JSON.stringify(doc).padEnd(Math.ceil(JSON.stringify(doc).length / 4) * 4, " "));
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + 8 + padded.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(padded.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, binHeader, padded]);
}

test("AC-10-04: model detail", () => {
  const rules = (buffer) => checkColors("x-tank.glb", parseGlb(buffer), parseGlbBinary(buffer)).map((e) => e.split(": ")[1]);
  assert.deepEqual(rules(coloured([[0.55, 0.55, 0.55, 1], [1, 1, 1, 1], [0.8, 0.8, 0.8, 1]])), []);
  assert.deepEqual(rules(coloured([[0.6, 0.6, 0.6, 1], [1, 1, 1, 1]], "ushort")), []);
  assert.deepEqual(rules(coloured(null)), ["ao"]);
  assert.deepEqual(rules(coloured([[0.6, 0.6, 0.6, 1], [0.5, 0.5, 0.5, 1]])), ["ao"]);
  assert.deepEqual(rules(coloured([[0.3, 0.3, 0.3, 1]], "ushort")), ["ao"]);

  // assets:check runs the COLOR_0 rule on every model file.
  const dir = mkdtempSync(join(tmpdir(), "models-ao-"));
  writeFileSync(join(dir, "x-tank.glb"), coloured([[0.5, 0.5, 0.5, 1]]));
  writeFileSync(join(dir, "x-hq.glb"), coloured(null));
  const ruleset = { types: [TYPE] };
  assert.deepEqual(checkModels(dir, ruleset, false, { colors: true }).errors.map((e) => e.split(": ").slice(0, 2).join(": ")), [
    "x-hq.glb: unknown type", "x-tank.glb: ao",
  ]);
  writeFileSync(join(dir, "x-tank.glb"), coloured([[0.9, 0.9, 0.9, 1]]));
  assert.deepEqual(checkModels(dir, ruleset, true, { colors: true }).errors.map((e) => e.split(":")[0]), ["x-hq.glb"]);
});
