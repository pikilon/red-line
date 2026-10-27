import { BufferGeometry, Color, Float32BufferAttribute } from "three";

/** Spec 26 section 5.1: procedural civilian buildings are merged flat-shaded
 *  geometry. This is the geometry sink: quads and boxes in building-local
 *  coordinates (origin at the footprint centre on the ground, +z = front),
 *  turned by quarter turns and moved to the world on the way in. */

export type Vec3 = readonly [number, number, number];

export class Chan {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  get triangles(): number {
    return this.pos.length / 9;
  }
}

const scratch = new Color();

export class MeshBag {
  /** Lit by the scene lights. */
  readonly solid = new Chan();
  /** Unlit and bright: lit windows and lamps. */
  readonly glow = new Chan();
  private cos = 1;
  private sin = 0;
  private ox = 0;
  private oy = 0;
  private oz = 0;

  /** Local space -> world: quarter turns about Y, then the origin. */
  setFrame(x: number, y: number, z: number, rot: number): void {
    const a = ((rot % 4) + 4) % 4;
    this.cos = [1, 0, -1, 0][a] as number;
    this.sin = [0, 1, 0, -1][a] as number;
    this.ox = x;
    this.oy = y;
    this.oz = z;
  }

  private world(p: Vec3): Vec3 {
    return [
      p[0] * this.cos + p[2] * this.sin + this.ox,
      p[1] + this.oy,
      -p[0] * this.sin + p[2] * this.cos + this.oz,
    ];
  }

  private turn(x: number, y: number, z: number): Vec3 {
    return [x * this.cos + z * this.sin, y, -x * this.sin + z * this.cos];
  }

