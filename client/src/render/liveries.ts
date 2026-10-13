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

/** Spec 13: flag colours on Ukrainian vehicles, white Z on Russian ones. */
export const LIVERIES = { ua: "ua", ru: "ru" } as const;
export type Livery = (typeof LIVERIES)[keyof typeof LIVERIES];

export const UA_BLUE = 0x0057b7;
export const UA_YELLOW = 0xffd700;
export const RU_WHITE = 0xffffff;

/** Per-vertex (u, v, mask) attribute name of a livery geometry. */
export const LIVERY_ATTRIBUTE = "livery";

const INFANTRY_ARMOR = 0;
const TEXTURE_SIZE = 128;
const GLYPH_SIZE = 0.8;
const BAR_MIN = 0.78;
const BAR_MAX = 0.92;
const BAR_LOW_MIN = 0.08;
const BAR_LOW_MAX = 0.22;
const GLYPH_LEFT = 0.1;
const GLYPH_RIGHT = 0.9;
const STROKE = 0.07;

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

function distanceToDiagonal(u: number, v: number): number {
  // Segment from the top-right to the bottom-left of the glyph.
  const ax = GLYPH_RIGHT;
  const ay = BAR_MIN + 0.07;
  const bx = GLYPH_LEFT;
  const by = BAR_LOW_MAX - 0.07;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(u - (ax + t * dx), v - (ay + t * dy));
}

function isZ(u: number, v: number): boolean {
  const inBars = u >= GLYPH_LEFT && u <= GLYPH_RIGHT;
  const top = inBars && v >= BAR_MIN && v <= BAR_MAX;
  const bottom = inBars && v >= BAR_LOW_MIN && v <= BAR_LOW_MAX;
  return top || bottom || distanceToDiagonal(u, v) <= STROKE;
}

/** The pattern at (u, v), both in 0..1, v up. */
export function liverySample(
  livery: Livery,
  u: number,
  v: number,
): { color: number; alpha: number } {
  if (livery === LIVERIES.ua) {
    return { color: v >= 0.5 ? UA_BLUE : UA_YELLOW, alpha: 1 };
  }
  const border = u <= 0 || u >= 1 || v <= 0 || v >= 1;
  return { color: RU_WHITE, alpha: !border && isZ(u, v) ? 1 : 0 };
}

/** 128 x 128 clamp-to-edge texture of `liverySample`. */
export function createLiveryTexture(livery: Livery): DataTexture {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const u = (x + 0.5) / TEXTURE_SIZE;
      const v = (y + 0.5) / TEXTURE_SIZE;
      const { color, alpha } = liverySample(livery, u, v);
      const offset = (y * TEXTURE_SIZE + x) * 4;
      data[offset] = (color >> 16) & 0xff;
      data[offset + 1] = (color >> 8) & 0xff;
      data[offset + 2] = color & 0xff;
      data[offset + 3] = alpha * 255;
    }
  }
  const texture = new DataTexture(
    data,
    TEXTURE_SIZE,
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

/** Faces that carry the `ua` livery; `ru` places its glyph per surface. */
const UA_FACE_MASK: Readonly<Record<Face, number>> = {
  side: 1,
  top: 1,
  end: 1,
  bottom: 0,
};

/** A triangle counts as a flat face when its normal is this close to an axis. */
const FLAT_FACE = 0.95;
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
    const axis = [0, 1, 2].reduce((best, k) =>
      Math.abs(at(n, k)) > Math.abs(at(n, best)) ? k : best,
    );
    if (Math.abs(at(n, axis)) / length < FLAT_FACE) continue;
    const sign = Math.sign(at(n, axis));
    const plane = Math.round(at(a, axis) / PLANE_STEP);
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

/** Adds the `livery` attribute (u, v, mask) to an opaque model geometry. */
export function addLiveryAttribute(
  geometry: BufferGeometry,
  livery: Livery,
  occluders: readonly Footprint[] = [],
): BufferGeometry {
  const source = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (!source.hasAttribute("normal")) source.computeVertexNormals();
  const position = source.getAttribute("position");
  const dark = source.hasAttribute(DARK_MASK)
    ? source.getAttribute(DARK_MASK)
    : null;
  const data = new Float32Array(position.count * 3);
  if (livery === LIVERIES.ua) {
    fillFlag(source, data);
  } else {
    fillGlyph(position, dark, data, occluders);
  }
  source.setAttribute(LIVERY_ATTRIBUTE, new Float32BufferAttribute(data, 3));
  return source;
}

/** `ua`: v is the position across the body box (height, or length on top). */
function fillFlag(geometry: BufferGeometry, data: Float32Array): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const dark = geometry.hasAttribute(DARK_MASK)
    ? geometry.getAttribute(DARK_MASK)
    : null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.count; i++) {
    if ((dark?.getX(i) ?? 0) > 0) continue;
    const values = [position.getX(i), position.getY(i), position.getZ(i)];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] ?? Infinity, values[k] ?? 0);
      max[k] = Math.max(max[k] ?? -Infinity, values[k] ?? 0);
    }
  }
  const unit = (axis: number, value: number): number =>
    (value - (min[axis] ?? 0)) /
    Math.max((max[axis] ?? 1) - (min[axis] ?? 0), 1e-6);
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(normal.getX(i));
    const ay = Math.abs(normal.getY(i));
    const az = Math.abs(normal.getZ(i));
    let face: Face;
    let v: number;
    if (ax >= ay && ax >= az) {
      face = "side";
      v = unit(1, position.getY(i));
    } else if (ay >= az) {
      face = normal.getY(i) > 0 ? "top" : "bottom";
      v = unit(2, position.getZ(i));
    } else {
      face = "end";
      v = unit(1, position.getY(i));
    }
    const dim = (dark?.getX(i) ?? 0) > 0;
    data[i * 3] = 0.5;
    data[i * 3 + 1] = v;
    data[i * 3 + 2] = dim ? 0 : UA_FACE_MASK[face];
  }
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
  return strips.reduce((best, strip) =>
    short(strip) > short(best) ? strip : best,
  );
}

