import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from "three";
import { fbm, smoothstep } from "./noise";

/** Weight-map pixels per cell. Linear filtering smooths the rest. */
export const SPLAT_RES = 8;
/** Materials the weight textures can hold (two RGBA textures hold eight and
 *  the ninth is whatever is left). */
export const SPLAT_MATERIALS = 9;

/** How far (in cells) the noise bends the border between two materials. */
const WOBBLE = 0.8;

export interface SplatWeights {
  readonly width: number;
  readonly height: number;
  /** Channels 0-3 of the materials, RGBA8, row-major. */
  readonly a: Uint8Array;
  /** Materials 4-7. */
  readonly b: Uint8Array;
}

/** Per-pixel material weights of `ground` (one byte per cell, row-major):
 *  the nearest four cells blended bilinearly after the sampling point is bent
 *  by noise, so borders are soft but irregular instead of cell-shaped. */
export function bakeSplat(
  ground: Uint8Array,
  cols: number,
  rows: number,
  seed = 1,
  res = SPLAT_RES,
): SplatWeights {
  const width = cols * res;
  const height = rows * res;
  const a = new Uint8Array(width * height * 4);
  const b = new Uint8Array(width * height * 4);
  const cell = (x: number, y: number): number =>
    ground[
      Math.min(rows - 1, Math.max(0, y)) * cols +
        Math.min(cols - 1, Math.max(0, x))
    ] ?? 0;
  const weights = new Float32Array(SPLAT_MATERIALS);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const wx = (px + 0.5) / res;
      const wy = (py + 0.5) / res;
      // Bend the sampling point, then find the four cell centres around it.
      const sx = wx + (fbm(wx * 0.7, wy * 0.7, seed) - 0.5) * 2 * WOBBLE - 0.5;
      const sy =
        wy +
        (fbm(wx * 0.7 + 31, wy * 0.7 + 17, seed + 9) - 0.5) * 2 * WOBBLE -
        0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = smoothstep(0.15, 0.85, sx - x0);
      const fy = smoothstep(0.15, 0.85, sy - y0);
      weights.fill(0);
      const add = (cx: number, cy: number, w: number): void => {
        const m = Math.min(SPLAT_MATERIALS - 1, cell(cx, cy));
        weights[m] = (weights[m] ?? 0) + w;
      };
      add(x0, y0, (1 - fx) * (1 - fy));
      add(x0 + 1, y0, fx * (1 - fy));
      add(x0, y0 + 1, (1 - fx) * fy);
      add(x0 + 1, y0 + 1, fx * fy);
      const o = (py * width + px) * 4;
      for (let m = 0; m < 4; m++) {
        a[o + m] = Math.round((weights[m] ?? 0) * 255);
        b[o + m] = Math.round((weights[m + 4] ?? 0) * 255);
      }
    }
  }
  return { width, height, a, b };
}

/** A weight map as a texture (linear, clamped, no mipmaps). */
export function splatTexture(
  data: Uint8Array,
  width: number,
  height: number,
): DataTexture {
  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
