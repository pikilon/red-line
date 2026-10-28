import { type Build, mix, type Vol } from "./build";

/** Spec 26 section 5.1: one builder per civilian building type. Local space:
 *  origin at the footprint centre on the ground, +z is the front (street
 *  side), 1 unit = 1 cell. `Build` supplies the state looks. */

export type BuilderFn = (b: Build) => void;

const STONE = 0x8c877c;
const LAWN = 0x5f8a43;

/** Footing that hides the gap on a slope. */
function plinth(b: Build, v: Vol): void {
  b.bag.box(
    v.x0 - 0.03,
    -0.25,
    v.z0 - 0.03,
    v.x1 + 0.03,
    0.05,
    v.z1 + 0.03,
    b.c(STONE),
  );
}

/** Low shrubs; abandoned yards grow wild. */
function bushes(b: Build, x0: number, x1: number, z: number, n: number): void {
  const wild = b.abandoned;
  for (let i = 0; i < n; i++) {
    const x = b.r(x0, x1);
    const s = b.r(0.07, wild ? 0.2 : 0.13);
    const col = wild
      ? b.pick([0x4a6638, 0x58763e, 0x6a7a44])
      : b.pick([0x4f8a3c, 0x5c9a46, 0x3f7a35]);
    b.bag.box(x - s, 0, z - s, x + s, s * 1.5, z + s, col);
  }
}

function slab(
  b: Build,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  colour: number,
  h = 0.03,
): void {
  b.bag.box(x0, 0, z0, x1, h, z1, b.c(colour));
}

function chimney(b: Build, x: number, z: number, y: number, h: number): void {
  const top = b.wrecked ? h * 0.5 : h;
  b.bag.box(
    x - 0.08,
    y - 0.2,
    z - 0.08,
    x + 0.08,
    y + top,
    z + 0.08,
    b.c(0x8a4a3a),
  );
  b.bag.box(
    x - 0.1,
    y + top,
    z - 0.1,
    x + 0.1,
    y + top + 0.03,
    z + 0.1,
    b.c(0x5a3a30),
  );
}

// ---------------------------------------------------------------------------

export const house: BuilderFn = (b) => {
  const wall = b.byVariant([0xe0d2ae, 0xd7a07c, 0xc3d1c0]);
  const roof = b.byVariant([0xa03c2c, 0x5f6e7e, 0x7b5a3c]);
  const v: Vol = { x0: -0.8, z0: -0.82, x1: 0.8, z1: 0.28, h: 0.68 };
  plinth(b, v);
  b.body(v, wall);
  b.windows(v, "f", {
    cols: 2,
    rows: 1,
    y0: 0.28,
    floorH: 0.5,
    w: 0.26,
    h: 0.28,
    skip: (c) => c === 0,
  });
  b.door(v, "f", 0.4, 0.2, 0.42, 0x6a4a2a);
  b.windows(v, "l", {
    cols: 1,
    rows: 1,
    y0: 0.28,
    floorH: 0.5,
    w: 0.26,
    h: 0.28,
  });
  b.windows(v, "r", {
    cols: 1,
    rows: 1,
    y0: 0.28,
    floorH: 0.5,
    w: 0.26,
    h: 0.28,
  });
  b.windows(v, "b", {
    cols: 2,
    rows: 1,
    y0: 0.28,
    floorH: 0.5,
    w: 0.26,
    h: 0.28,
  });
  b.wear(v);
  if (b.variant % 3 === 1 && !b.wrecked) {
    const y = v.h;
    const o = 0.08;
    b.bag.frustum(
      [v.x0 - o, v.z0 - o, v.x1 + o, v.z1 + o],
      [-0.25, -0.28, 0.25, -0.28],
      y,
      0.46,
      b.cj(roof, 0.03),
      false,
    );
  } else {
    b.roofGable(v, 0.44, roof, b.variant % 3 === 2 ? "z" : "x");
  }
  chimney(b, b.variant % 3 === 2 ? 0.4 : -0.5, -0.3, v.h + 0.15, 0.35);
  // Front step, path and garden.
  b.bag.box(0.28, 0, 0.28, 0.52, 0.05, 0.4, b.c(0xb8b2a2));
  slab(b, 0.32, 0.4, 0.48, 0.94, 0xc4bca8, 0.02);
  slab(b, -0.9, 0.3, 0.9, 0.94, LAWN, 0.012);
  bushes(b, -0.8, 0.1, 0.4, b.abandoned ? 5 : 3);
  if (b.wrecked) b.rubble(v, 10, [wall, roof, 0x50473f]);
};

