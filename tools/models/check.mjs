// Model check (spec 06 §3, §4): validates every client/public/models/*.glb
// against the builtin ruleset without dependencies. `--strict` also fails on
// ruleset types that have no model yet.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MATERIALS = ["body", "team", "dark"];
export const TURRETED = [
  "ua-bradley", "ua-leopard-2a4", "ua-himars", "ua-kozak-scout", "ua-defense",
  "ru-bmp-2", "ru-t-72b3", "ru-tos-1a", "ru-brdm-scout", "ru-defense",
];
export const BUDGETS = { unit: 1500, building: 3000, depot: 1000 };
const FILL = 0.7;
const EPS = 0.01;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/** The glTF JSON chunk of a GLB buffer. */
export function parseGlb(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB file");
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) throw new Error("first chunk is not JSON");
  return JSON.parse(new TextDecoder().decode(buffer.subarray(20, 20 + length)));
}

/** Types that need a model: every unit, building and depot but the placeholder. */
export function modelTypes(ruleset) {
  return ruleset.types.filter((t) => t.category in BUDGETS && t.id !== "tech-slice-placeholder");
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function apply(m, [x, y, z]) {
  return [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
}

/** World bounds, triangle count, node and material names of a glTF document. */
export function summarize(gltf) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  const nodeNames = [];
  const materialNames = (gltf.materials ?? []).map((m) => m.name);
  const scene = gltf.scenes?.[gltf.scene ?? 0] ?? { nodes: [] };
  const visit = (index, parent) => {
    const node = gltf.nodes[index];
    const world = multiply(parent, localMatrix(node));
    nodeNames.push(node.name);
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const position = gltf.accessors[primitive.attributes.POSITION];
        const count = primitive.indices !== undefined ? gltf.accessors[primitive.indices].count : position.count;
        triangles += Math.floor(count / 3);
        for (const x of [position.min[0], position.max[0]])
          for (const y of [position.min[1], position.max[1]])
            for (const z of [position.min[2], position.max[2]]) {
              const p = apply(world, [x, y, z]);
              for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], p[i]);
                max[i] = Math.max(max[i], p[i]);
              }
            }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of scene.nodes) visit(root, identity);
  return { min, max, triangles, nodeNames, materialNames, roots: scene.nodes.map((i) => gltf.nodes[i].name) };
}

/** Rule violations of one model, as messages naming the file and rule. */
export function checkModel(file, type, gltf) {
  const errors = [];
  const fail = (rule, detail) => errors.push(`${file}: ${rule}: ${detail}`);
  const s = summarize(gltf);
  if (s.roots.length !== 1 || s.roots[0] !== type.id) fail("root", `expected one root node '${type.id}', got ${JSON.stringify(s.roots)}`);
  const bad = s.materialNames.filter((name) => !MATERIALS.includes(name));
  if (bad.length > 0) fail("materials", `only ${MATERIALS.join(", ")} allowed, got ${bad.join(", ")}`);
  if (TURRETED.includes(type.id) && !s.nodeNames.includes("turret")) fail("turret", "missing 'turret' node");
  const budget = BUDGETS[type.category];
  if (s.triangles > budget) fail("budget", `${s.triangles} triangles > ${budget}`);
  const [w, h, d] = type.render.size.map((v) => v / 100);
  const half = [w / 2, null, d / 2];
  for (const [axis, i] of [["x", 0], ["z", 2]]) {
    if (s.min[i] < -half[i] - EPS || s.max[i] > half[i] + EPS) fail("bounds", `${axis} [${s.min[i].toFixed(3)}, ${s.max[i].toFixed(3)}] outside ±${half[i]}`);
    if (s.max[i] - s.min[i] < FILL * 2 * half[i]) fail("fill", `${axis} extent ${(s.max[i] - s.min[i]).toFixed(3)} < ${FILL} × ${2 * half[i]}`);
  }
  if (s.min[1] < -EPS || s.max[1] > h + EPS) fail("bounds", `y [${s.min[1].toFixed(3)}, ${s.max[1].toFixed(3)}] outside [0, ${h}]`);
  return errors;
}

/** Errors and warnings for a models directory against a ruleset. */
export function checkModels(dir, ruleset, strict) {
  const errors = [];
  const warnings = [];
  const types = new Map(modelTypes(ruleset).map((t) => [t.id, t]));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".glb")).sort() : [];
  for (const file of files) {
    const type = types.get(file.slice(0, -4));
    if (!type) {
      errors.push(`${file}: unknown type: not a unit, building or depot of the ruleset`);
      continue;
    }
    try {
      errors.push(...checkModel(file, type, parseGlb(readFileSync(join(dir, file)))));
    } catch (error) {
      errors.push(`${file}: parse: ${error.message}`);
    }
  }
  for (const id of types.keys()) {
    if (!files.includes(`${id}.glb`)) (strict ? errors : warnings).push(`${id}.glb: missing`);
  }
  return { errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const ruleset = JSON.parse(readFileSync(join(root, "data", "generated", "ruleset.json"), "utf8"));
  const { errors, warnings } = checkModels(join(root, "client", "public", "models"), ruleset, process.argv.includes("--strict"));
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(errors.length > 0 ? 1 : 0);
}
