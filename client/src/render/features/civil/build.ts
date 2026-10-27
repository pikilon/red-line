import type { MeshBag, Vec3 } from "./bag";

/** Spec 26 section 5.1-5.2: the drawing toolkit the civilian builders share.
 *  One `Build` per placed feature: it knows the state (intact, damaged,
 *  wrecked, abandoned) and shapes colours, windows, roofs and wear from it, so
 *  every building type gets the four looks for free. */

export type StateKind = "intact" | "damaged" | "wrecked" | "abandoned";

/** Index of `layerNames.featureStates`. */
export const STATE_KINDS: readonly StateKind[] = [
  "intact",
  "damaged",
  "wrecked",
  "abandoned",
];

export type Rng = () => number;

/** Small deterministic generator (client only, never the sim). */
export function rngOf(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashOf(...values: number[]): number {
  let h = 2166136261;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** A box volume in local space; `y0` is its floor. */
export interface Vol {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h: number;
  y0?: number;
}

export type FaceId = "f" | "b" | "l" | "r";

/** A wall seen from outside: u runs to the viewer's right from `o`. */
export interface Frame {
  readonly ox: number;
  readonly oz: number;
  readonly tx: number;
  readonly tz: number;
  readonly nx: number;
  readonly nz: number;
  readonly len: number;
  readonly y0: number;
  readonly h: number;
}

export function frameOf(v: Vol, f: FaceId): Frame {
  const y0 = v.y0 ?? 0;
  switch (f) {
    case "f":
      return {
        ox: v.x0,
        oz: v.z1,
        tx: 1,
        tz: 0,
        nx: 0,
        nz: 1,
        len: v.x1 - v.x0,
        y0,
        h: v.h,
      };
    case "b":
      return {
        ox: v.x1,
        oz: v.z0,
        tx: -1,
        tz: 0,
        nx: 0,
        nz: -1,
        len: v.x1 - v.x0,
        y0,
        h: v.h,
      };
    case "l":
      return {
        ox: v.x0,
        oz: v.z0,
        tx: 0,
        tz: 1,
        nx: -1,
        nz: 0,
        len: v.z1 - v.z0,
        y0,
        h: v.h,
      };
    default:
      return {
        ox: v.x1,
        oz: v.z1,
        tx: 0,
        tz: -1,
        nx: 1,
        nz: 0,
        len: v.z1 - v.z0,
        y0,
        h: v.h,
      };
  }
}

export const FACES: readonly FaceId[] = ["f", "b", "l", "r"];

const GREY_BEIGE = 0x8e877a;
const SOOT = 0x2a2623;
const CHAR = 0x191614;

export function mix(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

export type WindowKind = "lit" | "dark" | "broken" | "hole" | "boarded";

export interface WindowGrid {
  cols: number;
  rows: number;
  /** Height of the first row above the volume floor. */
  y0: number;
  floorH: number;
  w: number;
  h: number;
  skip?: (col: number, row: number) => boolean;
  /** Frame (trim) colour. */
  trim?: number;
  /** Chance of a lit window in an intact building. */
  lit?: number;
  glass?: number;
}

export class Build {
  /** Wrecked tall bodies lose the upper part on one side. */
  cut: { dir: 1 | -1; x: number; y: number } | null = null;

  readonly bag: MeshBag;
  readonly rnd: Rng;
  readonly state: StateKind;
  readonly variant: number;
  /** Footprint in cells at rot 0. */
  readonly w: number;
  readonly d: number;

  constructor(
    bag: MeshBag,
    rnd: Rng,
    state: StateKind,
    variant: number,
    w: number,
    d: number,
  ) {
    this.bag = bag;
    this.rnd = rnd;
    this.state = state;
    this.variant = variant;
    this.w = w;
    this.d = d;
  }

  get intact(): boolean {
    return this.state === "intact";
  }
  get damaged(): boolean {
    return this.state === "damaged";
  }
  get wrecked(): boolean {
    return this.state === "wrecked";
  }
  get abandoned(): boolean {
    return this.state === "abandoned";
  }

  r(a: number, b: number): number {
    return a + (b - a) * this.rnd();
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rnd() * list.length)] as T;
  }

  /** Pick by variant (stable across states). */
  byVariant<T>(list: readonly T[], shift = 0): T {
    return list[(this.variant + shift) % list.length] as T;
  }

  /** A colour as the current state shows it: scorched when damaged and
   *  wrecked, faded and dusty when abandoned. */
  c(hex: number): number {
    switch (this.state) {
      case "damaged":
        return mix(hex, SOOT, 0.24);
      case "wrecked":
        return mix(hex, CHAR, 0.3);
      case "abandoned":
        return mix(mix(hex, GREY_BEIGE, 0.5), 0xcfc8b8, 0.12);
      default:
        return hex;
    }
  }

  /** Same as `c` with a small random shade, so neighbours differ. */
  cj(hex: number, amount = 0.05): number {
    const t = (this.rnd() - 0.5) * 2 * amount;
    return mix(this.c(hex), t > 0 ? 0xffffff : 0x000000, Math.abs(t));
  }

  alive(x: number, y: number): boolean {
    const cut = this.cut;
    if (cut === null) return true;
    return !(y > cut.y && (cut.dir > 0 ? x > cut.x : x < cut.x));
  }

  /** The main volume: a box, and for wrecked tall ones a stepped, broken top
   *  on one side. */
  body(v: Vol, colour: number, trimTop = 0): void {
    const y0 = v.y0 ?? 0;
    const col = this.cj(colour, 0.03);
    const tall = v.h >= 1.2 && this.cut === null;
    if (this.wrecked && tall) {
      const dir: 1 | -1 = this.rnd() < 0.5 ? 1 : -1;
      const frac = this.r(0.4, 0.6);
      const xc =
        dir > 0 ? v.x0 + (v.x1 - v.x0) * frac : v.x1 - (v.x1 - v.x0) * frac;
      const yc = y0 + Math.max(0.5, v.h * this.r(0.4, 0.55));
      this.cut = { dir, x: xc, y: yc };
      this.bag.box(v.x0, y0, v.z0, v.x1, yc, v.z1, col);
      const ux0 = dir > 0 ? v.x0 : xc;
      const ux1 = dir > 0 ? xc : v.x1;
      this.bag.box(ux0, yc, v.z0, ux1, y0 + v.h, v.z1, col);
      // Ragged edge: stubs of the fallen part.
      const edge = xc;
      for (let i = 0; i < 3; i++) {
        const zz = v.z0 + ((v.z1 - v.z0) * (i + 0.2)) / 3;
        const sw = (v.z1 - v.z0) / 3.4;
        const sh = this.r(0.1, 0.5) * v.h * 0.4;
        const ex = dir > 0 ? edge : edge - 0.22;
        this.bag.box(
          ex,
          yc,
          zz,
          ex + 0.22,
          yc + sh,
          zz + sw,
          this.cj(colour, 0.06),
        );
      }
    } else {
      this.bag.box(v.x0, y0, v.z0, v.x1, y0 + v.h - trimTop, v.z1, col);
      if (trimTop > 0) {
        this.bag.box(
          v.x0 - 0.02,
          y0 + v.h - trimTop,
          v.z0 - 0.02,
          v.x1 + 0.02,
          y0 + v.h,
          v.z1 + 0.02,
          this.c(0xe3dcc8),
        );
      }
    }
  }

  /** A flat quad on a wall: u along the wall, v height. */
  decal(
    f: Frame,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    colour: number,
    lift = 0.02,
    glow = false,
  ): void {
    const p = (u: number, v: number): Vec3 => [
      f.ox + f.tx * u + f.nx * lift,
      v,
      f.oz + f.tz * u + f.nz * lift,
    ];
    this.bag.quad(p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1), colour, glow);
  }

  /** A skewed polygon decal (cracks, holes): four (u, v) points. */
  decalPoly(
    f: Frame,
    pts: readonly [number, number][],
    colour: number,
    lift = 0.025,
  ): void {
    const p = (i: number): Vec3 => {
      const [u, v] = pts[i] as [number, number];
      return [f.ox + f.tx * u + f.nx * lift, v, f.oz + f.tz * u + f.nz * lift];
    };
    this.bag.quad(p(0), p(1), p(2), p(3), colour);
  }

  windowKind(litChance: number): WindowKind {
    const t = this.rnd();
    switch (this.state) {
      case "intact":
        return t < litChance ? "lit" : "dark";
      case "damaged":
        return t < 0.3 ? "broken" : t < 0.36 ? "lit" : "dark";
      case "wrecked":
        return t < 0.5 ? "hole" : t < 0.8 ? "broken" : "dark";
      default:
        return t < 0.55 ? "boarded" : t < 0.9 ? "dark" : "broken";
    }
  }

  /** One window at u (centre), v (sill height). */
  window(
    f: Frame,
    u: number,
    v: number,
    w: number,
    h: number,
    kind: WindowKind,
    trim: number,
    glass = 0x3d4c60,
  ): void {
    const x = f.ox + f.tx * u;
    if (!this.alive(x, v + h * 0.5)) return;
    const a = u - w / 2;
    const b = u + w / 2;
    if (kind === "hole") {
      const grow = 0.07;
      this.decalPoly(
        f,
        [
          [a - grow, v - grow * 0.5],
          [b + grow * 0.6, v - grow],
          [b + grow, v + h + grow * 1.6],
          [a - grow * 0.6, v + h + grow * 0.6],
        ],
        SOOT,
        0.012,
      );
      this.decal(f, a + 0.02, v + 0.02, b - 0.02, v + h - 0.02, CHAR, 0.022);
      return;
    }
    this.decal(
      f,
      a - 0.025,
      v - 0.025,
      b + 0.025,
      v + h + 0.025,
      this.c(trim),
      0.012,
    );
    if (kind === "boarded") {
      const wood = this.c(0x6f5030);
      this.decal(f, a, v, b, v + h, wood, 0.022);
      const plank = this.c(0x8a6a44);
      for (let i = 0; i < 3; i++) {
        const pv = v + (h * (i + 0.4)) / 3;
        this.decal(f, a - 0.03, pv, b + 0.03, pv + h * 0.2, plank, 0.032);
      }
      return;
    }
    const lit = kind === "lit";
    this.decal(
      f,
      a,
      v,
      b,
      v + h,
      lit ? 0xffe39a : kind === "broken" ? 0x14171b : this.c(glass),
      lit ? 0.022 : 0.022,
      lit,
    );
    if (kind === "broken") {
      const shard = 0x8da3b6;
      this.decalPoly(
        f,
        [
          [a, v + h],
          [a + w * 0.45, v + h],
          [a, v + h * 0.55],
          [a, v + h * 0.55],
        ],
        shard,
        0.03,
      );
      this.decalPoly(
        f,
        [
          [b, v],
          [b - w * 0.4, v],
          [b, v + h * 0.4],
          [b, v + h * 0.4],
        ],
        shard,
        0.03,
      );
    } else if (kind === "dark" && this.intact) {
      // Sky reflection on the upper half.
      this.decal(
        f,
        a,
        v + h * 0.55,
        b,
        v + h,
        mix(glass, 0xa9c4de, 0.45),
        0.026,
      );
    }
    // Mullion.
    if (w > 0.2)
      this.decal(f, u - 0.012, v, u + 0.012, v + h, this.c(trim), 0.034);
  }

  /** A regular grid of windows on a wall. */
  windows(v: Vol, face: FaceId, g: WindowGrid): void {
    const f = frameOf(v, face);
    const trim = g.trim ?? 0xeee8d8;
    for (let row = 0; row < g.rows; row++) {
      for (let col = 0; col < g.cols; col++) {
        if (g.skip?.(col, row) === true) continue;
        const u = (f.len * (col + 0.5)) / g.cols;
        const base = f.y0 + g.y0 + row * g.floorH;
        this.window(
          f,
          u,
          base,
          g.w,
          g.h,
          this.windowKind(g.lit ?? 0.28),
          trim,
          g.glass,
        );
      }
    }
  }

  /** A door on a wall at u (centre). */
  door(
    v: Vol,
    face: FaceId,
    u: number,
    w: number,
    h: number,
    colour: number,
  ): void {
    const f = frameOf(v, face);
    const base = f.y0;
    if (!this.alive(f.ox + f.tx * u, base + h * 0.5)) return;
    const a = u - w / 2;
    const b = u + w / 2;
    this.decal(
      f,
      a - 0.03,
      base,
      b + 0.03,
      base + h + 0.03,
      this.c(0xe8e2d0),
      0.012,
    );
    if (this.abandoned || this.wrecked) {
      this.decal(f, a, base, b, base + h, this.c(0x5a432a), 0.02);
      const plank = this.c(0x80623e);
      this.decal(
        f,
        a - 0.02,
        base + h * 0.25,
        b + 0.02,
        base + h * 0.4,
        plank,
        0.03,
      );
      this.decal(
        f,
        a - 0.02,
        base + h * 0.62,
        b + 0.02,
        base + h * 0.77,
        plank,
        0.03,
      );
    } else {
      this.decal(f, a, base, b, base + h, this.c(colour), 0.02);
      this.decal(
        f,
        b - w * 0.22,
        base + h * 0.45,
        b - w * 0.12,
        base + h * 0.52,
        0xd6b25a,
        0.03,
      );
    }
  }

  /** Cracks, soot, holes, stains and creeping green on the walls of a body. */
  wear(v: Vol): void {
    if (this.intact) return;
    const y0 = v.y0 ?? 0;
    for (const face of FACES) {
      const f = frameOf(v, face);
      const probe = (u: number, y: number): boolean =>
        this.alive(f.ox + f.tx * u, y);
      if (this.damaged) {
        this.crack(
          f,
          this.r(0.2, 0.8) * f.len,
          y0 + v.h * this.r(0.55, 0.9),
          v.h * 0.5,
          probe,
        );
        if (this.rnd() < 0.7) {
          this.crack(
            f,
            this.r(0.2, 0.8) * f.len,
            y0 + v.h * this.r(0.4, 0.8),
            v.h * 0.35,
            probe,
          );
        }
        const su = this.r(0.1, 0.9) * f.len;
        this.soot(
          f,
          su,
          y0 + v.h,
          Math.min(0.9, f.len * 0.4),
          v.h * 0.4,
          probe,
        );
      } else if (this.wrecked) {
        this.crack(
          f,
          this.r(0.15, 0.85) * f.len,
          y0 + v.h * 0.85,
          v.h * 0.6,
          probe,
        );
        const n = 1 + Math.floor(this.rnd() * 2);
        for (let i = 0; i < n; i++) {
          const hu = this.r(0.2, 0.8) * f.len;
          const hv = y0 + v.h * this.r(0.25, 0.7);
          if (!probe(hu, hv)) continue;
          const hw = this.r(0.18, 0.3);
          const hh = this.r(0.18, 0.32);
          this.decalPoly(
            f,
            [
              [hu - hw * 1.3, hv - hh * 1.2],
              [hu + hw * 1.4, hv - hh],
              [hu + hw * 1.2, hv + hh * 1.3],
              [hu - hw, hv + hh * 1.1],
            ],
            SOOT,
            0.013,
          );
          this.decalPoly(
            f,
            [
              [hu - hw, hv - hh * 0.7],
              [hu + hw * 0.9, hv - hh * 0.9],
              [hu + hw * 0.7, hv + hh * 0.8],
              [hu - hw * 0.8, hv + hh * 0.7],
            ],
            CHAR,
            0.03,
          );
        }
        this.soot(
          f,
          this.r(0.1, 0.9) * f.len,
          y0 + v.h,
          Math.min(1.1, f.len * 0.5),
          v.h * 0.5,
          probe,
        );
      } else if (this.abandoned) {
        for (let i = 0; i < 2; i++) {
          const u = this.r(0.08, 0.92) * f.len;
          const top = y0 + v.h * this.r(0.55, 0.95);
          if (!probe(u, top)) continue;
          this.decal(
            f,
            u - 0.04,
            top - v.h * this.r(0.4, 0.7),
            u + 0.04,
            top,
            mix(this.c(0x8a8478), 0x3a3a30, 0.45),
            0.016,
          );
        }
        this.growth(f, y0);
      }
    }
  }

  private crack(
    f: Frame,
    u: number,
    v: number,
    length: number,
    probe: (u: number, y: number) => boolean,
  ): void {
    let cu = u;
    let cv = v;
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const nu = cu + this.r(-0.12, 0.12);
      const nv = cv - length / steps;
      if (!probe(cu, cv) || nv < f.y0 + 0.05) break;
      this.decalPoly(
        f,
        [
          [cu - 0.014, cv],
          [cu + 0.014, cv],
          [nu + 0.014, nv],
          [nu - 0.014, nv],
        ],
        0x2b2825,
        0.02,
      );
      cu = nu;
      cv = nv;
    }
  }

  private soot(
    f: Frame,
    u: number,
    top: number,
    width: number,
    depth: number,
    probe: (u: number, y: number) => boolean,
  ): void {
    if (!probe(u, top - 0.05)) return;
    const a = Math.max(0, u - width / 2);
    const b = Math.min(f.len, u + width / 2);
    this.decalPoly(
      f,
      [
        [a, top],
        [b, top],
        [(a + b) / 2 + width * 0.2, top - depth],
        [(a + b) / 2 - width * 0.2, top - depth * 0.8],
      ],
      0x2e2a26,
      0.017,
    );
  }

  /** Dirty green creeping up from the ground on abandoned walls. */
  private growth(f: Frame, y0: number): void {
    const greens = [0x4d6b3a, 0x5b7a42, 0x3f5a30];
    let u = 0;
    while (u < f.len) {
      const w = this.r(0.12, 0.35);
      const h = this.r(0.05, 0.28);
      if (this.alive(f.ox + f.tx * u, y0 + h)) {
        this.decalPoly(
          f,
          [
            [u, y0],
            [u + w, y0],
            [u + w * 0.7, y0 + h],
            [u + w * 0.2, y0 + h * 0.8],
          ],
          this.pick(greens),
          0.018,
        );
      }
      u += w * this.r(0.8, 1.4);
    }
  }

  /** Fallen debris on and around a volume. */
  rubble(v: Vol, count: number, colours: readonly number[]): void {
    const y0 = v.y0 ?? 0;
    for (let i = 0; i < count; i++) {
      const s = this.r(0.06, 0.2);
      const x = this.r(v.x0 - 0.2, v.x1 + 0.2);
      const z = this.r(v.z0 - 0.2, v.z1 + 0.2);
      const h = s * this.r(0.5, 1.2);
      this.bag.box(
        x - s,
        y0,
        z - s * this.r(0.6, 1.2),
        x + s,
        y0 + h,
        z + s * this.r(0.6, 1.2),
        this.cj(this.pick(colours), 0.08),
      );
    }
  }

  /** Flat roof with a parapet; wrecked ones are open in parts, abandoned dirty. */
  roofFlat(v: Vol, colour: number, parapet = 0.09, topY?: number): void {
    const y = topY ?? (v.y0 ?? 0) + v.h;
    let x0 = v.x0;
    let x1 = v.x1;
    if (this.cut !== null && topY === undefined) {
      // Only the standing part is roofed.
      if (this.cut.dir > 0) x1 = Math.min(x1, this.cut.x);
      else x0 = Math.max(x0, this.cut.x);
    }
    const col = this.c(colour);
    this.bag.box(x0, y, v.z0, x1, y + 0.03, v.z1, col);
    const pc = this.c(0xcfc9b8);
    const edges: [number, number, number, number][] = [
      [x0 - 0.02, v.z1 - 0.06, x1 + 0.02, v.z1 + 0.02],
      [x0 - 0.02, v.z0 - 0.02, x1 + 0.02, v.z0 + 0.06],
      [x0 - 0.02, v.z0 - 0.02, x0 + 0.06, v.z1 + 0.02],
      [x1 - 0.06, v.z0 - 0.02, x1 + 0.02, v.z1 + 0.02],
    ];
    for (const e of edges) {
      if (this.wrecked && this.rnd() < 0.4) continue;
      this.bag.box(e[0], y, e[1], e[2], y + parapet, e[3], pc);
    }
    if (this.wrecked) {
      const hx = this.r(x0 + 0.1, x1 - 0.5);
      this.bag.box(
        hx,
        y + 0.031,
        v.z0 + 0.2,
        hx + 0.45,
        y + 0.034,
        v.z0 + 0.7,
        CHAR,
      );
    } else if (this.abandoned) {
      this.bag.box(
        x0 + 0.2,
        y + 0.031,
        v.z0 + 0.15,
        x0 + 0.7,
        y + 0.034,
        v.z0 + 0.5,
        0x4b6038,
      );
    }
  }

  /** A roof of two slopes; a wrecked one has lost a slope and shows rafters. */
  roofGable(
    v: Vol,
    rise: number,
    colour: number,
    ridge: "x" | "z",
    over = 0.07,
  ): void {
    const y = (v.y0 ?? 0) + v.h;
    const x0 = v.x0 - over;
    const x1 = v.x1 + over;
    const z0 = v.z0 - over;
    const z1 = v.z1 + over;
    const col = this.cj(colour, 0.03);
    const gcol = this.c(0xd8cfba);
    if (this.wrecked) {
      const dropA = this.rnd() < 0.5;
      this.bag.gable(
        x0,
        z0,
        x1,
        z1,
        y,
        rise,
        col,
        ridge,
        gcol,
        dropA ? { slopeA: true } : { slopeB: true },
      );
      // Rafters of the missing slope.
      const n = 5;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        if (ridge === "x") {
          const x = x0 + (x1 - x0) * t;
          const zEdge = dropA ? z1 : z0;
          this.bag.ribbon(
            [x, y, zEdge],
            [x, y + rise, (z0 + z1) / 2],
            0.015,
            0x3a2c20,
          );
        } else {
          const z = z0 + (z1 - z0) * t;
          const xEdge = dropA ? x1 : x0;
          this.bag.ribbon(
            [xEdge, y, z],
            [(x0 + x1) / 2, y + rise, z],
            0.015,
            0x3a2c20,
          );
        }
      }
      return;
    }
    this.bag.gable(x0, z0, x1, z1, y, rise, col, ridge, gcol);
    // Ridge cap.
    const rc = this.c(mix(colour, 0x000000, 0.2));
    if (ridge === "x")
      this.bag.box(
        x0,
        y + rise - 0.01,
        (z0 + z1) / 2 - 0.03,
        x1,
        y + rise + 0.025,
        (z0 + z1) / 2 + 0.03,
        rc,
      );
    else
      this.bag.box(
        (x0 + x1) / 2 - 0.03,
        y + rise - 0.01,
        z0,
        (x0 + x1) / 2 + 0.03,
        y + rise + 0.025,
        z1,
        rc,
      );
    if (this.damaged || this.abandoned) {
      // Missing tiles: dark patches lying on the slopes.
      const patches = this.damaged ? 2 : 4;
      const col2 = this.damaged ? SOOT : 0x45392c;
      for (let i = 0; i < patches; i++) {
        const t = this.r(0.12, 0.88);
        const s0 = this.r(0.1, 0.5);
        const s1 = s0 + this.r(0.15, 0.3);
        const half = this.r(0.06, 0.16);
        const side = this.rnd() < 0.5 ? 0 : 1;
        // Point on the slope at (t along the ridge, s from eave to ridge).
        const at = (tt: number, ss: number): Vec3 => {
          if (ridge === "x") {
            const zm = (z0 + z1) / 2;
            const ze = side === 0 ? z1 : z0;
            return [
              x0 + (x1 - x0) * tt,
              y + rise * ss + 0.012,
              ze + (zm - ze) * ss,
            ];
          }
          const xm = (x0 + x1) / 2;
          const xe = side === 0 ? x1 : x0;
          return [
            xe + (xm - xe) * ss,
            y + rise * ss + 0.012,
            z0 + (z1 - z0) * tt,
          ];
        };
        const dt = half / (ridge === "x" ? x1 - x0 : z1 - z0);
        const pts = [
          at(t - dt, s0),
          at(t + dt, s0),
          at(t + dt, s1),
          at(t - dt, s1),
        ] as [Vec3, Vec3, Vec3, Vec3];
        this.bag.quad2(pts[0], pts[1], pts[2], pts[3], col2);
      }
    }
  }
}