export const townhouses: BuilderFn = (b) => {
  const palette = [0xd9a066, 0xb85c4a, 0x7f9bb0, 0xe0cfa0, 0x9bb089, 0xc98aa0];
  const roofs = [0x4a4f58, 0x7a3b2c, 0x3f5a4a];
  for (let i = 0; i < 4; i++) {
    const x0 = -2 + i + 0.015;
    const x1 = x0 + 0.97;
    const floors = (b.variant + i) % 2 === 0 ? 2 : 3;
    const v: Vol = { x0, z0: -0.82, x1, z1: 0.4, h: 0.34 + floors * 0.4 };
    if (i === 0) plinth(b, { x0: -2, z0: -0.82, x1: 2, z1: 0.4, h: 0 });
    const col = palette[(i * 2 + b.variant) % palette.length] as number;
    b.body(v, col);
    b.windows(v, "f", {
      cols: 1,
      rows: floors,
      y0: 0.5 - 0.4 + 0.4,
      floorH: 0.4,
      w: 0.34,
      h: 0.26,
      skip: (_c, r) => r < 0,
    });
    b.windows(v, "b", {
      cols: 1,
      rows: floors,
      y0: 0.35,
      floorH: 0.4,
      w: 0.34,
      h: 0.26,
    });
    b.door(v, "f", 0.3, 0.2, 0.36, 0x4a3a2a);
    if (i === 0)
      b.windows(v, "l", {
        cols: 2,
        rows: floors,
        y0: 0.35,
        floorH: 0.4,
        w: 0.2,
        h: 0.24,
      });
    if (i === 3)
      b.windows(v, "r", {
        cols: 2,
        rows: floors,
        y0: 0.35,
        floorH: 0.4,
        w: 0.2,
        h: 0.24,
      });
    b.wear(v);
    if (b.wrecked && i % 2 === 1) {
      b.bag.box(v.x0, v.h, v.z0, v.x1, v.h + 0.05, v.z1, 0x2a2420);
    } else {
      b.roofGable(
        { ...v, x0: v.x0 - 0.0, x1: v.x1 },
        0.4,
        roofs[(i + b.variant) % roofs.length] as number,
        "z",
        0.05,
      );
    }
    // Stoop.
    b.bag.box(x0 + 0.1, 0, v.z1, x0 + 0.5, 0.06, v.z1 + 0.14, b.c(0xb8b2a2));
  }
  slab(b, -2, 0.4, 2, 0.95, 0xb0aaa0, 0.025);
  bushes(b, -1.9, 1.9, 0.62, b.abandoned ? 7 : 3);
  if (b.wrecked)
    b.rubble(
      { x0: -2, z0: -0.8, x1: 2, z1: 0.4, h: 1 },
      14,
      [0xb85c4a, 0x4a4f58, 0x50473f],
    );
};

export const apartment: BuilderFn = (b) => {
  const floors = 4 + (b.variant % 3);
  const floorH = 0.5;
  const wall = b.byVariant([0xcdbb9c, 0xb26a52, 0xaab4b8]);
  const trim = b.byVariant([0xf0ead8, 0xe6d9c0, 0xdfe6e8]);
  const v: Vol = {
    x0: -1.4,
    z0: -1.4,
    x1: 1.4,
    z1: 1.4,
    h: floors * floorH + 0.1,
  };
  plinth(b, v);
  b.body(v, wall, 0.06);
  const grid = {
    cols: 5,
    rows: floors,
    y0: 0.22,
    floorH,
    w: 0.32,
    h: 0.3,
    trim,
    lit: 0.3,
  };
  b.windows(v, "f", { ...grid, skip: (c, r) => r === 0 && c === 2 });
  b.door(v, "f", 1.4, 0.34, 0.46, 0x3f4d5a);
  b.windows(v, "b", grid);
  b.windows(v, "l", grid);
  b.windows(v, "r", grid);
  // Balconies under the windows of columns 1 and 3.
  if (!b.wrecked || b.cut === null) {
    for (let r = 1; r < floors; r++) {
      for (const c of [1, 3]) {
        const u = 2.8 * ((c + 0.5) / 5);
        const x = -1.4 + u;
        const y = r * floorH + 0.1;
        if (!b.alive(x, y + 0.2)) continue;
        if (b.wrecked && b.rnd() < 0.5) continue;
        b.bag.box(x - 0.24, y, 1.4, x + 0.24, y + 0.035, 1.66, b.c(0xb9b3a4));
        b.bag.box(
          x - 0.24,
          y + 0.035,
          1.64,
          x + 0.24,
          y + 0.2,
          1.665,
          b.c(mix(wall, 0x000000, 0.3)),
        );
      }
    }
  }
  b.wear(v);
  b.roofFlat(v, 0x5a5d62);
  // Roof clutter.
  if (b.cut === null || b.cut.dir < 0) {
    b.bag.box(0.4, v.h + 0.03, -0.5, 0.9, v.h + 0.22, 0.0, b.c(0x9a9890));
  }
  if (b.cut === null || b.cut.dir > 0) {
    b.bag.box(-0.9, v.h + 0.03, 0.2, -0.5, v.h + 0.16, 0.6, b.c(0xaaa8a0));
  }
  slab(b, -1.5, 1.4, 1.5, 1.5, 0xaaa398, 0.03);
  if (b.wrecked) b.rubble(v, 18, [wall, 0x6a625a, 0x3a3430]);
};

