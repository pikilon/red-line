import { fbm, smoothstep } from "./noise";

/** Spec 26 Phase 3: paints the roads of a map into one RGBA image covering the
 *  whole map. The compiled layer only knows which cells are road, so the shape
 *  (rounded corners, ragged edges), the lane centre (a distance transform) and
 *  the intersections are all derived from the cells. */

/** Largest side of the road image in pixels. */
const MAX_SIDE = 2048;
const MAX_RES = 16;

export const ROAD_ASPHALT = 1;
export const ROAD_DIRT = 2;

type Rgb = readonly [number, number, number];

const ASPHALT_DARK: Rgb = [46, 48, 52];
const ASPHALT_LIGHT: Rgb = [76, 78, 80];
const ASPHALT_WORN: Rgb = [112, 108, 98];
const LANE_PAINT: Rgb = [232, 220, 158];
const DIRT_BASE: Rgb = [146, 112, 72];
const DIRT_LIGHT: Rgb = [172, 138, 92];
const RUT: Rgb = [96, 68, 42];
const TUFT: Rgb = [92, 112, 52];

export interface RoadImage {
  readonly width: number;
  readonly height: number;
  /** Pixels per cell. */
  readonly res: number;
  /** RGBA8, row-major, straight alpha. */
  readonly pixels: Uint8Array;
}

/** Pixels per cell for a map of `cols` x `rows` cells. */
export const roadResolution = (cols: number, rows: number): number =>
  Math.max(2, Math.min(MAX_RES, Math.floor(MAX_SIDE / Math.max(cols, rows))));

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];
const shade = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

function hash(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x, 0x27d4eb2d) ^
    Math.imul(y, 0x165667b1) ^
    Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Chamfer distance (1 / 1.414) from every road pixel to the nearest
 *  non-road pixel. The map border does not count as an edge, so a road that
 *  leaves the map keeps its lane centre. */
function distanceToEdge(road: Uint8Array, w: number, h: number): Float32Array {
  const far = 1e6;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = road[i] ? far : 0;
  const diag = Math.SQRT2;
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? far : (d[y * w + x] ?? far);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!road[i]) continue;
      d[i] = Math.min(
        d[i] ?? far,
        at(x - 1, y) + 1,
        at(x, y - 1) + 1,
        at(x - 1, y - 1) + diag,
        at(x + 1, y - 1) + diag,
      );
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!road[i]) continue;
      d[i] = Math.min(
        d[i] ?? far,
        at(x + 1, y) + 1,
        at(x, y + 1) + 1,
        at(x + 1, y + 1) + diag,
        at(x - 1, y + 1) + diag,
      );
    }
  }
  return d;
}

/** Max filter of radius `r` (separable). */
function maxFilter(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) m = Math.max(m, src[y * w + xx] ?? 0);
      }
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) m = Math.max(m, tmp[yy * w + x] ?? 0);
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Half widths (cells) at which many lane-centre pixels sit: one per road
 *  width of the type. Rarer distances (crossings) are left out. */
