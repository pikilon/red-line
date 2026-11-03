import type { Build } from "./build";
import type { BuilderFn } from "./buildings";

/** Spec 26 section 5.1 and 6.6: civilian props and walls. Same local space as
 *  the buildings: a 1 x 1 cell at the origin, the long side of a fence, wall or
 *  car along local x (rot 0), the front of a bus stop at +z. */

const weeds = (
  b: Build,
  x0: number,
  x1: number,
  z: number,
  n: number,
): void => {
  for (let i = 0; i < n; i++) {
    const x = b.r(x0, x1);
    const s = b.r(0.04, 0.09);
    b.bag.box(
      x - s,
      0,
      z - s,
      x + s,
      s * 2,
      z + s,
      b.pick([0x4a6638, 0x58763e, 0x6a7a44]),
    );
  }
};

export const fence: BuilderFn = (b) => {
  const style = b.variant % 3;
  if (style === 1) {
    // Chain-link: thin posts and a pale mesh.
    const post = b.c(0x7a7e82);
    for (const x of [-0.5, 0.5])
      b.bag.box(x - 0.025, 0, -0.025, x + 0.025, 0.42, 0.025, post);
    b.bag.box(-0.5, 0.4, -0.015, 0.5, 0.425, 0.015, post);
    if (!b.wrecked) {
      const sag = b.damaged || b.abandoned ? 0.12 : 0;
      b.bag.quad2(
        [-0.5, 0.05, 0],
        [0.5, 0.05 + sag, 0],
        [0.5, 0.4, 0],
        [-0.5, 0.4, 0],
        b.c(0xb9c0c4),
      );
      if (b.damaged)
        b.bag.quad2(
          [-0.1, 0.05, 0],
          [0.2, 0.05, 0],
          [0.15, 0.3, 0],
          [-0.15, 0.25, 0],
          0x4a4e52,
        );
    } else {
      b.bag.ribbon([-0.4, 0.02, 0.1], [0.4, 0.02, -0.15], 0.1, 0x9aa0a4);
    }
    return;
  }
  const board = style === 0 ? 0xf2eee2 : 0x7a5a3c;
  const rail = b.c(style === 0 ? 0xe6e0d0 : 0x5e4630);
  for (const x of [-0.48, 0.48])
    b.bag.box(x - 0.03, 0, -0.03, x + 0.03, 0.4, 0.03, rail);
  const pickets = 8;
  const keep = b.wrecked ? 0.3 : b.damaged ? 0.75 : b.abandoned ? 0.65 : 1;
  b.bag.box(-0.5, 0.1, 0.03, 0.5, 0.15, 0.06, rail);
  b.bag.box(-0.5, 0.28, 0.03, 0.5, 0.33, 0.06, rail);
  for (let i = 0; i < pickets; i++) {
    if (b.rnd() > keep) continue;
    const x = -0.44 + (0.88 * i) / (pickets - 1);
    const h = style === 0 ? 0.38 : 0.42;
    const lean = b.damaged || b.abandoned ? b.r(-0.05, 0.05) : 0;
    b.bag.quad2(
      [x - 0.035, 0.02, 0.07],
      [x + 0.035, 0.02, 0.07],
      [x + 0.035 + lean, h, 0.07],
      [x - 0.035 + lean, h, 0.07],
      b.cj(board, 0.04),
    );
    b.bag.box(
      x - 0.035 + lean,
      h,
      0.065,
      x + 0.035 + lean,
      h + 0.012,
      0.075,
      b.c(board),
    );
  }
  if (b.wrecked)
    b.bag.ribbon([-0.4, 0.015, 0.2], [0.3, 0.015, 0.1], 0.04, b.c(board));
  if (b.abandoned) weeds(b, -0.45, 0.45, 0.12, 4);
};