export const shop: BuilderFn = (b) => {
  const wall = b.byVariant([0xcfa86a, 0x8fa8b8, 0xd8d0b8]);
  const accent = b.byVariant([0xb8342c, 0x2f6fa8, 0x3f8a4a]);
  const v: Vol = { x0: -0.85, z0: -0.85, x1: 0.85, z1: 0.5, h: 0.78 };
  plinth(b, v);
  b.body(v, wall, 0.05);
  // Storefront.
  const f = {
    ox: -0.85,
    oz: 0.5,
    tx: 1,
    tz: 0,
    nx: 0,
    nz: 1,
    len: 1.7,
    y0: 0,
    h: 0.78,
  };
  b.window(f, 0.5, 0.1, 0.62, 0.32, b.windowKind(0.55), 0xeeeeee, 0x8bb4c8);
  b.window(f, 1.4, 0.1, 0.28, 0.32, b.windowKind(0.4), 0xeeeeee, 0x8bb4c8);
  b.door(v, "f", 1.1, 0.2, 0.36, accent);
  // Awning of stripes.
  if (!b.wrecked) {
    const y = 0.5;
    const n = 8;
    for (let i = 0; i < n; i++) {
      if (b.abandoned && i % 3 === 1) continue;
      const u0 = -0.85 + (1.7 * i) / n;
      const u1 = u0 + 1.7 / n;
      const sag = b.abandoned ? 0.08 : 0;
      b.bag.quad2(
        [u0, y, 0.5],
        [u1, y, 0.5],
        [u1, y - 0.1 - sag, 0.82],
        [u0, y - 0.1 - sag, 0.82],
        b.c(i % 2 === 0 ? accent : 0xf2f0e8),
      );
    }
  }
  b.windows(v, "l", {
    cols: 1,
    rows: 1,
    y0: 0.3,
    floorH: 0.5,
    w: 0.26,
    h: 0.28,
  });
  b.windows(v, "r", {
    cols: 1,
    rows: 1,
    y0: 0.3,
    floorH: 0.5,
    w: 0.26,
    h: 0.28,
  });
  b.wear(v);
  b.roofFlat(v, 0x5a5a5a, 0.07);
  // Sign on the roof.
  if (b.wrecked) {
    b.bag.box(-0.5, 0.78, 0.3, 0.1, 0.9, 0.34, b.c(accent));
  } else {
    b.bag.box(-0.7, 0.8, 0.28, 0.7, 1.08, 0.34, b.c(accent));
    for (let i = 0; i < 6; i++) {
      const x = -0.55 + i * 0.2;
      b.bag.box(
        x,
        0.88,
        0.341,
        x + 0.12,
        1.0,
        0.346,
        b.abandoned ? 0xc0b8a8 : 0xf4f0e0,
        { glow: b.intact },
      );
    }
    b.bag.box(-0.7, 0.78, 0.3, -0.64, 0.8, 0.32, 0x333333);
    b.bag.box(0.64, 0.78, 0.3, 0.7, 0.8, 0.32, 0x333333);
  }
  slab(b, -0.95, 0.5, 0.95, 0.95, 0xb4aea2, 0.03);
  if (b.wrecked) b.rubble(v, 10, [wall, 0x5a5a5a, 0x3a3430]);
};

