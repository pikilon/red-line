import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  Shape,
  SphereGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { setDeckHeights } from "../../elevation";
import type { FeatureContext, FeatureInstance } from "../layers";
import { registerFeatureRenderer } from "../registry";

/** Spec 26 phase 4: procedural harbour props (family `port`).
 *
 *  Every model is a handful of boxes, cylinders and extruded hulls built in
 *  local tile units (origin at the centre of the rot 0 footprint on the
 *  ground, +x across the width, +z along the depth, +y up), tinted with
 *  vertex colours and merged. All instances of the family become two meshes:
 *  one lit mesh and one unlit mesh for lamps and the lantern. */

type Part = { geometry: BufferGeometry; glow: boolean };
/** Models push parts into this list. */
type Parts = Part[];

const col = (hex: string): Color => new Color(hex);

/** Writes a flat colour per vertex, darker at the foot of the part so stacked
 *  shapes keep readable edges, and drops the uv so every part merges. */
function finish(
  source: BufferGeometry,
  colour: Color,
  y0: number,
  height: number,
): BufferGeometry {
  const geometry =
    source.index !== null ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute("uv");
  const position = geometry.getAttribute("position");
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = height > 0 ? (position.getY(i) - y0) / height : 1;
    const shade = 0.8 + 0.2 * Math.min(1, Math.max(0, t));
    colours[i * 3] = colour.r * shade;
    colours[i * 3 + 1] = colour.g * shade;
    colours[i * 3 + 2] = colour.b * shade;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  return geometry;
}

/** Box with its base centre at (x, y, z). */
function box(
  parts: Parts,
  colour: Color,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  glow = false,
): void {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  parts.push({ geometry: finish(g, colour, y, h), glow });
}

/** Cylinder or cone (radiusTop 0) with its base centre at (x, y, z). */
function cyl(
  parts: Parts,
  colour: Color,
  x: number,
  y: number,
  z: number,
  rTop: number,
  rBottom: number,
  h: number,
  segments = 10,
  glow = false,
): void {
  const g = new CylinderGeometry(rTop, rBottom, h, segments, 1);
  g.translate(x, y + h / 2, z);
  parts.push({ geometry: finish(g, colour, y, h), glow });
}

function ball(
  parts: Parts,
  colour: Color,
  x: number,
  y: number,
  z: number,
  r: number,
  glow = false,
): void {
  const g = new SphereGeometry(r, 8, 6);
  g.translate(x, y, z);
  parts.push({ geometry: finish(g, colour, y - r, r * 2), glow });
}

/** A plan outline [x, z] extruded straight up from y (hulls). */
function prism(
  parts: Parts,
  colour: Color,
  plan: readonly (readonly [number, number])[],
  y: number,
  h: number,
): void {
  const shape = new Shape();
  plan.forEach(([px, pz], i) => {
    // rotateX(-90deg) below maps shape y to -z.
    if (i === 0) shape.moveTo(px, -pz);
    else shape.lineTo(px, -pz);
  });
  const g = new ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  parts.push({ geometry: finish(g, colour, y, h), glow: false });
}

/** Gable roof: ridge along x when `alongX`, otherwise along z. */
function gable(
  parts: Parts,
  colour: Color,
  x: number,
  y: number,
  z: number,
  span: number,
  length: number,
  rise: number,
  alongX: boolean,
): void {
  const shape = new Shape();
  shape.moveTo(-span / 2, 0);
  shape.lineTo(span / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  g.translate(0, 0, -length / 2);
  if (alongX) g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  parts.push({ geometry: finish(g, colour, y, rise), glow: false });
}

const DARK = col("#2b2e33");
const CONCRETE = col("#b3b1a8");
const WOOD = col("#8a6a45");
const WOOD_DARK = col("#5f4a31");
const WHITE = col("#e6e8ea");
const YELLOW = col("#d9b02a");
const LAMP = col("#ffe9a8");
const GLASS = col("#2c4a63");
const CONTAINER_COLOURS = [
  "#b5392d",
  "#2f5f9a",
  "#d9822b",
  "#3c7a52",
  "#c9ccd0",
  "#d8b53a",
].map(col);

/** Hash of small integers for deterministic variation. */
const mix = (a: number, b: number): number =>
  (Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 1597334677)) >>> 0;