function halfWidths(ridgeDistances: readonly number[], res: number): number[] {
  if (ridgeDistances.length === 0) return [];
  const bins = new Map<number, number>();
  for (const d of ridgeDistances) {
    const bin = Math.round(d / res / 0.1);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const peaks: number[] = [];
  for (const [bin, count] of bins) {
    const left = bins.get(bin - 1) ?? 0;
    const right = bins.get(bin + 1) ?? 0;
    const isTop = count >= left && count >= right;
    if (isTop && count + left + right >= ridgeDistances.length * 0.08) {
      peaks.push(bin * 0.1);
    }
  }
  return peaks;
}

/** Paints the roads of `roads` (0 none, 1 asphalt, 2 dirt; row-major). Returns
 *  null when the map has no road cell. */
export function bakeRoads(
  roads: Uint8Array,
  cols: number,
  rows: number,
  seed = 3,
): RoadImage | null {
  if (!roads.some((r) => r !== 0)) return null;
  const res = roadResolution(cols, rows);
  const w = cols * res;
  const h = rows * res;
  const cell = (x: number, y: number, kind: number): number => {
    const cx = Math.min(cols - 1, Math.max(0, x));
    const cy = Math.min(rows - 1, Math.max(0, y));
    return (roads[cy * cols + cx] ?? 0) === kind ? 1 : 0;
  };

  // 1. Shape: bilinear coverage per type with a slightly ragged border.
  const type = new Uint8Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const wx = (px + 0.5) / res;
      const wy = (py + 0.5) / res;
      const sx = wx + (fbm(wx * 1.3, wy * 1.3, seed) - 0.5) * 0.22 - 0.5;
      const sy =
        wy + (fbm(wx * 1.3 + 9, wy * 1.3 + 4, seed + 1) - 0.5) * 0.22 - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = smoothstep(0.1, 0.9, sx - x0);
      const fy = smoothstep(0.1, 0.9, sy - y0);
      let best = 0;
      let bestCover = 0;
      for (const kind of [ROAD_ASPHALT, ROAD_DIRT]) {
        const cover =
          cell(x0, y0, kind) * (1 - fx) * (1 - fy) +
          cell(x0 + 1, y0, kind) * fx * (1 - fy) +
          cell(x0, y0 + 1, kind) * (1 - fx) * fy +
          cell(x0 + 1, y0 + 1, kind) * fx * fy;
        if (cover > bestCover) {
          bestCover = cover;
          best = kind;
        }
      }
      const i = py * w + px;
      type[i] = best === 0 ? ROAD_ASPHALT : best;
      mask[i] = bestCover >= 0.5 ? 1 : 0;
    }
  }

  // 2. Lane centres: the ridge of the distance field.
  const dist = distanceToEdge(mask, w, h);
  const peakFilter = maxFilter(dist, w, h, 3);
  const ridge = new Uint8Array(w * h);
  const ridgeDistances: number[][] = [[], [], []];
  for (let i = 0; i < ridge.length; i++) {
    const d = dist[i] ?? 0;
    if (
      mask[i] &&
      d > res * 0.45 &&
      d < 1e5 &&
      d >= (peakFilter[i] ?? 0) - 1.1
    ) {
      ridge[i] = 1;
      ridgeDistances[type[i] ?? 1]?.push(d);
    }
  }
  const widths: number[][] = ridgeDistances.map((list) =>
    halfWidths(list, res),
  );
  /** Distance in cells between `cells` and the closest road half width of the
   *  type, or 99 when none is within `tolerance`. */
  const nearWidth = (
    kind: number,
    cells: number,
    tolerance: number,
  ): number => {
    let best = 99;
    for (const half of widths[kind] ?? []) {
      best = Math.min(best, Math.abs(cells - half));
    }
    return best <= tolerance ? best : 99;
  };
  const isRidge = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && ridge[y * w + x] === 1;

  // 3. Paint.
  const pixels = new Uint8Array(w * h * 4);
  const dashPeriod = res * 2.2;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      const kind = type[i] ?? ROAD_ASPHALT;
      const wx = (px + 0.5) / res;
      const wy = (py + 0.5) / res;
      const d = mask[i] ? (dist[i] ?? 0) / res : 0; // cells to the edge
      const grain = hash(px, py, seed);
      const patch = fbm(wx * 0.9, wy * 0.9, seed + 20);
      let colour: Rgb;
      let alpha: number;
      if (kind === ROAD_ASPHALT) {
        colour = mixRgb(ASPHALT_DARK, ASPHALT_LIGHT, patch * 0.8 + grain * 0.2);
        // Worn shoulders: dust and gravel creep in from the edge.
        const wear =
          (1 - smoothstep(0.02, 0.32, d)) *
          (0.45 + 0.55 * fbm(wx * 3, wy * 3, seed + 4));
        colour = mixRgb(colour, ASPHALT_WORN, Math.min(1, wear * 1.1));
        // Tyre-polished bands a little off the centre line.
        if (Math.abs(d - 0.55) < 0.28 && d > 0.3) colour = shade(colour, 0.9);
        // Cracks and patched stretches.
        const crack = Math.abs(fbm(wx * 2.2, wy * 2.2, seed + 30) - 0.5);
        if (crack < 0.011 && d > 0.15) colour = shade(colour, 0.5);
        if (fbm(wx * 0.5, wy * 0.5, seed + 40) > 0.66)
          colour = shade(colour, 0.9);
        alpha = smoothstep(0, 1.6 / res, d);
        if (d < 0.14 && fbm(wx * 4, wy * 4, seed + 6) > 0.62) alpha *= 0.35;
        // Lane dashes along the centre of the road, not inside crossings.
        if (nearWidth(ROAD_ASPHALT, d, 0.075) < 99) {
          const near = (dx: number, dy: number): boolean =>
            isRidge(px + dx, py + dy) || isRidge(px - dx, py - dy);
          const horizontal = near(5, 0) || near(9, 0);
          const vertical = near(0, 5) || near(0, 9);
          const phase = horizontal && !vertical ? px : py;
          const along = ((phase % dashPeriod) + dashPeriod) % dashPeriod;
          if (
            horizontal !== vertical &&
            along < dashPeriod * 0.5 &&
            fbm(wx * 5, wy * 5, seed + 50) < 0.68
          ) {
            colour = mixRgb(colour, LANE_PAINT, 0.88 - patch * 0.2);
          }
        }
      } else {
        colour = mixRgb(DIRT_BASE, DIRT_LIGHT, patch * 0.8 + grain * 0.2);
        // Two tyre ruts half a cell either side of the middle, and a worn
        // hump with tufts of grass between them.
        const rutAt = nearWidth(ROAD_DIRT, d + 0.55, 0.12);
        if (rutAt < 99 && d > 0.2) {
          colour = mixRgb(
            colour,
            RUT,
            0.7 * (1 - rutAt / 0.12) * (0.7 + 0.3 * patch),
          );
        }
        if (nearWidth(ROAD_DIRT, d, 0.22) < 99 && grain < 0.07) {
          colour = mixRgb(colour, TUFT, 0.8);
        }
        // Feathered, uneven edge.
        const reach = 0.22 + 0.45 * fbm(wx * 2.5, wy * 2.5, seed + 8);
        alpha = smoothstep(0, reach, d);
      }
      const o = i * 4;
      pixels[o] = colour[0];
      pixels[o + 1] = colour[1];
      pixels[o + 2] = colour[2];
      pixels[o + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
  }
  return { width: w, height: h, res, pixels };
}
