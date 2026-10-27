import { describe, expect, it } from "vitest";
import { GROUND_MATERIALS, groundMaterialPixels } from "./materialTextures";
import { bakeRoads, ROAD_ASPHALT, roadResolution } from "./roadBake";
import { bakeSplat, SPLAT_RES } from "./splat";

describe("ground materials and roads (spec 26 phase 3)", () => {
  it("generates an opaque texture for every material", () => {
    for (const material of GROUND_MATERIALS) {
      const pixels = groundMaterialPixels(material, 1);
      expect(pixels.length).toBe(256 * 256 * 4);
      expect(pixels[3]).toBe(255);
    }
  });

  it("blends two materials softly across their border", () => {
    const ground = new Uint8Array(8 * 4);
    for (let y = 0; y < 4; y++)
      for (let x = 4; x < 8; x++) ground[y * 8 + x] = 2;
    const splat = bakeSplat(ground, 8, 4, 1);
    const at = (x: number, y: number): number =>
      splat.a[(y * splat.width + x) * 4] ?? 0;
    expect(at(1 * SPLAT_RES, 2 * SPLAT_RES)).toBe(255); // deep in grass
    expect(at(6 * SPLAT_RES, 2 * SPLAT_RES)).toBe(0); // deep in sand
    let blended = 0;
    for (let x = 2 * SPLAT_RES; x < 6 * SPLAT_RES; x++) {
      const w = at(x, 2 * SPLAT_RES);
      if (w > 0 && w < 255) blended++;
    }
    expect(blended).toBeGreaterThan(2);
  });

  it("paints a road strip with lane dashes and leaves the rest clear", () => {
    const cols = 16;
    const rows = 12;
    const roads = new Uint8Array(cols * rows);
    for (let y = 5; y < 8; y++)
      for (let x = 0; x < cols; x++) roads[y * cols + x] = ROAD_ASPHALT;
    const image = bakeRoads(roads, cols, rows);
    expect(image).not.toBeNull();
    const res = roadResolution(cols, rows);
    const alpha = (x: number, y: number): number =>
      image?.pixels[(y * (image?.width ?? 0) + x) * 4 + 3] ?? 0;
    expect(alpha(4 * res, 6 * res + res / 2)).toBe(255);
    expect(alpha(4 * res, 1 * res)).toBe(0);
    let bright = 0;
    for (let x = 0; x < cols * res; x++) {
      const o = ((6 * res + res / 2) * (image?.width ?? 0) + x) * 4;
      if ((image?.pixels[o] ?? 0) > 170) bright++;
    }
    expect(bright).toBeGreaterThan(res);
  });

  it("bakes nothing for a map without roads", () => {
    expect(bakeRoads(new Uint8Array(16), 4, 4)).toBeNull();
  });
});