/** Pier plank top above its base (deck box top plus the seams). */
const PIER_DECK_Y = 0.3;
const PIER_SURFACE = PIER_DECK_Y + 0.05;

function pier(parts: Parts, v: number): void {
  const len = 5.9;
  const deckY = PIER_DECK_Y;
  box(parts, WOOD, 0, deckY - 0.06, 0, 1.7, 0.1, len);
  // Plank seams.
  for (let i = 0; i < 12; i++) {
    box(
      parts,
      WOOD_DARK,
      0,
      deckY + 0.04,
      -len / 2 + 0.25 + i * 0.5,
      1.7,
      0.01,
      0.04,
    );
  }
  // Piles and rails under the deck.
  for (let i = 0; i < 4; i++) {
    const z = -len / 2 + 0.4 + i * 1.7;
    for (const x of [-0.75, 0.75])
      cyl(parts, WOOD_DARK, x, -0.55, z, 0.07, 0.07, 0.9, 6);
  }
  box(parts, WOOD_DARK, -0.8, deckY - 0.12, 0, 0.06, 0.07, len);
  box(parts, WOOD_DARK, 0.8, deckY - 0.12, 0, 0.06, 0.07, len);
  // Bollards.
  for (const z of [-2.2, 0.2, 2.4]) {
    cyl(parts, DARK, -0.7, deckY + 0.04, z, 0.05, 0.07, 0.14, 6);
  }
  if (v === 1) {
    // Lamp post at the far end, crates and a coil of rope.
    cyl(parts, DARK, 0.7, deckY + 0.04, len / 2 - 0.3, 0.025, 0.035, 0.85, 6);
    ball(parts, LAMP, 0.7, deckY + 0.92, len / 2 - 0.3, 0.07, true);
    box(parts, WOOD_DARK, -0.4, deckY + 0.04, -1.2, 0.4, 0.3, 0.4);
    box(parts, WOOD, -0.35, deckY + 0.34, -1.2, 0.3, 0.22, 0.3);
    cyl(parts, col("#c7b27e"), 0.4, deckY + 0.04, -0.2, 0.17, 0.17, 0.08, 10);
  }
}

function quay(parts: Parts, v: number): void {
  box(parts, CONCRETE, 0, 0, 0, 3.96, 0.2, 1.96);
  // Painted edge on the water side (+z) and expansion joints.
  for (let i = 0; i < 7; i++) {
    box(parts, YELLOW, -1.6 + i * 0.53, 0.2, 0.85, 0.3, 0.01, 0.1);
  }
  for (const x of [-1, 0, 1])
    box(parts, col("#8f8d86"), x, 0.2, 0, 0.03, 0.01, 1.96);
  for (const x of [-1.5, 0, 1.5])
    cyl(parts, DARK, x, 0.2, 0.7, 0.07, 0.09, 0.17, 7);
  if (v === 1) {
    // Tyre fenders and a pallet stack.
    for (let i = 0; i < 4; i++)
      cyl(parts, col("#1d1f22"), -1.5 + i, 0.05, 1.03, 0.1, 0.1, 0.16, 8);
    box(parts, WOOD, -1.1, 0.2, -0.3, 0.6, 0.1, 0.6);
    box(parts, col("#c9b88d"), -1.1, 0.3, -0.3, 0.5, 0.35, 0.5);
    box(parts, WOOD, 1.1, 0.2, -0.4, 0.6, 0.1, 0.5);
    box(parts, col("#9aa3ab"), 1.1, 0.3, -0.4, 0.5, 0.3, 0.4);
  }
}