export const gasStation: BuilderFn = (b) => {
  const accent = b.byVariant([0xc8302a, 0x2f6fa8, 0x3f8a4a]);
  const shopV: Vol = { x0: -1.9, z0: -1.4, x1: -0.5, z1: -0.2, h: 0.58 };
  slab(b, -1.97, -1.45, 1.97, 1.45, 0x6e6c68, 0.02);
  plinth(b, shopV);
  b.body(shopV, 0xe8e2d0, 0.05);
  const f = {
    ox: -1.9,
    oz: -0.2,
    tx: 1,
    tz: 0,
    nx: 0,
    nz: 1,
    len: 1.4,
    y0: 0,
    h: 0.58,
  };
  b.window(f, 0.45, 0.1, 0.6, 0.28, b.windowKind(0.6), 0xdddddd, 0x8bb4c8);
  b.door(shopV, "f", 1.1, 0.2, 0.34, accent);
  b.wear(shopV);
  b.roofFlat(shopV, 0x55585c, 0.06);
  b.bag.box(-1.9, 0.55, -0.2, -0.5, 0.62, -0.17, b.c(accent));
  // Canopy.
  const cy = 0.78;
  const px = [-0.1, 1.8];
  const pz = [-0.5, 1.05];
  const broken = b.wrecked;
  for (const x of px) {
    for (const z of pz) {
      if (broken && x < 0 && z < 0) continue;
      b.bag.box(x - 0.04, 0, z - 0.04, x + 0.04, cy, z + 0.04, b.c(0xcfcfc8));
    }
  }
  if (broken) {
    const lo = 0.12;
    b.bag.quad2(
      [-0.2, cy, 1.15],
      [1.9, cy, 1.15],
      [1.9, lo, -0.6],
      [-0.2, lo + 0.1, -0.6],
      b.c(0xe8e8e0),
    );
    b.rubble({ x0: -0.2, z0: -0.5, x1: 1.9, z1: 0.6, h: 1 }, 12, [
      0xe8e8e0,
      0x6a625a,
      accent,
    ]);
  } else {
    b.bag.box(-0.2, cy, -0.6, 1.9, cy + 0.1, 1.15, b.c(0xeeeeea));
    b.bag.box(-0.2, cy + 0.02, 1.15, 1.9, cy + 0.08, 1.17, b.c(accent));
    b.bag.box(-0.2, cy + 0.02, -0.62, 1.9, cy + 0.08, -0.6, b.c(accent));
    if (b.intact)
      b.bag.box(-0.1, cy - 0.01, -0.5, 1.8, cy, 1.05, 0xfff2c0, { glow: true });
  }
  // Pumps.
  for (const x of [0.4, 1.3]) {
    b.bag.box(x - 0.2, 0, 0.1, x + 0.2, 0.05, 0.4, b.c(0xb8b2a2));
    for (const px2 of [x - 0.1, x + 0.1]) {
      if (b.wrecked && b.rnd() < 0.5) continue;
      b.bag.box(px2 - 0.05, 0.05, 0.2, px2 + 0.05, 0.38, 0.3, b.c(accent));
      b.bag.box(px2 - 0.04, 0.26, 0.3, px2 + 0.04, 0.34, 0.31, 0x1a2a38);
    }
  }
  // Price sign.
  b.bag.box(1.7, 0, 1.3, 1.76, 1.3, 1.36, b.c(0x888880));
  if (!b.wrecked) {
    b.bag.box(1.55, 1.3, 1.28, 1.92, 1.58, 1.38, b.c(accent));
    b.bag.box(
      1.6,
      1.34,
      1.381,
      1.87,
      1.54,
      1.386,
      b.abandoned ? 0x555048 : 0xfff2c0,
      { glow: b.intact },
    );
  }
  if (b.abandoned) bushes(b, -1.9, 1.9, 1.35, 5);
};

export const officeTower: BuilderFn = (b) => {
  const floors = 8 + (b.variant % 3) * 3;
  const floorH = 0.4;
  const glass = b.byVariant([0x2f5f86, 0xa59a82, 0x1d2f45]);
  const frame = b.byVariant([0x8ea6b6, 0xd2c7ad, 0x4a5a6a]);
  const podium: Vol = { x0: -1.4, z0: -1.4, x1: 1.4, z1: 1.4, h: 0.5 };
  const tower: Vol = {
    x0: -0.95,
    z0: -0.95,
    x1: 0.95,
    z1: 0.95,
    h: floors * floorH + 0.1,
    y0: 0.5,
  };
  plinth(b, podium);
  b.body(podium, 0xb9b6ae);
  b.roofFlat(podium, 0x666666, 0.04);
  b.body(tower, frame, 0.05);
  const grid = {
    cols: 6,
    rows: floors,
    y0: 0.07,
    floorH,
    w: 0.2,
    h: 0.26,
    trim: frame,
    glass,
    lit: 0.35,
  };
  for (const face of ["f", "b", "l", "r"] as const)
    b.windows(tower, face, grid);
  b.windows(podium, "f", {
    cols: 6,
    rows: 1,
    y0: 0.14,
    floorH: 0.5,
    w: 0.3,
    h: 0.26,
    trim: 0xdddddd,
    glass,
    lit: 0.5,
  });
  b.door(podium, "f", 1.4, 0.4, 0.38, 0x2a3440);
  b.wear(tower);
  b.wear(podium);
  // Crown and antenna.
  const top = (tower.y0 ?? 0) + tower.h;
  if (b.cut === null || b.cut.dir < 0) {
    b.bag.box(0.15, top, -0.5, 0.75, top + 0.2, -0.1, b.c(0x8a8a86));
  }
  if (!b.wrecked) {
    b.bag.box(-0.5, top, -0.5, 0.2, top + 0.14, 0.5, b.c(0xa8a8a2));
    if (b.variant % 3 !== 1) {
      b.bag.box(-0.03, top + 0.14, -0.03, 0.03, top + 0.9, 0.03, b.c(0x8a8a8a));
      b.bag.box(
        -0.04,
        top + 0.9,
        -0.04,
        0.04,
        top + 0.94,
        0.04,
        b.intact ? 0xff5040 : 0x5a1a14,
        { glow: b.intact },
      );
    }
  }
  slab(b, -1.5, 1.4, 1.5, 1.5, 0xaaa398, 0.03);
  if (b.wrecked) b.rubble(podium, 18, [frame, 0x6a625a, 0x3a3430, glass]);
};

