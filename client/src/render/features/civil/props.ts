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
  "crate-stack": crateStack,
};