function dockCrane(parts: Parts, v: number): void {
  const body = v === 0 ? col("#c8402f") : col("#d9a520");
  const trim = v === 0 ? WHITE : col("#2f5f9a");
  const h = 2.6;
  // Rails and four legs.
  box(parts, DARK, 0, 0, -1.2, 2.9, 0.1, 0.16);
  box(parts, DARK, 0, 0, 1.2, 2.9, 0.1, 0.16);
  for (const x of [-1.2, 1.2]) {
    for (const z of [-1.2, 1.2]) box(parts, body, x, 0.1, z, 0.16, h, 0.16);
    box(parts, body, x, 0.9, 0, 0.1, 0.1, 2.4);
    box(parts, body, x, 1.7, 0, 0.1, 0.1, 2.4);
  }
  // Portal beams on top.
  box(parts, body, 0, h, -1.2, 2.56, 0.16, 0.16);
  box(parts, body, 0, h, 1.2, 2.56, 0.16, 0.16);
  box(parts, trim, 0, h + 0.14, 0, 2.5, 0.12, 0.7);
  // Boom reaching out over the water (+z) and the back stay.
  box(parts, body, 0, h + 0.26, 1.1, 0.36, 0.2, 4.4);
  box(parts, body, 0, h + 0.26, -1.6, 0.3, 0.2, 1.2);
  box(parts, trim, 0, h + 0.46, 1.1, 0.14, 0.12, 4.0);
  box(parts, DARK, 0, h + 0.26, -2.2, 0.5, 0.3, 0.3);
  // Trolley with cab, hoist cable and spreader.
  box(parts, trim, 0, h + 0.06, 2.3, 0.5, 0.2, 0.5);
  box(parts, GLASS, 0, h - 0.4, 2.3, 0.4, 0.4, 0.4);
  box(parts, DARK, 0, h - 1.0, 2.3, 0.025, 0.65, 0.025);
  box(parts, DARK, 0.05, h - 1.2, 2.3, 0.3, 0.1, 0.5);
  if (v === 1)
    box(
      parts,
      CONTAINER_COLOURS[1] ?? DARK,
      0.05,
      h - 1.5,
      2.3,
      0.3,
      0.3,
      0.55,
    );
  // Machinery house.
  box(parts, trim, 0, h + 0.3, -0.55, 0.9, 0.3, 0.6);
}

function warehouse(parts: Parts, v: number): void {
  const walls =
    [col("#6d7f8f"), col("#b09a78"), col("#6a8068")][v % 3] ?? CONCRETE;
  const roof = [col("#4b5560"), col("#7a4b3a"), col("#505a50")][v % 3] ?? DARK;
  box(parts, CONCRETE, 0, 0, 0, 3.9, 0.12, 2.9);
  box(parts, walls, 0, 0.12, 0, 3.7, 1.05, 2.7);
  gable(parts, roof, 0, 1.17, 0, 2.9, 3.9, 0.55, true);
  // Big sliding door and small door on the long face (+z).
  box(parts, DARK, -0.5, 0.12, 1.36, 1.5, 0.85, 0.05);
  box(parts, YELLOW, -0.5, 0.97, 1.37, 1.6, 0.06, 0.05);
  box(parts, col("#4a4d52"), 1.2, 0.12, 1.36, 0.45, 0.7, 0.05);
  // High window strip.
  for (let i = 0; i < 4; i++)
    box(parts, GLASS, -1.4 + i * 0.9, 0.82, 1.37, 0.5, 0.18, 0.04);
  // Roof vent and a loading ledge at the back.
  box(parts, DARK, 0.8, 1.55, 0, 0.5, 0.18, 0.3);
  box(parts, CONCRETE, 0, 0.12, -1.5, 3.2, 0.14, 0.2);
  if (v === 2) cyl(parts, col("#9aa3ab"), -1.6, 0.12, -1.2, 0.3, 0.3, 1.2, 10);
}