export const factory: BuilderFn = (b) => {
  const brick = b.byVariant([0xa8604a, 0x8a8f94, 0xb08a60]);
  const v: Vol = { x0: -1.9, z0: -1.0, x1: 1.9, z1: 1.35, h: 0.8 };
  plinth(b, v);
  b.body(v, brick);
  const grid = {
    cols: 7,
    rows: 1,
    y0: 0.4,
    floorH: 0.8,
    w: 0.3,
    h: 0.26,
    trim: 0xb8b8b0,
    glass: 0x546878,
    lit: 0.1,
  };
  b.windows(v, "f", { ...grid, cols: 5, skip: (c) => c === 3 });
  b.windows(v, "b", grid);
  b.windows(v, "l", { ...grid, cols: 5 });
  b.windows(v, "r", { ...grid, cols: 5 });
  // Roll-up door at the front.
  const f = {
    ox: -1.9,
    oz: 1.35,
    tx: 1,
    tz: 0,
    nx: 0,
    nz: 1,
    len: 3.8,
    y0: 0,
    h: 0.8,
  };
  b.decal(f, 2.05, 0, 3.0, 0.5, b.c(0x6a6e72), 0.02);
  for (let i = 0; i < 6; i++)
    b.decal(
      f,
      2.05,
      0.04 + i * 0.08,
      3.0,
      0.06 + i * 0.08,
      b.c(0x555a5e),
      0.03,
    );
  b.wear(v);
  // Sawtooth roof.
  const y = v.h;
  const teeth = 4;
  const tw = 3.8 / teeth;
  const rise = 0.34;
  for (let i = 0; i < teeth; i++) {
    const x = -1.9 + i * tw;
    if (b.wrecked && i % 2 === 1) {
      for (let k = 0; k < 4; k++)
        b.bag.ribbon(
          [x + k * 0.25, y, v.z0],
          [x + k * 0.25 + 0.2, y + rise * 0.8, v.z1],
          0.012,
          0x3a2c20,
        );
      continue;
    }
    const roofC = b.cj(0x6a6e72, 0.03);
    b.bag.quad(
      [x, y, v.z0],
      [x, y, v.z1],
      [x + tw, y + rise, v.z1],
      [x + tw, y + rise, v.z0],
      roofC,
    );
    b.bag.quad(
      [x + tw, y, v.z1],
      [x + tw, y, v.z0],
      [x + tw, y + rise, v.z0],
      [x + tw, y + rise, v.z1],
      b.intact ? 0x9ab8c6 : b.c(0x6a7880),
    );
    b.bag.tri(
      [x, y, v.z1],
      [x + tw, y, v.z1],
      [x + tw, y + rise, v.z1],
      b.c(brick),
    );
    b.bag.tri(
      [x + tw, y, v.z0],
      [x, y, v.z0],
      [x + tw, y + rise, v.z0],
      b.c(brick),
    );
  }
  // Chimney.
  const cx = 1.55;
  const cz = -0.55;
  const ch = b.wrecked ? 1.1 : 2.3;
  b.bag.cyl(cx, cz, 0.2, y, y + ch, b.c(0x9a5240), 8, 0.14);
  b.bag.cyl(cx, cz, 0.145, y + ch, y + ch + 0.1, b.c(0x2a2420), 8, 0.145);
  b.bag.cyl(cx, cz, 0.19, y + ch * 0.55, y + ch * 0.6, b.c(0xe8e0d0), 8, 0.19);
  if (b.wrecked)
    b.rubble(
      { x0: cx - 0.3, z0: cz - 0.3, x1: cx + 0.9, z1: cz + 0.9, h: 1 },
      8,
      [0x9a5240, 0x3a3430],
    );
  // Tanks and pipes by the side.
  b.bag.cyl(
    -1.3,
    -0.35,
    0.32,
    y,
    y + 0.35,
    b.c(0x8a9096),
    8,
    0.32,
    b.c(0x9aa0a6),
  );
  b.bag.box(-0.9, y + 0.03, -0.6, 0.5, y + 0.1, -0.5, b.c(0x7a5a3c));
  b.bag.box(-1.1, y + 0.03, 0.2, -0.3, y + 0.28, 0.7, b.c(0x9a9890));
  slab(b, -2, 1.35, 2, 1.5, 0x7a7770, 0.025);
  if (b.wrecked) b.rubble(v, 16, [brick, 0x6a6e72, 0x3a3430]);
};

