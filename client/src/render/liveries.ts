import {
  type Box3,
  type BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import { DARK_MASK } from "./generatedTextures";

/** Spec 13: painted flag patches, blue and yellow on Ukrainian vehicles and a
 *  white Z over the Russian tricolour on Russian ones. */
export const LIVERIES = { ua: "ua", ru: "ru" } as const;
export type Livery = (typeof LIVERIES)[keyof typeof LIVERIES];

/** The two decals of a livery: the `mark` (the flag on `ua`, the sprayed Z on
 *  `ru`) and a small `flag` patch, placed on separate surfaces on `ru`. */
export const DECALS = { mark: "mark", flag: "flag" } as const;
export type Decal = (typeof DECALS)[keyof typeof DECALS];

export const UA_BLUE = 0x2f5d8c;
export const UA_YELLOW = 0xc4a13c;
export const RU_WHITE = 0xd6d2c4;
/** The tricolour is brighter than the rest of the paint so it reads (owner). */
export const RU_BLUE = 0x2f5fc0;
export const RU_RED = 0xcc3a2c;

/** Per-vertex (u, v, mask) attribute name of a livery geometry. */
export const LIVERY_ATTRIBUTE = "livery";

const INFANTRY_ARMOR = 0;
const TEXTURE_SIZE = 256;
/** Share of the short extent of a surface that the patch takes (spec 13 §3). */
const PATCH_SIZE: Readonly<Record<Livery, Readonly<Record<Decal, number>>>> = {
  ua: { mark: 1, flag: 1 },
  ru: { mark: 1.1, flag: 0.9 },
};
/** A patch may be this much wider than tall (a flag is 3:2, and the
 *  isometric view squashes it). */
const PATCH_ASPECT = 1.9;
/** Width of the ragged, hand-painted border of a patch. */
const EDGE = 0.035;
/** Per-vertex mask of each decal: 1 flag patch (flat), 2 the small flag in the
 *  right half of the atlas, 3 the painted Z (keeps the relief of the skin). */
const MASKS: Readonly<Record<Livery, Readonly<Record<Decal, number>>>> = {
  ua: { mark: 1, flag: 2 },
  ru: { mark: 3, flag: 2 },
};
/** The weathered paint is this much darker than its flag colour. */
const WEATHER_DARKEN = 1;
const Z_LEFT = 0.08;
const Z_RIGHT = 0.92;
const Z_TOP = [0.83, 0.9] as const;
const Z_BOTTOM = [0.1, 0.17] as const;
const Z_STROKE = 0.035;
/** How far the brush wobbles the edge of the Z, and how sharp that edge is. */
const BRUSH_WOBBLE = 0.03;
const BRUSH_EDGE = 0.012;

/** Types whose turret carries the flag on its roof (spec 13 §3). */
export const FLAG_ON_TURRET: ReadonlySet<string> = new Set(["ua-himars"]);

/** Types whose Z is painted on the turret roof (a launcher). */
export const Z_ON_TURRET: ReadonlySet<string> = new Set(["ru-tos-1a"]);

/** Hulls whose roof is split: tricolour in front, the Z behind it (owner). */
export const SPLIT_ROOF: ReadonlySet<string> = new Set([
  "ru-bmp-2",
  "ru-brdm-scout",
]);

/** Hulls whose Z goes on the bow glacis, a bit smaller (owner). */
export const Z_ON_BOW: ReadonlySet<string> = new Set(["ru-bmp-2"]);

const FACTION_LIVERY: Readonly<Record<string, Livery>> = {
  "ua-": LIVERIES.ua,
  "ru-": LIVERIES.ru,
};

/** The livery of a type, or `null` for infantry, buildings and depots. */
export function liveryOf(
  typeId: string,
  category: string,
  armor: number,
): Livery | null {
  if (category !== "unit" || armor === INFANTRY_ARMOR) return null;
  return FACTION_LIVERY[typeId.slice(0, 3)] ?? null;
}

/** Deterministic lattice hash in 0..1. */
function hash(i: number, j: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise in 0..1. */
function noise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * sx;
  const bottom = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * sx;
  return top + (bottom - top) * sy;
}

/** Opaque inside the patch, a ragged brushed border `EDGE` wide, 0 outside. */
function patchAlpha(u: number, v: number): number {
  const distance = Math.min(u, 1 - u, v, 1 - v);
  const ragged = EDGE * (0.5 + noise(u * 13 + 1.7, v * 11 + 4.3));
  return Math.max(0, Math.min(1, (distance - ragged) / (EDGE * 0.6)));
}

function distanceToDiagonal(u: number, v: number): number {
  // Segment from the top-right to the bottom-left of the Z.
  const ax = Z_RIGHT;
  const ay = (Z_TOP[0] + Z_TOP[1]) / 2;
  const bx = Z_LEFT;
  const by = (Z_BOTTOM[0] + Z_BOTTOM[1]) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(u - (ax + t * dx), v - (ay + t * dy));
}

function flagColor(livery: Livery, u: number, v: number): number {
  // The bands wobble a little, like a hand-painted flag.
  const wobble = (noise(u * 9 + 2.1, 3.7) - 0.5) * 0.03;
  if (livery === LIVERIES.ua) return v >= 0.5 + wobble ? UA_BLUE : UA_YELLOW;
  const x = v + wobble;
  if (x >= 2 / 3) return RU_WHITE;
  return x >= 1 / 3 ? RU_BLUE : RU_RED;
}

/** Distance from (u, v) to the rectangle [x0, x1] x [y0, y1]; 0 inside. */
function distanceToRect(
  u: number,
  v: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  return Math.hypot(Math.max(x0 - u, 0, u - x1), Math.max(y0 - v, 0, v - y1));
}

/** Distance from (u, v) to the strokes of the Z; 0 on them. */
function distanceToZ(u: number, v: number): number {
  return Math.min(
    distanceToRect(u, v, Z_LEFT, Z_RIGHT, Z_TOP[0], Z_TOP[1]),
    distanceToRect(u, v, Z_LEFT, Z_RIGHT, Z_BOTTOM[0], Z_BOTTOM[1]),
    Math.max(distanceToDiagonal(u, v) - Z_STROKE, 0),
  );
}

/** The decal at (u, v), both in 0..1, v up: colour 0xRRGGBB and alpha 0..1.
 *  `ua` paints its flag patch for both decals; on `ru` the `mark` is the Z
 *  painted straight on the skin (no background) and the `flag` is a small
 *  tricolour patch. */
export function liverySample(
  livery: Livery,
  decal: Decal,
  u: number,
  v: number,
): { color: number; alpha: number } {
  if (livery === LIVERIES.ru && decal === DECALS.mark) {
    // Brushed white paint: a firm edge that wobbles, never an airbrush fade.
    const wobble = (noise(u * 40 + 3.1, v * 40 + 9.7) - 0.5) * BRUSH_WOBBLE;
    const distance = distanceToZ(u, v);
    return {
      color: RU_WHITE,
      alpha:
        distance <= 0
          ? 1
          : Math.max(0, Math.min(1, 1 - (distance + wobble) / BRUSH_EDGE)),
    };
  }
  return { color: flagColor(livery, u, v), alpha: patchAlpha(u, v) };
}

/** Paint that ran down from the bottom bar of the Z: thin streaks, 0..0.8. */
function drip(u: number, v: number): number {
  if (u < Z_LEFT || u > Z_RIGHT || v >= Z_BOTTOM[0]) return 0;
  const column = Math.floor(u * 70);
  if (hash(column, 7) < 0.9) return 0;
  const length = 0.04 + 0.1 * hash(column, 11);
  const inside = Math.abs(u * 70 - column - 0.5) < 0.2;
  return inside && v > Z_BOTTOM[0] - length ? 0.8 : 0;
}

/** 512 x 256 clamp-to-edge atlas: the `mark` on the left, the `flag` on the
 *  right (spec 13 §2). Paint is weathered: brush streaks, grime and chips on the
 *  patches, dry-brush streaks and drips on the Z. */
export function createLiveryTexture(livery: Livery): DataTexture {
  const width = TEXTURE_SIZE * 2;
  const data = new Uint8Array(width * TEXTURE_SIZE * 4);
  for (const decal of [DECALS.mark, DECALS.flag]) {
    const x0 = decal === DECALS.mark ? 0 : TEXTURE_SIZE;
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const u = (x + 0.5) / TEXTURE_SIZE;
        const v = (y + 0.5) / TEXTURE_SIZE;
        const sample = liverySample(livery, decal, u, v);
        const sprayed = livery === LIVERIES.ru && decal === DECALS.mark;
        const streak = 0.9 + 0.1 * noise(u * 3 + 9.1, v * 70);
        const grime =
          0.82 + 0.18 * noise(u * 5 + 3.3, v * 5 + 8.8) * noise(u * 17, v * 17);
        const shade = streak * grime * WEATHER_DARKEN;
        let alpha = sample.alpha;
        if (sprayed) {
          // Painted by hand: dry-brush streaks follow the strokes, the paint is
          // thin in places and drips below the bottom bar.
          alpha *= 0.7 + 0.3 * noise(u * 9 + 1.3, v * 140);
          alpha *= 0.85 + 0.15 * noise(u * 120, v * 12);
          alpha = Math.max(alpha, drip(u, v));
        } else if (
          noise(u * 41 + 6.1, v * 41 + 2.9) > 0.74 &&
          noise(u * 9, v * 9) > 0.45
        ) {
          alpha *= 0.5; // chipped down to the skin
        }
        const offset = (y * width + x0 + x) * 4;
        data[offset] = ((sample.color >> 16) & 0xff) * shade;
        data[offset + 1] = ((sample.color >> 8) & 0xff) * shade;
        data[offset + 2] = (sample.color & 0xff) * shade;
        data[offset + 3] = alpha * 255;
      }
    }
  }
  const texture = new DataTexture(
    data,
    width,
    TEXTURE_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

type Face = "side" | "top" | "end" | "bottom";

/** A triangle counts as a flat face when its normal is this close to an axis. */
const FLAT_FACE = 0.95;
/** Roofs may slope this much (a glacis or hood): the normal's y at least. */
const SLOPED_ROOF = 0.4;
/** A surface whose short side is below this (model units) gets no decal. */
const MIN_DECAL_SURFACE = 0.12;
/** A roof this flat (|normal.y|) can carry the Z without smearing. */
const FLAT_ROOF = 0.97;
const PLANE_STEP = 0.02;
const TOUCH_GAP = 0.02;

function faceOf(axis: number, sign: number): Face {
  if (axis === 0) return "side";
  if (axis === 1) return sign > 0 ? "top" : "bottom";
  return "end";
}

interface Surface {
  readonly axis: number;
  readonly sign: number;
  readonly plane: number;
  /** |normal.y| of the surface: 1 is flat, lower leans (a glacis). */
  readonly lean: number;
  readonly triangles: number[];
  readonly min: number[];
  readonly max: number[];
  area: number;
}

/** `values[k]`, 0 when absent (strict indexed access). */
function at(values: readonly number[], k: number): number {
  return values[k] ?? 0;
}

type PositionAttribute = BufferGeometry["attributes"][string];

function triangleCorner(position: PositionAttribute, index: number): number[] {
  return [position.getX(index), position.getY(index), position.getZ(index)];
}

/** Groups the flat triangles of `position` (non-indexed) into connected
 *  coplanar surfaces, so one glyph can sit on one surface (spec 13 §3). */
function surfacesOf(
  position: PositionAttribute,
  dark: PositionAttribute | null,
): Surface[] {
  const surfaces: Surface[] = [];
  for (let t = 0; t < position.count / 3; t++) {
    if ([0, 1, 2].some((k) => (dark?.getX(t * 3 + k) ?? 0) > 0)) continue;
    const corners = [0, 1, 2].map((k) => triangleCorner(position, t * 3 + k));
    const a = corners[0] ?? [];
    const b = corners[1] ?? [];
    const c = corners[2] ?? [];
    const e1 = [0, 1, 2].map((k) => at(b, k) - at(a, k));
    const e2 = [0, 1, 2].map((k) => at(c, k) - at(a, k));
    const n = [
      at(e1, 1) * at(e2, 2) - at(e1, 2) * at(e2, 1),
      at(e1, 2) * at(e2, 0) - at(e1, 0) * at(e2, 2),
      at(e1, 0) * at(e2, 1) - at(e1, 1) * at(e2, 0),
    ];
    const length = Math.hypot(at(n, 0), at(n, 1), at(n, 2));
    if (length < 1e-12) continue;
    // Anything facing clearly upwards is a roof, however it leans (a launcher).
    const axis =
      at(n, 1) / length >= SLOPED_ROOF
        ? 1
        : [0, 1, 2].reduce((best, k) =>
            Math.abs(at(n, k)) > Math.abs(at(n, best)) ? k : best,
          );
    const minimum = axis === 1 ? SLOPED_ROOF : FLAT_FACE;
    if (Math.abs(at(n, axis)) / length < minimum) continue;
    const sign = Math.sign(at(n, axis));
    // Same plane: same quantised normal and same offset along it.
    const unitNormal = n.map((value) => value / length);
    const offset = unitNormal.reduce(
      (sum, value, k) => sum + value * at(a, k),
      0,
    );
    const plane =
      Math.round(offset / PLANE_STEP) * 1000 +
      Math.round((unitNormal[axis === 1 ? 2 : 1] ?? 0) * 10);
    const min = [0, 1, 2].map((k) => Math.min(at(a, k), at(b, k), at(c, k)));
    const max = [0, 1, 2].map((k) => Math.max(at(a, k), at(b, k), at(c, k)));
    const touching = surfaces.filter(
      (s) =>
        s.axis === axis &&
        s.sign === sign &&
        s.plane === plane &&
        [0, 1, 2].every(
          (k) =>
            k === axis ||
            (at(min, k) <= at(s.max, k) + TOUCH_GAP &&
              at(max, k) >= at(s.min, k) - TOUCH_GAP),
        ),
    );
    const target: Surface = touching[0] ?? {
      axis,
      sign,
      plane,
      lean: Math.abs(unitNormal[1] ?? 0),
      triangles: [],
      min,
      max,
      area: 0,
    };
    if (touching[0] === undefined) surfaces.push(target);
    target.triangles.push(t);
    target.area += length / 2;
    for (let k = 0; k < 3; k++) {
      target.min[k] = Math.min(at(target.min, k), at(min, k));
      target.max[k] = Math.max(at(target.max, k), at(max, k));
    }
    // A triangle that bridges two surfaces merges them.
    for (const other of touching.slice(1)) {
      target.triangles.push(...other.triangles);
      target.area += other.area;
      for (let k = 0; k < 3; k++) {
        target.min[k] = Math.min(at(target.min, k), at(other.min, k));
        target.max[k] = Math.max(at(target.max, k), at(other.max, k));
      }
      surfaces.splice(surfaces.indexOf(other), 1);
    }
  }
  return surfaces;
}

/** Where the decals go (spec 13 §3): `turret` is the turret geometry,
 *  `turretFlag` lets a `ua` turret carry its flag on the roof, `hasTurret` says
 *  the hull has a turret, `zOnTurret` puts the Russian Z on the turret roof. */
export interface LiveryOptions {
  turret?: boolean;
  turretFlag?: boolean;
  hasTurret?: boolean;
  zOnTurret?: boolean;
  splitRoof?: boolean;
  /** The Z goes on the sloped bow instead of a flat roof (BMP-2). */
  zOnBow?: boolean;
}

/** Adds the `livery` attribute (u, v, mask) to an opaque model geometry. */
export function addLiveryAttribute(
  geometry: BufferGeometry,
  livery: Livery,
  occluders: readonly Footprint[] = [],
  options: LiveryOptions = {},
): BufferGeometry {
  const source = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (!source.hasAttribute("normal")) source.computeVertexNormals();
  const position = source.getAttribute("position");
  const dark = source.hasAttribute(DARK_MASK)
    ? source.getAttribute(DARK_MASK)
    : null;
  const data = new Float32Array(position.count * 3);
  fillGlyph(livery, position, dark, data, occluders, options);
  source.setAttribute(LIVERY_ATTRIBUTE, new Float32BufferAttribute(data, 3));
  return source;
}

/** An axis-aligned rectangle in a surface's (u, v) plane. */
interface Rect {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

/** A box that rises from or crosses a roof and hides part of it. */
export interface Footprint extends Rect {
  readonly yMin: number;
  readonly yMax: number;
}

const ROOF_CLEARANCE = 0.06;

/** Footprints (x, z boxes) of the `dark` triangles of `position`. */
function darkFootprints(
  position: PositionAttribute,
  dark: PositionAttribute | null,
): Footprint[] {
  const footprints: Footprint[] = [];
  if (dark === null) return footprints;
  for (let t = 0; t < position.count / 3; t++) {
    if ((dark.getX(t * 3) ?? 0) <= 0) continue;
    const corners = [0, 1, 2].map((k) => triangleCorner(position, t * 3 + k));
    const xs = corners.map((corner) => at(corner, 0));
    const ys = corners.map((corner) => at(corner, 1));
    const zs = corners.map((corner) => at(corner, 2));
    footprints.push({
      uMin: Math.min(...xs),
      uMax: Math.max(...xs),
      vMin: Math.min(...zs),
      vMax: Math.max(...zs),
      yMin: Math.min(...ys),
      yMax: Math.max(...ys),
    });
  }
  return footprints;
}

/** The part of a roof that stays visible: the largest-square strip around the
 *  boxes standing on it (cab, turret); the whole roof when nothing stands on it. */
function freeRoof(
  roof: Rect,
  y: number,
  footprints: readonly Footprint[],
): Rect {
  const blocking = footprints.filter(
    (f) =>
      f.yMin <= y + ROOF_CLEARANCE &&
      f.yMax > y + ROOF_CLEARANCE &&
      f.uMin <= roof.uMax &&
      f.uMax >= roof.uMin &&
      f.vMin <= roof.vMax &&
      f.vMax >= roof.vMin,
  );
  if (blocking.length === 0) return roof;
  // The union of the boxes, clipped to the roof.
  const block: Rect = {
    uMin: Math.max(roof.uMin, Math.min(...blocking.map((f) => f.uMin))),
    uMax: Math.min(roof.uMax, Math.max(...blocking.map((f) => f.uMax))),
    vMin: Math.max(roof.vMin, Math.min(...blocking.map((f) => f.vMin))),
    vMax: Math.min(roof.vMax, Math.max(...blocking.map((f) => f.vMax))),
  };
  const strips: Rect[] = [
    { ...roof, uMax: block.uMin },
    { ...roof, uMin: block.uMax },
    { ...roof, vMax: block.vMin },
    { ...roof, vMin: block.vMax },
  ];
  const short = (r: Rect): number => Math.min(r.uMax - r.uMin, r.vMax - r.vMin);
  const largest = strips.reduce((best, strip) =>
    short(strip) > short(best) ? strip : best,
  );
  // The hood (in front of the block, +z) wins when it is nearly as big.
  const hood = strips[3] as Rect;
  return short(hood) >= 0.6 * short(largest) ? hood : largest;
}

/** `ru`: one square glyph on the largest free surface of each side and of the
 *  roof (hood before cab), `PATCH_SIZE` of its short extent, centred in its free
 *  part (a roof under a cab or turret keeps the strip around it). */
function fillGlyph(
  livery: Livery,
  position: PositionAttribute,
  dark: PositionAttribute | null,
  data: Float32Array,
  occluders: readonly Footprint[],
  options: LiveryOptions,
): void {
  const { turret = false, turretFlag = false } = options;
  const footprints = [...darkFootprints(position, dark), ...occluders];
  interface Placement {
    surface: Surface;
    rect: Rect;
    uAxis: number;
    vAxis: number;
  }
  const best = new Map<string, Placement>();
  const candidates = new Map<string, Placement[]>();
  const area = (r: Rect): number => (r.uMax - r.uMin) * (r.vMax - r.vMin);
  for (const surface of surfacesOf(position, dark)) {
    const face = faceOf(surface.axis, surface.sign);
    if (face === "end" || face === "bottom") continue;
    // Face axes: sides (u = z, v = y), top (u = x, v = z).
    const uAxis = surface.axis === 0 ? 2 : 0;
    const vAxis = surface.axis === 0 ? 1 : 2;
    const whole: Rect = {
      uMin: at(surface.min, uAxis),
      uMax: at(surface.max, uAxis),
      vMin: at(surface.min, vAxis),
      vMax: at(surface.max, vAxis),
    };
    const rect =
      face === "top" && !options.splitRoof
        ? freeRoof(whole, at(surface.min, 1), footprints)
        : whole;
    // A `ua` turret carries the flag only on its roof, and only when the type
    // asks for it (a launcher); other turrets leave the hood to the hull.
    if (turret && livery === LIVERIES.ua && (!turretFlag || face !== "top"))
      continue;
    // Slivers cannot carry a decal.
    if (
      Math.min(rect.uMax - rect.uMin, rect.vMax - rect.vMin) < MIN_DECAL_SURFACE
    )
      continue;
    const key = `${surface.axis}${surface.sign}`;
    const list = candidates.get(key) ?? [];
    list.push({ surface, rect, uAxis, vAxis });
    candidates.set(key, list);
  }
  for (const [key, list] of candidates) {
    const biggest = Math.max(...list.map((entry) => area(entry.rect)));
    // Roofs: the frontmost surface that is big enough (hood, cab); sides: the
    // biggest one.
    const roof = key === "11";
    // A turret roof is its biggest surface; a hull roof, the frontmost one.
    const frontmost = roof && !turret;
    let pool = roof
      ? list.filter((entry) => area(entry.rect) >= 0.25 * biggest)
      : list;
    // The Z goes on a flat roof when there is one: on a glacis it smears.
    const flat = (options.splitRoof ? list : pool).filter(
      (entry) => entry.surface.lean >= FLAT_ROOF,
    );
    if (roof && livery === LIVERIES.ru && !turret && flat.length > 0)
      pool = flat;
    const pick = pool.reduce((champion, entry) => {
      const better = frontmost
        ? entry.rect.vMax > champion.rect.vMax
        : area(entry.rect) > area(champion.rect);
      return better ? entry : champion;
    });
    best.set(key, pick);
  }
  interface Decaled extends Placement {
    decal: Decal;
    scale?: number;
  }
  const placements: Decaled[] = [];
  for (const [key, pick] of best) {
    const roof = key === "11";
    let decal: Decal = DECALS.mark;
    if (livery === LIVERIES.ru) {
      if (turret) {
        decal = roof && options.zOnTurret ? DECALS.mark : DECALS.flag;
        if (roof && options.splitRoof) continue;
      } else if (!roof) decal = DECALS.flag;
      else if (options.splitRoof) decal = DECALS.flag;
      else
        decal =
          options.hasTurret && !options.zOnTurret ? DECALS.mark : DECALS.flag;
    }
    placements.push({ ...pick, decal });
    // A hull without a turret (a truck, a dozer): the flag goes on the cab
    // roof and the Z on the biggest other roof.
    if (
      livery === LIVERIES.ru &&
      !turret &&
      roof &&
      (!options.hasTurret || options.splitRoof)
    ) {
      const others = (candidates.get(key) ?? []).filter(
        (entry) =>
          entry.surface !== pick.surface &&
          (!options.splitRoof ||
            options.zOnBow ||
            entry.surface.lean >= FLAT_ROOF),
      );
      const other = others.reduce<Placement | undefined>(
        (champion, entry) =>
          champion === undefined ||
          (options.zOnBow
            ? entry.rect.vMin < champion.rect.vMin
            : options.splitRoof
              ? entry.rect.vMax < champion.rect.vMax
              : area(entry.rect) > area(champion.rect))
            ? entry
            : champion,
        undefined,
      );
      if (other !== undefined)
        placements.push({
          ...other,
          decal: DECALS.mark,
          scale: options.zOnBow ? 0.5 : 1,
        });
    }
  }
  placements.forEach(({ surface, rect, uAxis, vAxis, decal, scale = 1 }) => {
    const extentU = Math.max(rect.uMax - rect.uMin, 1e-6);
    const extentV = Math.max(rect.vMax - rect.vMin, 1e-6);
    const fraction = PATCH_SIZE[livery][decal] * scale;
    const sizeV = fraction * Math.min(extentV, extentU);
    const sizeU = Math.min(fraction * extentU, PATCH_ASPECT * sizeV);
    for (const t of surface.triangles) {
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        const coords = triangleCorner(position, i);
        let u = (at(coords, uAxis) - rect.uMin) / extentU;
        const v = (at(coords, vAxis) - rect.vMin) / extentV;
        if (surface.axis === 0 && surface.sign < 0) u = 1 - u;
        data[i * 3] = 0.5 + ((u - 0.5) * extentU) / sizeU;
        data[i * 3 + 1] = 0.5 + ((v - 0.5) * extentV) / sizeV;
        data[i * 3 + 2] = MASKS[livery][decal];
      }
    }
  });
}

/** The roof area a turret hides at any heading: the square around its ring
 *  that holds the turret's reach, from the turret box and its pivot. */
export function turretFootprint(
  turret: Box3,
  pivot: { x: number; y: number; z: number },
): Footprint {
  // The turret box at rest, around its ring: the hood is the roof in front of
  // it (the decal may be partly covered when the turret turns).
  return {
    uMin: pivot.x + turret.min.x,
    uMax: pivot.x + turret.max.x,
    vMin: pivot.z + turret.min.z,
    vMax: pivot.z + turret.max.z,
    yMin: pivot.y + turret.min.y,
    yMax: pivot.y + turret.max.y,
  };
}