function containerStack(parts: Parts, v: number): void {
  const cl = 1.25;
  const cw = 0.5;
  const ch = 0.46;
  let n = 0;
  for (const [x, z, levels] of [
    [-0.7, -0.5, 3 - (v % 2)],
    [0.7, -0.5, 2 + (v % 2)],
    [-0.7, 0.5, 2],
    [0.7, 0.5, 1 + ((v + 1) % 3)],
  ] as const) {
    for (let level = 0; level < levels; level++) {
      const colour =
        CONTAINER_COLOURS[mix(v, n++) % CONTAINER_COLOURS.length] ?? WHITE;
      const y = level * ch;
      box(parts, colour, x, y, z, cl, ch - 0.01, cw);
      for (let r = 0; r < 4; r++) {
        for (const side of [-1, 1]) {
          box(
            parts,
            DARK,
            x - 0.45 + r * 0.3,
            y + 0.04,
            z + side * (cw / 2 + 0.005),
            0.025,
            ch - 0.1,
            0.01,
          );
        }
      }
    }
  }
}

function fishingBoat(parts: Parts, v: number): void {
  const hull = v === 0 ? col("#2f5f9a") : col("#b5392d");
  const y0 = -0.18;
  prism(
    parts,
    hull,
    [
      [-0.4, -1.6],
      [0.4, -1.6],
      [0.5, 0.4],
      [0.0, 1.85],
      [-0.5, 0.4],
    ],
    y0,
    0.4,
  );
  prism(
    parts,
    WHITE,
    [
      [-0.44, -1.62],
      [0.44, -1.62],
      [0.52, 0.4],
      [0.0, 1.9],
      [-0.52, 0.4],
    ],
    y0 + 0.4,
    0.07,
  );
  box(parts, WOOD, 0, y0 + 0.4, -0.2, 0.8, 0.02, 2.2);
  // Wheelhouse near the stern, mast and boom, nets and crates.
  box(parts, WHITE, 0, y0 + 0.42, -1.0, 0.6, 0.5, 0.7);
  box(parts, GLASS, 0, y0 + 0.62, -0.64, 0.5, 0.16, 0.02);
  box(parts, col("#9aa3ab"), 0, y0 + 0.92, -1.0, 0.66, 0.05, 0.76);
  cyl(parts, DARK, 0, y0 + 0.97, 0.3, 0.025, 0.03, 1.1, 6);
  box(parts, DARK, 0, y0 + 1.5, 0.3, 0.02, 0.02, 0.9);
  cyl(parts, DARK, 0, y0 + 1.97, -1.0, 0.012, 0.012, 0.25, 4);
  box(parts, col("#c7b27e"), -0.2, y0 + 0.42, 0.7, 0.3, 0.14, 0.4);
  box(parts, WOOD, 0.22, y0 + 0.42, 0.55, 0.26, 0.2, 0.26);
  if (v === 1)
    cyl(parts, col("#d9822b"), 0.2, y0 + 0.42, -0.1, 0.1, 0.1, 0.16, 8);
}