export const church: BuilderFn = (b) => {
  const style = b.variant % 3;
  const wall = [0xdcd3be, 0xf2efe6, 0xb4604a][style] as number;
  const roof = [0x4c5662, 0xa0382c, 0x3f3a38][style] as number;
  const nave: Vol = { x0: -0.8, z0: -1.9, x1: 0.8, z1: 0.9, h: 0.9 };
  const tower: Vol = {
    x0: -0.5,
    z0: 0.9,
    x1: 0.5,
    z1: 1.9,
    h: style === 1 ? 1.5 : 2.0,
  };
  plinth(b, { x0: -0.8, z0: -1.9, x1: 0.8, z1: 1.9, h: 0 });
  b.body(nave, wall);
  b.body(tower, wall);
  // Windows: tall pointed ones in stained colours.
  const stained = [0x5a4a8a, 0x2f5f86, 0x8a2f3a, 0x3f7a5a];
  for (const face of ["l", "r"] as const) {
    for (let i = 0; i < 4; i++) {
      const f =
        face === "l"
          ? {
              ox: -0.8,
              oz: -1.9,
              tx: 0,
              tz: 1,
              nx: -1,
              nz: 0,
              len: 2.8,
              y0: 0,
              h: 0.9,
            }
          : {
              ox: 0.8,
              oz: 0.9,
              tx: 0,
              tz: -1,
              nx: 1,
              nz: 0,
              len: 2.8,
              y0: 0,
              h: 0.9,
            };
      const u = 0.35 + i * 0.7;
      b.window(
        f,
        u,
        0.22,
        0.2,
        0.46,
        b.windowKind(0.2),
        wall === 0xf2efe6 ? 0xd8d4c8 : 0xe8e2d0,
        b.pick(stained),
      );
    }
  }
  b.wear(nave);
  b.wear(tower);
  b.roofGable({ ...nave, h: 0.9 }, 0.5, roof, "z");
  // Tower: door, belfry, spire.
  b.door(tower, "f", 0.5, 0.3, 0.5, 0x5a3a24);
  b.window(
    { ox: -0.5, oz: 1.9, tx: 1, tz: 0, nx: 0, nz: 1, len: 1, y0: 0, h: 2 },
    0.5,
    0.75,
    0.16,
    0.34,
    b.windowKind(0.2),
    0xe8e2d0,
    0x5a4a8a,
  );
  const belfryY = tower.h - 0.5;
  for (const face of ["f", "b", "l", "r"] as const) {
    const f =
      face === "f"
        ? { ox: -0.5, oz: 1.9, tx: 1, tz: 0, nx: 0, nz: 1, len: 1, y0: 0, h: 2 }
        : face === "b"
          ? {
              ox: 0.5,
              oz: 0.9,
              tx: -1,
              tz: 0,
              nx: 0,
              nz: -1,
              len: 1,
              y0: 0,
              h: 2,
            }
          : face === "l"
            ? {
                ox: -0.5,
                oz: 0.9,
                tx: 0,
                tz: 1,
                nx: -1,
                nz: 0,
                len: 1,
                y0: 0,
                h: 2,
              }
            : {
                ox: 0.5,
                oz: 1.9,
                tx: 0,
                tz: -1,
                nx: 1,
                nz: 0,
                len: 1,
                y0: 0,
                h: 2,
              };
    if (b.alive(f.ox, belfryY))
      b.decal(f, 0.32, belfryY, 0.68, belfryY + 0.36, 0x1c1a18, 0.022);
  }
  const top = tower.h;
  if (b.wrecked) {
    b.bag.frustum(
      [-0.5, 0.9, 0.5, 1.9],
      [-0.3, 1.1, 0.1, 1.7],
      top,
      0.18,
      b.c(roof),
      true,
    );
    b.rubble({ x0: -0.7, z0: 1.7, x1: 0.7, z1: 2.1, h: 1 }, 12, [
      wall,
      roof,
      0x3a3430,
    ]);
  } else if (style === 1) {
    // White chapel: low pointed steeple.
    b.bag.frustum(
      [-0.55, 0.85, 0.55, 1.95],
      [0, 1.4, 0, 1.4],
      top,
      0.75,
      b.cj(roof, 0.03),
      false,
    );
  } else {
    b.bag.frustum(
      [-0.55, 0.85, 0.55, 1.95],
      [0, 1.4, 0, 1.4],
      top,
      0.95,
      b.cj(roof, 0.03),
      false,
    );
  }
  if (!b.wrecked) {
    const cy = top + (style === 1 ? 0.75 : 0.95);
    b.bag.box(
      -0.015,
      cy,
      1.385,
      0.015,
      cy + 0.2,
      1.415,
      b.intact ? 0xe0c25a : b.c(0x8a7a40),
    );
    b.bag.box(
      -0.07,
      cy + 0.1,
      1.385,
      0.07,
      cy + 0.13,
      1.415,
      b.intact ? 0xe0c25a : b.c(0x8a7a40),
    );
  }
  // Side chapel.
  const chapel: Vol = { x0: 0.8, z0: -0.9, x1: 1.4, z1: 0.1, h: 0.55 };
  b.body(chapel, wall);
  b.roofGable(chapel, 0.28, roof, "x", 0.04);
  slab(b, -1.0, 1.9, 1.0, 2.0, 0xaaa398, 0.03);
  if (b.abandoned) bushes(b, -1.2, 1.2, 2.0, 5);
  if (b.wrecked) b.rubble(nave, 14, [wall, roof, 0x3a3430]);
};

