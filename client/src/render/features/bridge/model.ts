import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Path,
  Shape,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Deck } from "./deck";

/** Spec 26 section 17: procedural bridge models.
 *
 *  A model is built in local deck units: `u` along the deck (0..length),
 *  `v` across it (0..width), `y` up from the ground under the deck. The
 *  parts carry vertex colours and merge into one geometry per map, so every
 *  bridge on a map costs one draw call. Upward faces whiten with `snow`. */

const col = (hex: string): Color => new Color(hex);
const SNOW_WHITE = col("#eef3f7");

const ASPHALT = col("#4b4d52");
const DASH = col("#d8c76a");
const CONCRETE = col("#b3b1a8");
const CONCRETE_DARK = col("#8c8a83");
const STEEL = col("#59636d");
const STEEL_LIGHT = col("#8a96a1");
const PLANK = col("#8f6c45");
const PLANK_DARK = col("#6d5034");
const WOOD_POST = col("#5b4630");
const ROPE = col("#b79c6a");
const STONE = col("#9a8f7c");
const STONE_DARK = col("#7a705f");
const STONE_CAP = col("#b3a891");

/** Hash of small integers for deterministic variation. */
const mix = (a: number, b: number): number =>
  (Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 1597334677)) >>> 0;

type Parts = BufferGeometry[];

/** Flat colour per vertex (darker at the foot), snow on upward faces; the uv
 *  goes so every part merges. */