  /** A flat quad (a, b, c, d counter-clockwise seen from outside). */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, colour: number, glow = false): void {
    // Normal from the diagonals: stable for slightly skewed quads.
    const ux = c[0] - a[0];
    const uy = c[1] - a[1];
    const uz = c[2] - a[2];
    const vx = d[0] - b[0];
    const vy = d[1] - b[1];
    const vz = d[2] - b[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len;
    ny /= len;
    nz /= len;
    const n = this.turn(nx, ny, nz);
    const chan = glow ? this.glow : this.solid;
    scratch.set(colour);
    const w = [this.world(a), this.world(b), this.world(c), this.world(d)];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = w[i] as Vec3;
      chan.pos.push(p[0], p[1], p[2]);
      chan.nor.push(n[0], n[1], n[2]);
      chan.col.push(scratch.r, scratch.g, scratch.b);
    }
  }

  tri(a: Vec3, b: Vec3, c: Vec3, colour: number, glow = false): void {
    // A degenerate quad (d = c) has the diagonals a-c and b-c: still a normal.
    this.quad(a, b, c, c, colour, glow);
  }

  /** Axis-aligned box (local axes) without its bottom face. */
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    colour: number,
    opts: { bottom?: boolean; glow?: boolean } = {},
  ): void {
    const g = opts.glow === true;
    this.quad(
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
      colour,
      g,
    );
    this.quad(
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      colour,
      g,
    );
    this.quad(
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      colour,
      g,
    );
    this.quad(
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
      colour,
      g,
    );
    this.quad(
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x0, y1, z0],
      colour,
      g,
    );
    if (opts.bottom === true) {
      this.quad(
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
        colour,
        g,
      );
    }
  }

  /** Both sides of a quad (rafters, planks, leaves). */
  quad2(a: Vec3, b: Vec3, c: Vec3, d: Vec3, colour: number): void {
    this.quad(a, b, c, d, colour);
    this.quad(d, c, b, a, colour);
  }

  /** A beam between two points, as a ribbon of the given half width that
   *  stays horizontal across its length. */
  ribbon(a: Vec3, b: Vec3, half: number, colour: number): void {
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    const px = len < 1e-6 ? half : (-dz / len) * half;
    const pz = len < 1e-6 ? 0 : (dx / len) * half;
    this.quad2(
      [a[0] - px, a[1], a[2] - pz],
      [a[0] + px, a[1], a[2] + pz],
      [b[0] + px, b[1], b[2] + pz],
      [b[0] - px, b[1], b[2] - pz],
      colour,
    );
  }

  /** Frustum between two rectangles (x0, z0, x1, z1) at heights y and y + h:
   *  hip roofs (top is a line), pyramids (top is a point), tapered towers. */
  frustum(
    base: readonly [number, number, number, number],
    top: readonly [number, number, number, number],
    y: number,
    h: number,
    colour: number,
    cap = true,
  ): void {
    const [bx0, bz0, bx1, bz1] = base;
    const [tx0, tz0, tx1, tz1] = top;
    const yt = y + h;
    this.quad(
      [bx0, y, bz1],
      [bx1, y, bz1],
      [tx1, yt, tz1],
      [tx0, yt, tz1],
      colour,
    );
    this.quad(
      [bx1, y, bz0],
      [bx0, y, bz0],
      [tx0, yt, tz0],
      [tx1, yt, tz0],
      colour,
    );
    this.quad(
      [bx1, y, bz1],
      [bx1, y, bz0],
      [tx1, yt, tz0],
      [tx1, yt, tz1],
      colour,
    );
    this.quad(
      [bx0, y, bz0],
      [bx0, y, bz1],
      [tx0, yt, tz1],
      [tx0, yt, tz0],
      colour,
    );
    if (cap) {
      this.quad(
        [tx0, yt, tz1],
        [tx1, yt, tz1],
        [tx1, yt, tz0],
        [tx0, yt, tz0],
        colour,
      );
    }
  }

  /** Triangular prism: base rectangle, ridge along x or z at height rise. */
  gable(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    rise: number,
    colour: number,
    ridge: "x" | "z",
    gableColour = colour,
    skip: { slopeA?: boolean; slopeB?: boolean } = {},
  ): void {
    if (ridge === "x") {
      const zm = (z0 + z1) / 2;
      if (skip.slopeA !== true)
        this.quad(
          [x0, y, z1],
          [x1, y, z1],
          [x1, y + rise, zm],
          [x0, y + rise, zm],
          colour,
        );
      if (skip.slopeB !== true)
        this.quad(
          [x1, y, z0],
          [x0, y, z0],
          [x0, y + rise, zm],
          [x1, y + rise, zm],
          colour,
        );
      this.tri([x1, y, z1], [x1, y, z0], [x1, y + rise, zm], gableColour);
      this.tri([x0, y, z0], [x0, y, z1], [x0, y + rise, zm], gableColour);
    } else {
      const xm = (x0 + x1) / 2;
      if (skip.slopeA !== true)
        this.quad(
          [x1, y, z1],
          [x1, y, z0],
          [xm, y + rise, z0],
          [xm, y + rise, z1],
          colour,
        );
      if (skip.slopeB !== true)
        this.quad(
          [x0, y, z0],
          [x0, y, z1],
          [xm, y + rise, z1],
          [xm, y + rise, z0],
          colour,
        );
      this.tri([x0, y, z1], [x1, y, z1], [xm, y + rise, z1], gableColour);
      this.tri([x1, y, z0], [x0, y, z0], [xm, y + rise, z0], gableColour);
    }
  }

  /** Upright cylinder or cone (rTop = 0 for a point) with `sides` facets. */
  cyl(
    cx: number,
    cz: number,
    r: number,
    y0: number,
    y1: number,
    colour: number,
    sides = 8,
    rTop = r,
    capColour = colour,
  ): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const p = (a: number, rr: number, y: number): Vec3 => [
        cx + Math.cos(a) * rr,
        y,
        cz + Math.sin(a) * rr,
      ];
      if (rTop > 1e-6) {
        this.quad(
          p(a1, r, y0),
          p(a0, r, y0),
          p(a0, rTop, y1),
          p(a1, rTop, y1),
          colour,
        );
        this.tri([cx, y1, cz], p(a1, rTop, y1), p(a0, rTop, y1), capColour);
      } else {
        this.tri(p(a1, r, y0), p(a0, r, y0), [cx, y1, cz], colour);
      }
    }
  }

  get triangles(): number {
    return this.solid.triangles + this.glow.triangles;
  }
}

/** Builds the BufferGeometry of one channel; null when empty. */
export function geometryOf(chan: Chan): BufferGeometry | null {
  if (chan.pos.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(chan.pos, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(chan.nor, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(chan.col, 3));
  return geometry;
}
