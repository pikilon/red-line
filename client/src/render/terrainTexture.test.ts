import { RepeatWrapping, SRGBColorSpace } from "three";
import { describe, expect, it } from "vitest";
import {
  createRng,
  createTerrainTextures,
  TERRAIN_KINDS,
  TEXTURE_SIZE,
  type TerrainKind,
  terrainPixels,
  valueNoise,
} from "./terrainTexture";

const BASE_COLOR: Record<TerrainKind, readonly [number, number, number]> = {
  grass: [0x3f, 0x6b, 0x2a],
  dirt: [0x7a, 0x5f, 0x3e],
  rock: [0x7d, 0x75, 0x6b],
};

/** One channel of pixel `(x, y)`; 0 when out of the buffer. */
function channel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  component: number,
): number {
  return pixels[(y * TEXTURE_SIZE + x) * 4 + component] ?? 0;
}

/** Mean of one RGB channel over the whole texture. */
function meanChannel(pixels: Uint8ClampedArray, component: number): number {
  let sum = 0;
  for (let pixel = 0; pixel < TEXTURE_SIZE * TEXTURE_SIZE; pixel++) {
    sum += pixels[pixel * 4 + component] ?? 0;
  }
  return sum / (TEXTURE_SIZE * TEXTURE_SIZE);
}

describe("terrain textures", () => {
  it("AC-10-01: procedural textures", () => {
    // `createRng(7)` yields the same sequence twice.
    const first = createRng(7);
    const second = createRng(7);
    for (let i = 0; i < 16; i++) {
      expect(first()).toBe(second());
    }

    // `valueNoise` stays in [0, 1] and is periodic.
    for (const period of [64, 16, 32, 12, 3]) {
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          const value = valueNoise(x * 1.7, y * 2.3, period, 11);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
      for (let i = 0; i < 8; i++) {
        const x = i * 3.25;
        const y = i * 5.5 + 0.5;
        const value = valueNoise(x, y, period, 11);
        expect(valueNoise(x + period, y, period, 11)).toBeCloseTo(value, 10);
        expect(valueNoise(x, y + period, period, 11)).toBeCloseTo(value, 10);
      }
    }

    for (const kind of TERRAIN_KINDS) {
      const pixels = terrainPixels(kind, 1);
      expect(pixels.length).toBe(TEXTURE_SIZE * TEXTURE_SIZE * 4);
      // Identical for the same seed, different for another seed.
      expect(terrainPixels(kind, 1)).toEqual(pixels);
      expect(terrainPixels(kind, 2)).not.toEqual(pixels);

      // Seamless: column 0 matches column 255 within 12 per channel.
      for (let y = 0; y < TEXTURE_SIZE; y++) {
        for (let c = 0; c < 4; c++) {
          const delta = Math.abs(
            channel(pixels, 0, y, c) - channel(pixels, TEXTURE_SIZE - 1, y, c),
          );
          expect(delta).toBeLessThanOrEqual(12);
        }
      }
      // Seamless: row 0 matches row 255 within 12 per channel.
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        for (let c = 0; c < 4; c++) {
          const delta = Math.abs(
            channel(pixels, x, 0, c) - channel(pixels, x, TEXTURE_SIZE - 1, c),
          );
          expect(delta).toBeLessThanOrEqual(12);
        }
      }

      // Mean colour within 24 per channel of the kind's base colour.
      const base = BASE_COLOR[kind];
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(meanChannel(pixels, c) - (base[c] ?? 0));
        expect(delta).toBeLessThanOrEqual(24);
      }
    }

    // One tileable sRGB texture per kind.
    const textures = createTerrainTextures(1);
    for (const kind of TERRAIN_KINDS) {
      const texture = textures[kind];
      const image = texture.image as { width: number; height: number };
      expect(texture.wrapS).toBe(RepeatWrapping);
      expect(texture.wrapT).toBe(RepeatWrapping);
      expect(texture.colorSpace).toBe(SRGBColorSpace);
      expect(image.width).toBe(TEXTURE_SIZE);
      expect(image.height).toBe(TEXTURE_SIZE);
    }
  });
});