function finish(
  source: BufferGeometry,
  colour: Color,
  snow: number,
): BufferGeometry {
  const geometry =
    source.index !== null ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute("uv");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const y0 = box?.min.y ?? 0;
  const span = Math.max(0.0001, (box?.max.y ?? 1) - y0);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const colours = new Float32Array(position.count * 3);
  const mixed = new Color();
  for (let i = 0; i < position.count; i++) {
    const shade = 0.82 + 0.18 * ((position.getY(i) - y0) / span);
    mixed.copy(colour).multiplyScalar(shade);
    if (snow > 0 && normal !== undefined && normal.getY(i) > 0.7) {
      mixed.lerp(SNOW_WHITE, snow);
    }
    colours[i * 3] = mixed.r;
    colours[i * 3 + 1] = mixed.g;
    colours[i * 3 + 2] = mixed.b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  return geometry;
}

interface Kit {
  readonly parts: Parts;
  readonly snow: number;
  /** Axis-aligned box from (u0, y0, v0) to (u1, y1, v1). */
  box(
    colour: Color,
    u0: number,
    y0: number,
    v0: number,
    u1: number,
    y1: number,
    v1: number,
  ): void;
  /** Vertical cylinder (a pile or a pylon) centred at (u, v) from y0 up. */
  post(
    colour: Color,
    u: number,
    v: number,
    y0: number,
    y1: number,
    radius: number,
  ): void;
  /** A (u, y) outline extruded across v0..v1, holes cut through. */
  slab(
    colour: Color,
    outline: readonly (readonly [number, number])[],
    v0: number,
    v1: number,
    holes?: readonly Path[],
  ): void;
}

function kit(snow: number): Kit {
  const parts: Parts = [];
  return {
    parts,
    snow,
    box(colour, u0, y0, v0, u1, y1, v1) {
      const g = new BoxGeometry(u1 - u0, y1 - y0, v1 - v0);
      g.translate((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
      parts.push(finish(g, colour, snow));
    },
    post(colour, u, v, y0, y1, radius) {
      const g = new CylinderGeometry(radius, radius * 1.1, y1 - y0, 7, 1);
      g.translate(u, (y0 + y1) / 2, v);
      parts.push(finish(g, colour, snow));
    },
    slab(colour, outline, v0, v1, holes = []) {
      const shape = new Shape();
      outline.forEach(([u, y], i) => {
        if (i === 0) shape.moveTo(u, y);
        else shape.lineTo(u, y);
      });
      shape.closePath();
      shape.holes.push(...holes);
      const g = new ExtrudeGeometry(shape, {
        depth: v1 - v0,
        bevelEnabled: false,
        curveSegments: 8,
      });
      g.translate(0, 0, v0);
      parts.push(finish(g, colour, snow));
    },
  };
}

/** The deck outline in (u, y): climbs over `ramp` tiles at both ends to
 *  `height`, `thick` thick, level with the ground at the very ends. */
function deckOutline(
  deck: Deck,
  thick: number,
): readonly (readonly [number, number])[] {
  const { length: L, height: h, ramp: r } = deck;
  return [
    [0, 0],
    [r, h],
    [L - r, h],
    [L, 0],
    [L - r, h - thick],
    [r, h - thick],
  ];
}

/** Surface height at `u` along the deck. */
const surfaceAt = (deck: Deck, u: number): number =>
  deck.height * Math.min(1, Math.min(u, deck.length - u) / deck.ramp);

/** A rail along both long edges that follows the ramps: posts every `step`
 *  tiles plus one long bar per flat section and two sloped end bars. */
function rails(
  k: Kit,
  deck: Deck,
  opts: {
    post: Color;
    bar: Color;
    inset: number;
    postHeight: number;
    step: number;
    barHeight: number;
    barThick: number;
    postThick: number;
  },
): void {
  const { length: L, width: W, ramp: r } = deck;
  for (const v of [opts.inset, W - opts.inset]) {
    for (let u = 0.5; u < L; u += opts.step) {
      const y = surfaceAt(deck, u);
      k.box(
        opts.post,
        u - opts.postThick / 2,
        y,
        v - opts.postThick / 2,
        u + opts.postThick / 2,
        y + opts.postHeight,
        v + opts.postThick / 2,
      );
    }
    const top = deck.height + opts.barHeight;
    k.box(
      opts.bar,
      r,
      top,
      v - opts.barThick / 2,
      L - r,
      top + opts.barThick,
      v + opts.barThick / 2,
    );
    // The sloped end bars as a thin extruded wedge.
    for (const [a, b] of [
      [0.5, r],
      [L - r, L - 0.5],
    ] as const) {
      const ya = surfaceAt(deck, a) + opts.barHeight;
      const yb = surfaceAt(deck, b) + opts.barHeight;
      k.slab(
        opts.bar,
        [
          [a, ya],
          [b, yb],
          [b, yb + opts.barThick],
          [a, ya + opts.barThick],
        ],
        v - opts.barThick / 2,
        v + opts.barThick / 2,
      );
    }
  }
}

/** Two lanes of asphalt on concrete and steel: girders, pylons, barriers. */
function roadBridge(k: Kit, deck: Deck, variant: number): void {
  const { length: L, width: W, height: h, ramp: r } = deck;
  const thick = 0.14;
  // Concrete deck slab with the asphalt wearing course on top.
  k.slab(CONCRETE, deckOutline(deck, thick), 0, W);
  k.slab(
    ASPHALT,
    [
      [0, 0.01],
      [r, h + 0.012],
      [L - r, h + 0.012],
      [L, 0.01],
      [L - r, h],
      [r, h],
    ],
    0.16,
    W - 0.16,
  );
  // Dashed centre line on the flat part.
  for (let u = r + 0.3; u + 0.35 < L - r; u += 0.8) {
    k.box(DASH, u, h + 0.014, W / 2 - 0.025, u + 0.35, h + 0.02, W / 2 + 0.025);
  }
  // Steel girders under the deck, one per side and one in the middle.
  for (const v of [0.2, W / 2, W - 0.2]) {
    k.box(STEEL, r, h - thick - 0.16, v - 0.05, L - r, h - thick, v + 0.05);
  }
  // Pylons into the water: every 2.5 tiles of the flat part.
  const spans = Math.max(1, Math.round((L - 2 * r) / 2.5));
  for (let i = 0; i <= spans; i++) {
    const u = r + ((L - 2 * r) * i) / spans;
    for (const v of [0.35, W - 0.35]) {
      k.post(CONCRETE_DARK, u, v, -0.3, h - thick, 0.13);
    }
    k.box(
      CONCRETE_DARK,
      u - 0.12,
      h - thick - 0.07,
      0.1,
      u + 0.12,
      h - thick,
      W - 0.1,
    );
  }
  // Barriers and a steel rail on top. Variant 1 swaps the rail for a lattice of posts.
  for (const v of [0.08, W - 0.08]) {
    k.box(CONCRETE, r, h, v - 0.08, L - r, h + 0.14, v + 0.08);
  }
  rails(k, deck, {
    post: STEEL_LIGHT,
    bar: STEEL_LIGHT,
    inset: 0.08,
    postHeight: 0.32,
    step: variant === 1 ? 0.5 : 1,
    barHeight: 0.3,
    barThick: 0.05,
    postThick: 0.05,
  });
}

/** One lane of planks on wooden piles with rope rails. */
function woodenBridge(k: Kit, deck: Deck, variant: number): void {
  const { length: L, width: W, height: h, ramp: r } = deck;
  const thick = 0.08;
  // Stringers carry the planks; the planks are loose boxes with varied shade.
  k.slab(PLANK_DARK, deckOutline(deck, thick), 0.1, W - 0.1);
  const plankWidth = 0.22;
  for (let i = 0; Math.floor(i * plankWidth * 100) < Math.floor(L * 100); i++) {
    const u0 = i * plankWidth;
    const u1 = Math.min(L, u0 + plankWidth - 0.02);
    if (u1 <= u0) break;
    const mid = (u0 + u1) / 2;
    const y = surfaceAt(deck, mid);
    const jitter = (mix(i, variant) % 7) * 0.004;
    k.box(
      mix(i, 3) % 3 === 0 ? PLANK_DARK : PLANK,
      u0,
      y - 0.02,
      0.04,
      u1,
      y + 0.02 + jitter,
      W - 0.04,
    );
  }
  // Pairs of piles every 2 tiles of the flat part.
  const spans = Math.max(1, Math.round((L - 2 * r) / 2));
  for (let i = 0; i <= spans; i++) {
    const u = r + ((L - 2 * r) * i) / spans;
    for (const v of [0.18, W - 0.18]) k.post(WOOD_POST, u, v, -0.3, h, 0.07);
    k.box(
      WOOD_POST,
      u - 0.05,
      h - thick - 0.06,
      0.1,
      u + 0.05,
      h - thick,
      W - 0.1,
    );
  }
  // Rope rails: posts every tile, two ropes strung between them.
  rails(k, deck, {
    post: WOOD_POST,
    bar: ROPE,
    inset: 0.05,
    postHeight: 0.38,
    step: 1,
    barHeight: 0.32,
    barThick: 0.025,
    postThick: 0.06,
  });
  for (const v of [0.05, W - 0.05]) {
    k.box(ROPE, r, h + 0.17, v - 0.012, L - r, h + 0.2, v + 0.012);
  }
}

/** A stone viaduct: solid ramps, arches under the flat part, parapets. */
function stoneArch(k: Kit, deck: Deck, variant: number): void {
  const { length: L, width: W, height: h, ramp: r } = deck;
  const thick = 0.2;
  const flat = L - 2 * r;
  const pier = 0.4;
  const count = Math.max(1, Math.round((flat - pier) / 1.4));
  const arch = (flat - (count + 1) * pier) / count;
  const holes: Path[] = [];
  for (let i = 0; i < count; i++) {
    const left = r + pier + i * (arch + pier);
    const centre = left + arch / 2;
    const hole = new Path();
    const springing = 0.04;
    const radius = arch / 2;
    hole.moveTo(left, -0.1);
    hole.lineTo(left, springing);
    hole.absarc(centre, springing, radius, Math.PI, 0, true);
    hole.lineTo(left + arch, -0.1);
    hole.closePath();
    holes.push(hole);
  }
  // The body: the deck outline closed down to the ground, arches cut out.
  k.slab(
    STONE,
    [
      [0, 0],
      [r, h],
      [L - r, h],
      [L, 0],
      [L, -0.2],
      [0, -0.2],
    ],
    0.05,
    W - 0.05,
    holes,
  );
  // A lighter voussoir ring around every arch on both faces, so the openings read from the camera.
  for (let i = 0; i < count; i++) {
    const centre = r + pier + i * (arch + pier) + arch / 2;
    const inner = arch / 2;
    const outer = inner + 0.09;
    const ring: [number, number][] = [];
    const steps = 10;
    for (let j = 0; j <= steps; j++) {
      const a = Math.PI - (Math.PI * j) / steps;
      ring.push([centre + Math.cos(a) * outer, 0.04 + Math.sin(a) * outer]);
    }
    for (let j = steps; j >= 0; j--) {
      const a = Math.PI - (Math.PI * j) / steps;
      ring.push([centre + Math.cos(a) * inner, 0.04 + Math.sin(a) * inner]);
    }
    for (const [v0, v1] of [
      [0.01, 0.07],
      [W - 0.07, W - 0.01],
    ] as const) {
      k.slab(STONE_CAP, ring, v0, v1);
    }
  }
  // Stone courses: slightly darker bands on both faces break the flat wall.
  for (const v of [0.02, W - 0.02]) {
    for (let i = 0; i <= count; i++) {
      const u = r + i * (arch + pier);
      k.box(STONE_DARK, u, 0, v - 0.04, u + pier, h - thick * 0.6, v + 0.04);
    }
    k.box(
      STONE_CAP,
      r,
      h - thick * 0.6,
      v - 0.06,
      L - r,
      h - thick * 0.6 + 0.07,
      v + 0.06,
    );
  }
  // Parapet walls with a capstone, following the ramps.
  for (const v of [0.12, W - 0.12]) {
    k.box(STONE, r, h, v - 0.1, L - r, h + 0.22, v + 0.1);
    k.box(STONE_CAP, r, h + 0.22, v - 0.13, L - r, h + 0.27, v + 0.13);
    for (const [a, b] of [
      [0, r],
      [L - r, L],
    ] as const) {
      const ya = surfaceAt(deck, a);
      const yb = surfaceAt(deck, b);
      k.slab(
        STONE,
        [
          [a, ya],
          [b, yb],
          [b, yb + 0.27],
          [a, ya + 0.27],
        ],
        v - 0.1,
        v + 0.1,
      );
    }
    // Variant 1 puts a round finial post at each end of the flat part.
    if (variant === 1) {
      for (const u of [r, L - r]) k.post(STONE_CAP, u, v, h, h + 0.4, 0.12);
    }
  }
}

type Model = (k: Kit, deck: Deck, variant: number) => void;

const MODELS: Record<string, Model> = {
  "road-bridge": roadBridge,
  "wooden-bridge": woodenBridge,
  "stone-arch": stoneArch,
};

export interface BridgeBuild {
  readonly deck: Deck;
  readonly kind: string;
  readonly variant: number;
}

/** The merged geometry of every bridge (null without any), in world tiles.
 *  `snow` 0..1 whitens upward faces. */
export function bridgeGeometry(
  bridges: readonly BridgeBuild[],
  snow: number,
): BufferGeometry | null {
  const merged: BufferGeometry[] = [];
  const matrix = new Matrix4();
  for (const { deck, kind, variant } of bridges) {
    const model = MODELS[kind];
    if (model === undefined) continue;
    const k = kit(snow);
    model(k, deck, variant);
    if (deck.horizontal) {
      matrix.makeTranslation(deck.x0, deck.base, deck.y0);
    } else {
      // Local u runs along +z and local v along -x: turn a quarter about y.
      matrix
        .makeRotationY(-Math.PI / 2)
        .setPosition(deck.x0 + deck.width, deck.base, deck.y0);
    }
    for (const part of k.parts) {
      part.applyMatrix4(matrix);
      merged.push(part);
    }
  }
  return merged.length > 0 ? mergeGeometries(merged, false) : null;
}