export const stoneWall: BuilderFn = (b) => {
  const col = b.byVariant([0x8c877c, 0xa0583f, 0xa9a8a2]);
  const h = b.wrecked ? 0.12 : 0.3;
  b.bag.box(-0.5, 0, -0.08, 0.5, h, 0.08, b.cj(col, 0.04));
  if (!b.wrecked) b.bag.box(-0.51, h, -0.1, 0.51, h + 0.04, 0.1, b.c(0xc4c0b4));
  // Courses of stones.
  const cap = b.variant % 3 === 2 ? 0 : 3;
  for (let r = 1; r <= cap; r++)
    b.bag.box(
      -0.5,
      (h * r) / (cap + 1),
      0.081,
      0.5,
      (h * r) / (cap + 1) + 0.012,
      0.087,
      b.c(0x3a3834),
    );
  if (b.damaged)
    b.bag.box(-0.1, h * 0.55, -0.1, 0.18, h + 0.05, 0.1, b.c(0x5a554c));
  if (b.wrecked || b.damaged)
    b.rubble(
      { x0: -0.5, z0: -0.15, x1: 0.5, z1: 0.15, h: 1 },
      b.wrecked ? 9 : 4,
      [col, 0x6a655a],
    );
  if (b.abandoned) weeds(b, -0.45, 0.45, 0.1, 5);
};

export const lampPost: BuilderFn = (b) => {
  const pole = b.c(0x3f4448);
  const double = b.variant % 2 === 1;
  if (b.wrecked) {
    b.bag.ribbon([-0.4, 0.04, 0.2], [0.35, 0.05, -0.1], 0.03, pole);
    b.bag.box(0.33, 0, -0.14, 0.45, 0.07, -0.06, pole);
    b.bag.box(-0.1, 0, -0.1, 0.1, 0.05, 0.1, b.c(0x555a5e));
    return;
  }
  const lean = b.damaged ? 0.05 : 0;
  b.bag.box(-0.07, 0, -0.07, 0.07, 0.05, 0.07, b.c(0x555a5e));
  b.bag.cyl(0, 0, 0.032, 0.05, 1.0, pole, 6, 0.024);
  const head = (dx: number): void => {
    b.bag.box(
      Math.min(0, dx) - 0.02,
      0.97,
      -0.02,
      Math.max(0, dx) + 0.02,
      1.0,
      0.02,
      pole,
    );
    b.bag.box(
      dx - 0.09 + lean,
      0.93,
      -0.05,
      dx + 0.09 + lean,
      0.97,
      0.05,
      pole,
    );
    b.bag.box(
      dx - 0.07 + lean,
      0.915,
      -0.04,
      dx + 0.07 + lean,
      0.93,
      0.04,
      b.intact ? 0xfff0b0 : 0x6a6a5a,
      { glow: b.intact },
    );
  };
  head(double ? 0.2 : 0.18);
  if (double) head(-0.2);
};

const CAR_COLOURS = [0xb8342c, 0x2f5f9a, 0xe8e8e0, 0xd8b030, 0x3f7a4a];

export const car: BuilderFn = (b) => {
  const body = b.wrecked ? 0x2a2624 : b.cj(b.byVariant(CAR_COLOURS), 0.03);
  const glass = b.wrecked ? 0x151311 : 0x2a3844;
  const lift = b.abandoned ? 0.015 : 0.035;
  for (const x of [-0.26, 0.26]) {
    for (const z of [-0.17, 0.17]) {
      b.bag.box(x - 0.07, 0, z - 0.03, x + 0.07, 0.14, z + 0.03, 0x15171a);
    }
  }
  b.bag.box(-0.46, lift, -0.19, 0.46, lift + 0.14, 0.19, body);
  const roofY = lift + 0.14;
  b.bag.box(-0.2, roofY, -0.165, 0.24, roofY + 0.13, 0.165, body);
  // Glass band, a little proud of the cabin.
  b.bag.box(-0.17, roofY + 0.03, -0.17, 0.2, roofY + 0.1, 0.17, glass);
  b.bag.box(-0.22, roofY + 0.11, -0.12, 0.26, roofY + 0.135, 0.12, body);
  if (b.variant % 5 === 3)
    b.bag.box(-0.04, roofY + 0.135, -0.05, 0.04, roofY + 0.17, 0.05, 0xf4f0d0, {
      glow: b.intact,
    });
  if (!b.wrecked) {
    b.bag.box(
      0.455,
      lift + 0.05,
      -0.17,
      0.47,
      lift + 0.09,
      -0.1,
      b.abandoned ? 0x8a8a7a : 0xfff0b0,
      { glow: b.intact },
    );
    b.bag.box(
      0.455,
      lift + 0.05,
      0.1,
      0.47,
      lift + 0.09,
      0.17,
      b.abandoned ? 0x8a8a7a : 0xfff0b0,
      { glow: b.intact },
    );
    b.bag.box(-0.47, lift + 0.05, -0.17, -0.455, lift + 0.09, 0.17, 0x8a1a14);
  }
  if (b.damaged)
    b.bag.box(0.3, lift + 0.14, -0.1, 0.45, lift + 0.16, 0.1, 0x1c1a18);
  if (b.abandoned) weeds(b, -0.4, 0.4, 0.24, 3);
};