/** `ru`: one square glyph on the largest free surface of each side and of the
 *  roof (hood before cab), `GLYPH_SIZE` of its short extent, centred in its free
 *  part (a roof under a cab or turret keeps the strip around it). */
function fillGlyph(
  position: PositionAttribute,
  dark: PositionAttribute | null,
  data: Float32Array,
  occluders: readonly Footprint[],
): void {
  const footprints = [...darkFootprints(position, dark), ...occluders];
  interface Placement {
    surface: Surface;
    rect: Rect;
    uAxis: number;
    vAxis: number;
  }
  const best = new Map<string, Placement>();
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
      face === "top" ? freeRoof(whole, at(surface.min, 1), footprints) : whole;
    const key = `${surface.axis}${surface.sign}`;
    const current = best.get(key);
    if (current === undefined || area(rect) > area(current.rect)) {
      best.set(key, { surface, rect, uAxis, vAxis });
    }
  }
  for (const { surface, rect, uAxis, vAxis } of best.values()) {
    const extentU = Math.max(rect.uMax - rect.uMin, 1e-6);
    const extentV = Math.max(rect.vMax - rect.vMin, 1e-6);
    const size = GLYPH_SIZE * Math.min(extentU, extentV);
    for (const t of surface.triangles) {
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        const coords = triangleCorner(position, i);
        let u = (at(coords, uAxis) - rect.uMin) / extentU;
        const v = (at(coords, vAxis) - rect.vMin) / extentV;
        if (surface.axis === 0 && surface.sign < 0) u = 1 - u;
        data[i * 3] = 0.5 + ((u - 0.5) * extentU) / size;
        data[i * 3 + 1] = 0.5 + ((v - 0.5) * extentV) / size;
        data[i * 3 + 2] = 1;
      }
    }
  }
}

/** The roof area a turret hides at any heading: the square around its ring
 *  that holds the turret's reach, from the turret box and its pivot. */
export function turretFootprint(
  turret: Box3,
  pivot: { x: number; y: number; z: number },
): Footprint {
  const reach = Math.max(
    Math.hypot(turret.min.x, turret.min.z),
    Math.hypot(turret.max.x, turret.max.z),
    Math.hypot(turret.min.x, turret.max.z),
    Math.hypot(turret.max.x, turret.min.z),
  );
  return {
    uMin: pivot.x - reach,
    uMax: pivot.x + reach,
    vMin: pivot.z - reach,
    vMax: pivot.z + reach,
    yMin: pivot.y + turret.min.y,
    yMax: pivot.y + turret.max.y,
  };
}