function cargoShip(parts: Parts, v: number): void {
  const lower = v === 0 ? col("#7a2a24") : col("#243b5a");
  const upper = col("#262c34");
  const y0 = -0.35;
  const plan = (g: number): [number, number][] => [
    [-0.95 - g, -4.2 - g],
    [0.95 + g, -4.2 - g],
    [1.05 + g, 2.4],
    [0.6, 3.6],
    [0.0, 4.4 + g],
    [-0.6, 3.6],
    [-1.05 - g, 2.4],
  ];
  prism(parts, lower, plan(0), y0, 0.5);
  prism(parts, upper, plan(0.04), y0 + 0.5, 0.7);
  box(parts, col("#6b7078"), 0, y0 + 1.2, 0, 1.9, 0.02, 7.6);
  // Stern superstructure: three decks, bridge windows, funnel, mast.
  box(parts, WHITE, 0, y0 + 1.2, -3.0, 1.7, 0.5, 1.5);
  box(parts, WHITE, 0, y0 + 1.7, -3.1, 1.5, 0.4, 1.2);
  box(parts, WHITE, 0, y0 + 2.1, -3.1, 1.7, 0.3, 0.9);
  box(parts, GLASS, 0, y0 + 2.12, -2.64, 1.5, 0.16, 0.03);
  box(parts, GLASS, 0, y0 + 1.82, -2.5, 1.2, 0.14, 0.03);
  cyl(parts, lower, 0, y0 + 1.7, -3.6, 0.2, 0.25, 0.75, 8);
  cyl(parts, DARK, 0, y0 + 2.4, -3.6, 0.21, 0.21, 0.08, 8);
  cyl(parts, DARK, 0, y0 + 2.4, -2.9, 0.02, 0.03, 0.6, 5);
  // Deck cargo: containers in two bays; variant 1 has one empty bay and a crane.
  let n = 0;
  for (const z of [-1.4, -0.2, 1.0, 2.2]) {
    if (v === 1 && z === 1.0) continue;
    for (const x of [-0.5, 0.5]) {
      const levels = 1 + (mix(v, n) % 3);
      for (let level = 0; level < levels; level++) {
        const colour =
          CONTAINER_COLOURS[mix(v + 3, n++) % CONTAINER_COLOURS.length] ??
          WHITE;
        box(parts, colour, x, y0 + 1.22 + level * 0.4, z, 0.8, 0.39, 1.1);
      }
    }
  }
  if (v === 1) {
    box(parts, YELLOW, -0.85, y0 + 1.22, 1.0, 0.1, 0.9, 0.1);
    box(parts, YELLOW, 0.85, y0 + 1.22, 1.0, 0.1, 0.9, 0.1);
    box(parts, YELLOW, 0, y0 + 2.1, 1.0, 1.8, 0.1, 0.1);
  }
  // Bow mast and rails.
  cyl(parts, DARK, 0, y0 + 1.2, 3.2, 0.03, 0.04, 0.8, 5);
}

function buoy(parts: Parts, v: number): void {
  const body = v === 0 ? col("#c4352b") : col("#2f8a4a");
  cyl(parts, DARK, 0, -0.25, 0, 0.02, 0.02, 0.2, 4);
  cyl(parts, body, 0, -0.08, 0, 0.17, 0.2, 0.2, 10);
  cyl(parts, WHITE, 0, 0.12, 0, 0.15, 0.17, 0.1, 10);
  cyl(parts, body, 0, 0.22, 0, 0.1, 0.15, 0.15, 10);
  cyl(parts, DARK, 0, 0.37, 0, 0.02, 0.02, 0.2, 5);
  ball(parts, v === 0 ? col("#ff6a4d") : LAMP, 0, 0.6, 0, 0.06, true);
}

function lighthouse(parts: Parts, v: number): void {
  const a = v === 0 ? col("#c4352b") : col("#1f2429");
  const b = WHITE;
  cyl(parts, col("#8f8d86"), 0, 0, 0, 0.8, 0.9, 0.3, 10);
  cyl(parts, col("#a09d94"), 0, 0.3, 0, 0.62, 0.74, 0.18, 10);
  const bands = 5;
  const rise = 3.2;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const r = (t: number): number => 0.58 - 0.2 * t;
    cyl(
      parts,
      i % 2 === 0 ? b : a,
      0,
      0.48 + t0 * rise,
      0,
      r(t1),
      r(t0),
      rise / bands,
      12,
    );
  }
  const top = 0.48 + rise;
  box(parts, DARK, 0, 0.48, 0.55, 0.22, 0.4, 0.05);
  cyl(parts, DARK, 0, top, 0, 0.5, 0.42, 0.1, 12);
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    cyl(
      parts,
      DARK,
      Math.cos(ang) * 0.46,
      top + 0.1,
      Math.sin(ang) * 0.46,
      0.015,
      0.015,
      0.22,
      4,
    );
  }
  cyl(parts, LAMP, 0, top + 0.1, 0, 0.24, 0.24, 0.38, 10, true);
  cyl(parts, a, 0, top + 0.48, 0, 0.0, 0.34, 0.32, 10);
  ball(parts, DARK, 0, top + 0.82, 0, 0.05);
}

