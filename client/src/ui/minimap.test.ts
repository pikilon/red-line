import { describe, expect, it } from "vitest";
import {
  dotVisible,
  fitMap,
  fogPixels,
  minimapToWorld,
  terrainPixels,
  worldToMinimap,
} from "./minimap";

describe("minimap geometry (spec 42 §3.7)", () => {
  it("fits a square map into a square canvas", () => {
    expect(fitMap(100, 100, 50, 50)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it("letterboxes a wide map and centres it", () => {
    expect(fitMap(100, 100, 100, 50)).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
  });

  it("pillarboxes a tall map and centres it", () => {
    expect(fitMap(100, 100, 25, 50)).toEqual({
      x: 25,
      y: 0,
      width: 50,
      height: 100,
    });
  });

  it("maps canvas pixels to tiles on a square map", () => {
    expect(minimapToWorld(50, 50, 100, 100, 40, 40)).toEqual({ x: 20, y: 20 });
  });

  it("maps canvas pixels to tiles on a non-square map", () => {
    // 100 x 50 tiles in a 100 x 100 canvas: rows start at y = 25.
    expect(minimapToWorld(50, 50, 100, 100, 100, 50)).toEqual({ x: 50, y: 25 });
    expect(minimapToWorld(0, 25, 100, 100, 100, 50)).toEqual({ x: 0, y: 0 });
  });

  it("clamps the letterbox to the nearest map edge", () => {
    expect(minimapToWorld(50, 0, 100, 100, 100, 50)).toEqual({ x: 50, y: 0 });
    expect(minimapToWorld(500, 500, 100, 100, 100, 50)).toEqual({
      x: 100,
      y: 50,
    });
    expect(minimapToWorld(-9, -9, 100, 100, 25, 50)).toEqual({ x: 0, y: 0 });
  });

  it("round-trips tiles through the canvas on a non-square map", () => {
    for (const [mw, mh] of [
      [100, 50],
      [25, 50],
      [64, 64],
    ] as const) {
      const pixel = worldToMinimap(7.5, 12.25, 150, 90, mw, mh);
      const back = minimapToWorld(pixel.x, pixel.y, 150, 90, mw, mh);
      expect(back.x).toBeCloseTo(7.5, 6);
      expect(back.y).toBeCloseTo(12.25, 6);
    }
  });

  it("answers the origin for a degenerate map", () => {
    expect(minimapToWorld(5, 5, 100, 100, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(worldToMinimap(5, 5, 100, 100, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("minimap layers", () => {
  it("colours water and rock apart from land", () => {
    const pixels = terrainPixels({
      width: 3,
      height: 1,
      rock: Uint8Array.of(0, 1, 0),
      water: Uint8Array.of(0, 0, 2),
      relief: null,
    });
    const rgb = (cell: number) =>
      [...pixels.slice(cell * 4, cell * 4 + 3)].join();
    expect(new Set([rgb(0), rgb(1), rgb(2)]).size).toBe(3);
    expect(pixels[3]).toBe(255);
  });

  it("shades higher land lighter", () => {
    const pixels = terrainPixels({
      width: 2,
      height: 1,
      rock: new Uint8Array(2),
      water: new Uint8Array(2),
      relief: Float32Array.of(0, 4),
    });
    expect(pixels[1] ?? 0).toBeLessThan(pixels[5] ?? 0);
  });

  it("writes fog alpha: black unexplored, half explored, clear visible", () => {
    const out = new Uint8ClampedArray(12);
    fogPixels(Uint8Array.of(0, 1, 2), out);
    expect([out[3], out[7], out[11]]).toEqual([255, 140, 0]);
  });

  it("shows own dots anywhere and others only on visible cells", () => {
    const fog = Uint8Array.of(0, 2, 1, 2);
    const other = { x: 1.5, y: 0.5, owner: 1 };
    expect(dotVisible({ x: 0.5, y: 0.5, owner: 0 }, 0, fog, 2)).toBe(true);
    expect(dotVisible(other, 0, fog, 2)).toBe(true);
    expect(dotVisible({ x: 0.5, y: 0.5, owner: 1 }, 0, fog, 2)).toBe(false);
    expect(dotVisible({ x: 0.5, y: 1.5, owner: 1 }, 0, fog, 2)).toBe(false);
  });
});