export const warehouse: BuilderFn = (b) => {
  const barn = b.variant % 3 === 1;
  const wall = barn ? 0xa03a2c : b.variant % 3 === 0 ? 0x9aa3a8 : 0xc8bfa4;
  const v: Vol = { x0: -1.9, z0: -1.3, x1: 1.9, z1: 1.3, h: barn ? 0.62 : 0.8 };
  plinth(b, v);
  b.body(v, wall);
  const f = {
    ox: -1.9,
    oz: 1.3,
    tx: 1,
    tz: 0,
    nx: 0,
    nz: 1,
    len: 3.8,
    y0: 0,
    h: v.h,
  };
  const sideF = {
    ox: 1.9,
    oz: 1.3,
    tx: 0,
    tz: -1,
    nx: 1,
    nz: 0,
    len: 2.6,
    y0: 0,
    h: v.h,
  };
  if (barn) {
    const white = b.c(0xf0ece0);
    // Big doors with a cross brace.
    b.decal(f, 1.4, 0, 2.4, 0.55, b.c(0x8a2f24), 0.02);
    b.decal(f, 1.4, 0, 2.4, 0.04, white, 0.03);
    b.decal(f, 1.4, 0.51, 2.4, 0.55, white, 0.03);
    b.decal(f, 1.4, 0, 1.44, 0.55, white, 0.03);
    b.decal(f, 2.36, 0, 2.4, 0.55, white, 0.03);
    b.decal(f, 1.88, 0, 1.92, 0.55, white, 0.03);
    b.decalPoly(
      f,
      [
        [1.4, 0],
        [1.46, 0],
        [2.4, 0.55],
        [2.34, 0.55],
      ],
      white,
      0.034,
    );
    b.decalPoly(
      f,
      [
        [2.34, 0],
        [2.4, 0],
        [1.46, 0.55],
        [1.4, 0.55],
      ],
      white,
      0.034,
    );
    b.windows(v, "l", {
      cols: 2,
      rows: 1,
      y0: 0.25,
      floorH: 0.5,
      w: 0.2,
      h: 0.2,
      trim: 0xf0ece0,
    });
    b.wear(v);
    // Gambrel roof, ridge along x.
    const y = v.h;
    const roofC = b.cj(b.wrecked ? 0x5a4a40 : 0x4a4f54, 0.03);
    const zs = [-1.4, -0.7, 0, 0.7, 1.4];
    const ys = [0, 0.38, 0.62, 0.38, 0];
    for (let i = 0; i < 4; i++) {
      const missing = b.wrecked && i === 3;
      if (missing) continue;
      const za = zs[i] as number;
      const zb = zs[i + 1] as number;
      const ya = y + (ys[i] as number);
      const yb = y + (ys[i + 1] as number);
      b.bag.quad2(
        [-2.0, ya, za],
        [2.0, ya, za],
        [2.0, yb, zb],
        [-2.0, yb, zb],
        roofC,
      );
    }
    for (const x of [-1.9, 1.9]) {
      for (let i = 0; i < 4; i++) {
        const za = zs[i] as number;
        const zb = zs[i + 1] as number;
        const ya = y + (ys[i] as number);
        const yb = y + (ys[i + 1] as number);
        const w = [
          [x, y, za],
          [x, y, zb],
          [x, yb, zb],
          [x, ya, za],
        ] as const;
        b.bag.quad2(w[0], w[1], w[2], w[3], b.c(wall));
      }
    }
    // Hay loft door.
    b.decal(f, 1.75, 0.66, 2.05, 0.9, b.c(0x3a1a14), 0.03);
    b.bag.cyl(
      1.2,
      -0.95,
      0.3,
      0,
      b.wrecked ? 0.8 : 1.5,
      b.c(0xb8b6b0),
      8,
      0.3,
      b.c(0xc8c6c0),
    );
    if (!b.wrecked) b.bag.cyl(1.2, -0.95, 0.3, 1.5, 1.8, b.c(0xa8a6a0), 8, 0.0);
  } else {
    // Corrugated metal: ribs, three roll-up doors and a flat gable.
    for (let i = 1; i < 19; i++)
      b.decal(
        f,
        i * 0.2,
        0.0,
        i * 0.2 + 0.02,
        v.h,
        b.c(mix(wall, 0x000000, 0.18)),
        0.012,
      );
    for (let i = 0; i < 3; i++) {
      const u = 0.5 + i * 1.2;
      b.decal(f, u, 0, u + 0.9, 0.5, b.c(0x6a6e72), 0.02);
      for (let k = 0; k < 5; k++)
        b.decal(
          f,
          u,
          0.03 + k * 0.095,
          u + 0.9,
          0.05 + k * 0.095,
          b.c(0x55595d),
          0.03,
        );
    }
    b.decal(f, 3.1, 0, 3.4, 0.45, b.c(0x3f4d5a), 0.02);
    b.windows(v, "l", {
      cols: 3,
      rows: 1,
      y0: 0.5,
      floorH: 0.5,
      w: 0.3,
      h: 0.16,
      trim: 0xb8b8b0,
      lit: 0.1,
    });
    b.decal(sideF, 1.1, 0, 1.6, 0.4, b.c(0x3f4d5a), 0.02);
    b.wear(v);
    b.roofGable(v, 0.32, b.variant % 3 === 0 ? 0x70787c : 0x6a5a4a, "x", 0.06);
    // Loading dock.
    b.bag.box(-1.9, 0, 1.3, 1.9, 0.1, 1.5, b.c(0x8a8780));
    b.bag.box(2.0, 0, -0.4, 2.14, 0.9, -0.3, b.c(0x777777));
  }
  slab(b, -2, 1.3, 2, 1.5, 0x8a8780, 0.025);
  if (b.wrecked) b.rubble(v, 14, [wall, 0x55595d, 0x3a3430]);
};