const MODELS: Record<string, (parts: Parts, variant: number) => void> = {
  pier,
  quay,
  "dock-crane": dockCrane,
  warehouse,
  "container-stack": containerStack,
  "fishing-boat": fishingBoat,
  "cargo-ship": cargoShip,
  buoy,
  lighthouse,
};

/** Kinds that float or stand in the water: their local y 0 is the water surface. */
const ON_WATER = new Set(["pier", "fishing-boat", "cargo-ship", "buoy"]);
const WATER_LIFT = 0.06;

const kindOf = (instance: FeatureInstance): string => {
  const written = instance.type.render.kind;
  return typeof written === "string" ? written : instance.type.id;
};

/** Y of local 0 for an instance: the water surface for floating props, the
 *  lowest ground corner under the footprint for everything else. */
function baseHeight(instance: FeatureInstance, ctx: FeatureContext): number {
  if (ON_WATER.has(kindOf(instance))) {
    let top = Number.NEGATIVE_INFINITY;
    for (let cy = instance.y; cy <= instance.y + instance.height; cy++) {
      for (let cx = instance.x; cx <= instance.x + instance.width; cx++) {
        top = Math.max(top, ctx.elevation.corner(cx, cy));
      }
    }
    return top + WATER_LIFT;
  }
  let ground = Number.POSITIVE_INFINITY;
  for (let cy = instance.y; cy <= instance.y + instance.height; cy++) {
    for (let cx = instance.x; cx <= instance.x + instance.width; cx++) {
      ground = Math.min(ground, ctx.elevation.corner(cx, cy));
    }
  }
  return ground;
}

/** Builds the unlit and lit geometry of every instance (exported for tests). */
export function portGeometries(
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
): { solid: BufferGeometry | null; glow: BufferGeometry | null } {
  const solid: BufferGeometry[] = [];
  const glow: BufferGeometry[] = [];
  const matrix = new Matrix4();
  for (const instance of instances) {
    const model = MODELS[kindOf(instance)];
    if (model === undefined) continue;
    const parts: Parts = [];
    model(parts, instance.variant);
    // Local models use the rot 0 footprint; turn them about the centre.
    matrix
      .makeRotationY((-instance.rot * Math.PI) / 2)
      .setPosition(
        instance.x + instance.width / 2,
        baseHeight(instance, ctx),
        instance.y + instance.height / 2,
      );
    for (const part of parts) {
      part.geometry.applyMatrix4(matrix);
      (part.glow ? glow : solid).push(part.geometry);
    }
  }
  return {
    solid: solid.length > 0 ? mergeGeometries(solid, false) : null,
    glow: glow.length > 0 ? mergeGeometries(glow, false) : null,
  };
}

/** Spec 32: the plank surface of every pier, so units walking out on one
 *  stand on the deck they see instead of in the water under it. */
export function pierSurface(
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
): ((x: number, y: number) => number | null) | null {
  const decks = instances
    .filter((instance) => kindOf(instance) === "pier")
    .map((instance) => ({
      x0: instance.x,
      y0: instance.y,
      x1: instance.x + instance.width,
      y1: instance.y + instance.height,
      top: baseHeight(instance, ctx) + PIER_SURFACE,
    }));
  if (decks.length === 0) return null;
  return (x, y) => {
    for (const deck of decks) {
      if (x >= deck.x0 && y >= deck.y0 && x < deck.x1 && y < deck.y1) {
        return deck.top;
      }
    }
    return null;
  };
}

export function createPorts(
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
): Object3D {
  const group = new Group();
  group.name = "features-port";
  setDeckHeights(pierSurface(instances, ctx), "pier");
  const { solid, glow } = portGeometries(instances, ctx);
  if (solid !== null) {
    const mesh = new Mesh(
      solid,
      new MeshLambertMaterial({ vertexColors: true }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "port-solid";
    group.add(mesh);
  }
  if (glow !== null) {
    const mesh = new Mesh(glow, new MeshBasicMaterial({ vertexColors: true }));
    mesh.name = "port-lights";
    group.add(mesh);
  }
  return group;
}

registerFeatureRenderer("port", createPorts);
