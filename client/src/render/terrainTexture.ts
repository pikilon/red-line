import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
} from "three";

export const TEXTURE_SIZE = 256;
export const TERRAIN_KINDS = ["grass", "dirt", "rock"] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

/** Noise lattice cells per period; the value noise wraps every `period`. */
const NOISE_CELLS = 4;
/** Periods of the two octaves of every terrain texture, in pixels. */
const COARSE_PERIOD = 64;
const FINE_PERIOD = 16;
const GRASS_SPECKLE_CHANCE = 0.03;
const GRASS_SPECKLE_DARKEN = 0.82;
const ROCK_CRACK_PERIOD = 32;
const ROCK_CRACK_WIDTH = 0.02;
/** Darker lines where the rock noise crosses its middle. */
const ROCK_CRACK_COLOR = 0x3a352f;

interface Palette {
  readonly base: number;
  readonly dark: number;
  readonly light: number;
}

const PALETTES: Record<TerrainKind, Palette> = {
  grass: { base: 0x3f6b2a, dark: 0x2c5220, light: 0x5c8a3a },
  dirt: { base: 0x7a5f3e, dark: 0x5e4630, light: 0x96784f },
  rock: { base: 0x7d756b, dark: 0x5a534b, light: 0xa39a8e },
};

function channel(hex: number, shift: number): number {
  return (hex >> shift) & 0xff;
}

function blend(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Smooth Hermite interpolation between 0 and 1. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Deterministic 32-bit PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function latticeValue(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d);
  h ^= Math.imul(iy, 0x165667b1);
  h ^= Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1], period `period` units, seeded. */
export function valueNoise(
  x: number,
  y: number,
  period: number,
  seed: number,
): number {
  const step = period / NOISE_CELLS;
  const scaledX = x / step;
  const scaledY = y / step;
  const cellX = Math.floor(scaledX);
  const cellY = Math.floor(scaledY);
  const fx = smoothstep(scaledX - cellX);
  const fy = smoothstep(scaledY - cellY);
  const x0 = positiveModulo(cellX, NOISE_CELLS);
  const y0 = positiveModulo(cellY, NOISE_CELLS);
  const x1 = (x0 + 1) % NOISE_CELLS;
  const y1 = (y0 + 1) % NOISE_CELLS;
  const a = latticeValue(x0, y0, seed);
  const b = latticeValue(x1, y0, seed);
  const c = latticeValue(x0, y1, seed);
  const d = latticeValue(x1, y1, seed);
  const top = blend(a, b, fx);
  const bottom = blend(c, d, fx);
  return blend(top, bottom, fy);
}

/** RGBA pixels (TEXTURE_SIZE² × 4) of `kind`, seamless (left/right and
 *  top/bottom edges match). */
export function terrainPixels(
  kind: TerrainKind,
  seed: number,
): Uint8ClampedArray {
  const palette = PALETTES[kind];
  const baseR = channel(palette.base, 16);
  const baseG = channel(palette.base, 8);
  const baseB = channel(palette.base, 0);
  const darkR = channel(palette.dark, 16);
  const darkG = channel(palette.dark, 8);
  const darkB = channel(palette.dark, 0);
  const lightR = channel(palette.light, 16);
  const lightG = channel(palette.light, 8);
  const lightB = channel(palette.light, 0);
  const crackR = channel(ROCK_CRACK_COLOR, 16);
  const crackG = channel(ROCK_CRACK_COLOR, 8);
  const crackB = channel(ROCK_CRACK_COLOR, 0);
  const speckles = createRng(seed);
  const pixels = new Uint8ClampedArray(TEXTURE_SIZE * TEXTURE_SIZE * 4);

  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const coarse = valueNoise(x, y, COARSE_PERIOD, seed);
      const fine = valueNoise(x, y, FINE_PERIOD, seed);
      let red = blend(blend(baseR, darkR, coarse), lightR, fine);
      let green = blend(blend(baseG, darkG, coarse), lightG, fine);
      let blue = blend(blend(baseB, darkB, coarse), lightB, fine);

      if (kind === "grass" && speckles() < GRASS_SPECKLE_CHANCE) {
        red *= GRASS_SPECKLE_DARKEN;
        green *= GRASS_SPECKLE_DARKEN;
        blue *= GRASS_SPECKLE_DARKEN;
      }
      if (
        kind === "rock" &&
        Math.abs(valueNoise(x, y, ROCK_CRACK_PERIOD, seed) - 0.5) <
          ROCK_CRACK_WIDTH
      ) {
        red = crackR;
        green = crackG;
        blue = crackB;
      }

      const offset = (y * TEXTURE_SIZE + x) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
  }

  // Make the wrap exact: the last column/row repeats the first one.
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    const source = y * TEXTURE_SIZE * 4;
    const target = (y * TEXTURE_SIZE + TEXTURE_SIZE - 1) * 4;
    for (let c = 0; c < 4; c++) {
      pixels[target + c] = pixels[source + c] ?? 0;
    }
  }
  for (let x = 0; x < TEXTURE_SIZE; x++) {
    const source = x * 4;
    const target = ((TEXTURE_SIZE - 1) * TEXTURE_SIZE + x) * 4;
    for (let c = 0; c < 4; c++) {
      pixels[target + c] = pixels[source + c] ?? 0;
    }
  }
  return pixels;
}

/** One `DataTexture` per kind (sRGB, RepeatWrapping, mipmaps, linear filter). */
export function createTerrainTextures(
  seed: number,
): Record<TerrainKind, Texture> {
  const textures = {} as Record<TerrainKind, Texture>;
  for (const kind of TERRAIN_KINDS) {
    const texture = new DataTexture(
      terrainPixels(kind, seed),
      TEXTURE_SIZE,
      TEXTURE_SIZE,
      RGBAFormat,
      UnsignedByteType,
    );
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    textures[kind] = texture;
  }
  return textures;
}
