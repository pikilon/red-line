import {
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

/** Faces that carry the livery; `ru` has no Z on the ends. */
const FACE_MASK: Readonly<Record<Livery, Readonly<Record<Face, number>>>> = {
  ua: { side: 1, top: 1, end: 1, bottom: 0 },
  ru: { side: 1, top: 1, end: 0, bottom: 0 },
};

/** Adds the `livery` attribute (u, v, mask) to an opaque model geometry. */
export function addLiveryAttribute(
  geometry: BufferGeometry,
  livery: Livery,
): BufferGeometry {
  if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const dark = geometry.hasAttribute(DARK_MASK)
    ? geometry.getAttribute(DARK_MASK)
    : null;
  const count = position.count;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    if ((dark?.getX(i) ?? 0) > 0) continue;
    for (const [axis, value] of [
      position.getX(i),
      position.getY(i),
      position.getZ(i),
    ].entries()) {
      min[axis] = Math.min(min[axis] ?? value, value);
      max[axis] = Math.max(max[axis] ?? value, value);
    }
  }
  if (min[0] === Infinity) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = 0;
      max[axis] = 1;
    }
  }
  const range = (axis: number): number =>
    Math.max((max[axis] ?? 1) - (min[axis] ?? 0), 1e-6);
  const unit = (axis: number, value: number): number =>
    (value - (min[axis] ?? 0)) / range(axis);

  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);

    let face: Face;
    // Face-local coordinates in 0..1 and their world extents.
    let u: number;
    let v: number;
    let extentU: number;
    let extentV: number;
    if (ax >= ay && ax >= az) {
      face = "side";
      u = unit(2, z);
      if (nx < 0) u = 1 - u;
      v = unit(1, y);
      extentU = range(2);
      extentV = range(1);
    } else if (ay >= az) {
      face = ny > 0 ? "top" : "bottom";
      u = unit(0, x);
      v = unit(2, z);
      extentU = range(0);
      extentV = range(2);
    } else {
      face = "end";
      u = unit(0, x);
      if (nz < 0) u = 1 - u;
      v = unit(1, y);
      extentU = range(0);
      extentV = range(1);
    }

    let outU = u;
    let outV = v;
    if (livery === LIVERIES.ru) {
      // Square glyph centred on the face, GLYPH_SIZE of its short extent.
      const size = GLYPH_SIZE * Math.min(extentU, extentV);
      outU = 0.5 + ((u - 0.5) * extentU) / size;
      outV = 0.5 + ((v - 0.5) * extentV) / size;
    }
    const masked = (dark?.getX(i) ?? 0) > 0 ? 0 : FACE_MASK[livery][face];
    data[i * 3] = outU;
    data[i * 3 + 1] = outV;
    data[i * 3 + 2] = masked;
  }
  geometry.setAttribute(LIVERY_ATTRIBUTE, new Float32BufferAttribute(data, 3));
  return geometry;
}