export const busStop: BuilderFn = (b) => {
  const frame = b.c(0x4f5a66);
  const glass = b.c(0x8bb4c8);
  const x0 = -0.8;
  const x1 = 0.8;
  b.bag.box(x0 - 0.05, 0, -0.38, x1 + 0.05, 0.05, 0.2, b.c(0xb4aea2));
  for (const x of [x0, x1])
    b.bag.box(x - 0.03, 0.05, -0.32, x + 0.03, 0.7, -0.26, frame);
  if (!b.wrecked) {
    b.bag.box(x0 - 0.06, 0.7, -0.4, x1 + 0.06, 0.75, 0.15, frame);
    b.bag.quad2(
      [x0, 0.1, -0.29],
      [x1, 0.1, -0.29],
      [x1, 0.68, -0.29],
      [x0, 0.68, -0.29],
      glass,
    );
    b.bag.quad2(
      [x0, 0.1, -0.29],
      [x0, 0.1, 0.1],
      [x0, 0.68, 0.1],
      [x0, 0.68, -0.29],
      glass,
    );
    if (b.damaged || b.abandoned)
      b.bag.quad2(
        [0.1, 0.1, -0.285],
        [0.5, 0.1, -0.285],
        [0.5, 0.5, -0.285],
        [0.1, 0.3, -0.285],
        0x14171b,
      );
  } else {
    b.bag.ribbon([-0.7, 0.06, 0.1], [0.5, 0.08, 0.0], 0.15, glass);
    b.bag.box(0.2, 0.05, -0.3, 0.6, 0.12, 0.0, frame);
  }
  // Bench.
  b.bag.box(-0.4, 0.14, -0.22, 0.4, 0.18, -0.08, b.c(0x8a5a30));
  b.bag.box(-0.38, 0.05, -0.2, -0.32, 0.14, -0.1, frame);
  b.bag.box(0.32, 0.05, -0.2, 0.38, 0.14, -0.1, frame);
  // Stop sign.
  b.bag.cyl(0.95, 0.15, 0.015, 0.05, 1.0, frame, 5);
  b.bag.cyl(0.95, 0.15, 0.1, 0.9, 0.93, b.c(0x2f6fa8), 8, 0.1);
  if (b.abandoned) weeds(b, -0.7, 0.7, 0.18, 4);
};

export const rubblePile: BuilderFn = (b) => {
  const sets = [
    [0x9a5a44, 0x8a847a, 0x4a423c],
    [0x9a9890, 0x7a7870, 0x3f3b36],
    [0x7a5a3c, 0x5a4630, 0x3a3028],
  ];
  const colours = sets[b.variant % sets.length] as number[];
  b.bag.frustum(
    [-0.4, -0.35, 0.4, 0.35],
    [-0.12, -0.1, 0.12, 0.1],
    0,
    0.2,
    b.cj(colours[1] as number, 0.05),
  );
  b.rubble({ x0: -0.4, z0: -0.35, x1: 0.4, z1: 0.35, h: 1 }, 14, colours);
  // Bent rebar / beams poking out.
  b.bag.ribbon([-0.1, 0.18, 0], [0.25, 0.4, -0.15], 0.012, 0x3a3028);
  b.bag.ribbon([0.05, 0.2, 0.05], [-0.3, 0.34, 0.2], 0.012, 0x4a3a28);
};

type V3 = [number, number, number];

/** A box of half sizes (hx, hy, hz) about `c`, turned `yaw` about Y and then
 *  tipped `tilt` about its own X axis: a fallen slab or a leaning beam. */