export const farmhouse: BuilderFn = (b) => {
  const wall = b.byVariant([0xf0ece0, 0xd8c8a0, 0xc8d0c0]);
  const roof = b.byVariant([0x3f6a4a, 0x7a3b2c, 0x555a62]);
  const v: Vol = { x0: -1.3, z0: -0.8, x1: 0.3, z1: 0.5, h: 0.62 };
  plinth(b, v);
  b.body(v, wall);
  b.windows(v, "f", {
    cols: 3,
    rows: 1,
    y0: 0.28,
    floorH: 0.5,
    w: 0.24,
    h: 0.26,
    skip: (c) => c === 1,
    trim: 0x5a4a3a,
  });
  b.door(v, "f", 0.8, 0.22, 0.4, 0x6a4a2a);
  b.windows(v, "l", {
    cols: 2,
    rows: 1,
    y0: 0.28,
    floorH: 0.5,
    w: 0.24,
    h: 0.26,
  });
  b.windows(v, "b", {
    cols: 3,
    rows: 1,
    y0: 0.28,
    floorH: 0.5,
    w: 0.24,
    h: 0.26,
  });
  b.wear(v);
  b.roofGable(v, 0.46, roof, "x");
  chimney(b, -1.0, -0.2, v.h + 0.15, 0.4);
  // Porch.
  b.bag.box(-1.2, 0, 0.5, 0.2, 0.05, 0.8, b.c(0x9a8a70));
  for (const x of [-1.15, 0.15])
    b.bag.box(x - 0.02, 0.05, 0.75, x + 0.02, 0.4, 0.79, b.c(0xf0ece0));
  b.bag.quad2(
    [-1.3, 0.42, 0.82],
    [0.3, 0.42, 0.82],
    [0.3, 0.52, 0.5],
    [-1.3, 0.52, 0.5],
    b.cj(roof, 0.03),
  );
  // Outbuilding and silo.
  const shed: Vol = { x0: 0.5, z0: -0.85, x1: 1.35, z1: 0.0, h: 0.5 };
  b.body(shed, b.byVariant([0xa03a2c, 0x7a5a3c, 0x8a8f94], 1));
  b.decal(
    { ox: 0.5, oz: 0.0, tx: 1, tz: 0, nx: 0, nz: 1, len: 0.85, y0: 0, h: 0.5 },
    0.2,
    0,
    0.65,
    0.34,
    b.c(0x4a3a2a),
    0.02,
  );
  b.wear(shed);
  b.bag.quad2(
    [0.45, 0.5, 0.05],
    [1.4, 0.5, 0.05],
    [1.4, 0.72, -0.9],
    [0.45, 0.72, -0.9],
    b.cj(0x6a6e72, 0.03),
  );
  const siloH = b.wrecked ? 0.8 : 1.5;
  b.bag.cyl(1.1, 0.55, 0.28, 0, siloH, b.c(0xb8b6b0), 8, 0.28, b.c(0xc8c6c0));
  if (!b.wrecked)
    b.bag.cyl(1.1, 0.55, 0.28, siloH, siloH + 0.25, b.c(0xa8a6a0), 8, 0);
  slab(b, -1.4, 0.55, 0.4, 0.9, 0xb8a888, 0.015);
  if (b.abandoned) bushes(b, -1.4, 1.4, 0.9, 7);
  if (b.wrecked) b.rubble(v, 10, [wall, roof, 0x3a3430]);
};

export const BUILDERS: Readonly<Record<string, BuilderFn>> = {
  "house-small": house,
  "townhouse-row": townhouses,
  "apartment-block": apartment,
  shop: shop,
  "gas-station": gasStation,
  "office-tower": officeTower,
  factory: factory,
  church: church,
  "warehouse-barn": warehouse,
  farmhouse: farmhouse,
};
