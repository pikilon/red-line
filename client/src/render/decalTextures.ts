import {
  DataTexture,
  LinearFilter,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
} from "three";
import { createRng, valueNoise } from "./terrainTexture";

/** Pixels per atlas cell side; the atlas holds `ATLAS_CELLS` cells in a row. */
export const CELL_SIZE = 64;
export const ATLAS_CELLS = 3;
export const DECAL_CELLS = { tread: 0, scorch: 1, crater: 2 } as const;
export type DecalCell = keyof typeof DECAL_CELLS;

/** Tread: two soft edges with cross ridges every few pixels (long axis = v). */
function treadAlpha(u: number, v: number): number {
  const edge = Math.min(u, 1 - u) * 2;
  const soft = Math.min(1, edge * 3);
  const ridge = 0.65 + 0.35 * Math.sign(Math.sin(v * Math.PI * 2 * 4));
  return soft * ridge;
}

/** Scorch: a ragged dark disc that fades towards the rim. */
function scorchAlpha(u: number, v: number, seed: number): number {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const radius = Math.hypot(dx, dy) * 2;
  const ragged = 0.75 + 0.35 * valueNoise(u * 24, v * 24, 8, seed);
  return Math.max(0, Math.min(1, (1 - radius / ragged) * 1.6));
}

/** Crater: dark bowl in the middle with a lighter, lumpy rim. */
function craterAlpha(u: number, v: number, seed: number): number {
  const radius = Math.hypot(u - 0.5, v - 0.5) * 2;
  const lump = 0.9 + 0.1 * valueNoise(u * 20, v * 20, 10, seed);
  const r = radius / lump;
  if (r >= 1) return 0;
  const bowl = 1 - r * 0.5;
  const rim = r > 0.72 ? (1 - r) / 0.28 : 1;
  return Math.max(0, Math.min(1, bowl * rim));
}

/** Greyscale value (0..255) of a cell pixel; tinting happens per vertex. */
function cellShade(cell: DecalCell, u: number, v: number): number {
  if (cell === "crater")
    return u + v > 1.1 && Math.hypot(u - 0.5, v - 0.5) > 0.3 ? 255 : 150;
  return 255;
}

/** The decal atlas as a procedural `DataTexture`: tread, scorch, crater. */
export function createDecalAtlas(seed = 1): Texture {
  const width = CELL_SIZE * ATLAS_CELLS;
  const data = new Uint8Array(width * CELL_SIZE * 4);
  const rng = createRng(seed + 77);
  for (let py = 0; py < CELL_SIZE; py++) {
    for (let px = 0; px < width; px++) {
      const cellIndex = Math.floor(px / CELL_SIZE);
      const u = ((px % CELL_SIZE) + 0.5) / CELL_SIZE;
      const v = (py + 0.5) / CELL_SIZE;
      let alpha = 0;
      let cell: DecalCell = "tread";
      if (cellIndex === DECAL_CELLS.tread) {
        alpha = treadAlpha(u, v);
      } else if (cellIndex === DECAL_CELLS.scorch) {
        cell = "scorch";
        alpha = scorchAlpha(u, v, seed);
      } else {
        cell = "crater";
        alpha = craterAlpha(u, v, seed + 3);
      }
      alpha *= 0.9 + 0.1 * rng();
      const shade = cellShade(cell, u, v);
      const offset = (py * width + px) * 4;
      data[offset] = shade;
      data[offset + 1] = shade;
      data[offset + 2] = shade;
      data[offset + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    }
  }
  const texture = new DataTexture(
    data,
    width,
    CELL_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