function tiltedBox(
  b: Parameters<BuilderFn>[0],
  c: V3,
  hx: number,
  hy: number,
  hz: number,
  yaw: number,
  tilt: number,
  colour: number,
): void {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const at = (x: number, y: number, z: number): V3 => {
    const y1 = y * ct - z * st;
    const z1 = y * st + z * ct;
    return [c[0] + x * cy + z1 * sy, c[1] + y1, c[2] - x * sy + z1 * cy];
  };
  const p = [
    at(-hx, -hy, -hz),
    at(hx, -hy, -hz),
    at(hx, -hy, hz),
    at(-hx, -hy, hz),
    at(-hx, hy, -hz),
    at(hx, hy, -hz),
    at(hx, hy, hz),
    at(-hx, hy, hz),
  ] as V3[];
  const q = (a: number, bb: number, cc: number, d: number, col: number) =>
    b.bag.quad(p[a] as V3, p[bb] as V3, p[cc] as V3, p[d] as V3, col);
  q(4, 7, 6, 5, colour);
  q(0, 1, 2, 3, b.cj(colour, 0.06));
  q(3, 2, 6, 7, b.cj(colour, 0.04));
  q(1, 0, 4, 5, b.cj(colour, 0.04));
  q(0, 3, 7, 4, b.cj(colour, 0.05));
  q(2, 1, 5, 6, b.cj(colour, 0.05));
}

/** Spec 31 block 1, spec 44: what a collapsed building leaves, filling its
 *  footprint. A jagged mound of broken masonry under an ash-dark ground, with
 *  floor slabs fallen across it, stubs of the outer walls still standing with
 *  their window holes, snapped columns, bent rebar and loose blocks, some of
 *  them charred. */
export const rubbleHeap: BuilderFn = (b) => {
  const sets = [
    { wall: 0xb8b0a0, brick: 0x9a5a44, slab: 0x9c988e, dust: 0x6e665a },
    { wall: 0xc4c0b4, brick: 0x8a847a, slab: 0xa8a69e, dust: 0x726c62 },
    { wall: 0xa88a66, brick: 0x7a5a3c, slab: 0x948a7c, dust: 0x665a4a },
  ];
  const set = sets[b.variant % sets.length] as (typeof sets)[number];
  const char = 0x2a2622;
  const hw = Math.max(0.45, b.w / 2 - 0.08);
  const hd = Math.max(0.45, b.d / 2 - 0.08);
  const peak = Math.min(0.75, 0.3 + 0.12 * Math.min(b.w, b.d));

  // Ash and dust spread past the footprint.
  b.bag.box(
    -hw - 0.12,
    0,
    -hd - 0.12,
    hw + 0.12,
    0.012,
    hd + 0.12,
    b.cj(set.dust, 0.04),
  );
  for (let i = 0; i < 4; i++) {
    const x = b.r(-hw, hw * 0.4);
    const z = b.r(-hd, hd * 0.4);
    b.bag.box(
      x,
      0.013,
      z,
      x + b.r(0.3, 0.7),
      0.016,
      z + b.r(0.25, 0.6),
      b.cj(char, 0.05),
    );
  }

  // The mound: a jagged height field, highest inside, nothing at the edge.
  const nx = Math.max(4, Math.round(b.w * 4));
  const nz = Math.max(4, Math.round(b.d * 4));
  const heights: number[] = [];
  for (let k = 0; k <= nz; k++) {
    for (let i = 0; i <= nx; i++) {
      const u = (i / nx) * 2 - 1;
      const v = (k / nz) * 2 - 1;
      const edge = i === 0 || k === 0 || i === nx || k === nz;
      const bump = Math.max(0, (1 - u * u) * (1 - v * v));
      heights.push(edge ? 0 : peak * bump * b.r(0.55, 1.35));
    }
  }
  const h = (i: number, k: number) => heights[k * (nx + 1) + i] as number;
  const px = (i: number) => -hw + (2 * hw * i) / nx;
  const pz = (k: number) => -hd + (2 * hd * k) / nz;
  const tones = [set.slab, set.brick, set.wall, set.dust, char];
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const tone = tones[
        Math.floor(b.r(0, 1) * (b.r(0, 1) < 0.15 ? 5 : 4))
      ] as number;
      b.bag.quad(
        [px(i), h(i, k + 1), pz(k + 1)],
        [px(i + 1), h(i + 1, k + 1), pz(k + 1)],
        [px(i + 1), h(i + 1, k), pz(k)],
        [px(i), h(i, k), pz(k)],
        b.cj(tone, 0.07),
      );
    }
  }

  // Stubs of the outer walls along two or three sides, ragged on top, with
  // the dark holes of their windows.
  const sides = [
    { along: "x", fixed: hd, from: -hw, to: hw },
    { along: "z", fixed: hw, from: -hd, to: hd },
    { along: "x", fixed: -hd, from: -hw, to: hw },
    { along: "z", fixed: -hw, from: -hd, to: hd },
  ];
  const wall = b.variant % 2 === 0 ? set.wall : set.brick;
  for (const side of sides) {
    if (b.r(0, 1) < 0.35) continue;
    let t = side.from + b.r(0, 0.3);
    while (t < side.to - 0.15) {
      const len = b.r(0.18, 0.5);
      const end = Math.min(side.to, t + len);
      // Zero Hour: a block keeps a tall shell (`CBTAprtmn1_R`, ~0.7 of its
      // height), a house leaves a low pile (`CBTownHs01_R`, ~0.3).
      const shell = Math.min(b.w, b.d) >= 3 ? 1.8 : 1;
      const top = b.r(0.1, 1) < 0.3 ? b.r(0.6, 1.3) * shell : b.r(0.12, 0.5);
      const thick = 0.07;
      const [x0, z0, x1, z1] =
        side.along === "x"
          ? [t, side.fixed - thick, end, side.fixed]
          : [side.fixed - thick, t, side.fixed, end];
      b.bag.box(x0, 0, z0, x1, top, z1, b.cj(wall, 0.05));
      if (top > 0.45) {
        // A window hole on the outer face.
        const wy = top * 0.55;
        const mid = (t + end) / 2;
        const ww = Math.min(0.08, (end - t) / 3);
        if (side.along === "x") {
          b.bag.box(
            mid - ww,
            wy,
            side.fixed - 0.005,
            mid + ww,
            wy + 0.14,
            side.fixed + 0.005,
            char,
          );
        } else {
          b.bag.box(
            side.fixed - 0.005,
            wy,
            mid - ww,
            side.fixed + 0.005,
            wy + 0.14,
            mid + ww,
            char,
          );
        }
      }
      t = end + (b.r(0, 1) < 0.45 ? b.r(0.15, 0.45) : 0);
    }
  }

  // Floor slabs fallen across the heap.
  const slabs = Math.round(2 + b.w * b.d * 0.7);
  for (let i = 0; i < slabs; i++) {
    const x = b.r(-hw * 0.7, hw * 0.7);
    const z = b.r(-hd * 0.7, hd * 0.7);
    tiltedBox(
      b,
      [x, peak * b.r(0.3, 0.8), z],
      b.r(0.18, 0.4),
      0.025,
      b.r(0.14, 0.3),
      b.r(0, Math.PI),
      b.r(-0.7, 0.7),
      b.cj(set.slab, 0.06),
    );
  }

  // Snapped columns and beams.
  for (let i = Math.round(1 + b.w * b.d * 0.25); i > 0; i--) {
    tiltedBox(
      b,
      [b.r(-hw * 0.6, hw * 0.6), peak * 0.5, b.r(-hd * 0.6, hd * 0.6)],
      0.035,
      b.r(0.18, 0.4),
      0.035,
      b.r(0, Math.PI),
      b.r(-0.9, 0.9),
      b.cj(set.slab, 0.04),
    );
  }

  // Rebar bent up out of the concrete.
  for (let i = Math.round(3 + b.w * b.d * 0.5); i > 0; i--) {
    const x = b.r(-hw * 0.6, hw * 0.6);
    const z = b.r(-hd * 0.6, hd * 0.6);
    const y = peak * b.r(0.3, 0.8);
    tiltedBox(
      b,
      [x, y + 0.12, z],
      0.006,
      b.r(0.1, 0.22),
      0.006,
      b.r(0, Math.PI),
      b.r(-1, 1),
      0x3a2e26,
    );
  }

  // Loose blocks on and around the heap, some charred.
  b.rubble(
    { x0: -hw, z0: -hd, x1: hw, z1: hd, h: 1, y0: 0 },
    Math.round(5 * b.w * b.d),
    [set.slab, set.brick, set.wall, char],
  );
};

export const crateStack: BuilderFn = (b) => {
  const wood = b.c(0x8a6a3c);
  b.bag.box(-0.4, 0, -0.35, 0.05, 0.4, 0.1, wood);
  b.bag.box(0.0, 0, 0.0, 0.42, 0.35, 0.4, b.c(0x7a5a30));
  b.bag.box(-0.3, 0.4, -0.25, 0.0, 0.7, 0.05, b.c(0x9a7a48));
};

export const PROP_BUILDERS: Readonly<Record<string, BuilderFn>> = {
  fence,
  "stone-wall": stoneWall,
  "lamp-post": lampPost,
  "parked-car": car,
  "bus-stop": busStop,
  "rubble-pile": rubblePile,
  "rubble-heap": rubbleHeap,
  "crate-stack": crateStack,
};
