import { describe, expect, it } from "vitest";
import {
  climateFor,
  coverAfter,
  coverThresholds,
  densityFrom,
  flakeSeeds,
} from "./weather";

const none = new URLSearchParams();
const snow = new URLSearchParams("weather=snow");

describe("weather (spec 22)", () => {
  it("AC-22-01: snow is off unless the URL asks for it", () => {
    expect(climateFor(none)).toBeNull();
    expect(climateFor(new URLSearchParams("weather=none"))).toBeNull();
    expect(climateFor(new URLSearchParams("weather=unknown"))).toBeNull();
    expect(climateFor(snow)).not.toBeNull();
  });

  it("AC-22-02: ground cover grows with time up to maxCover", () => {
    const climate = climateFor(snow);
    if (climate === null) throw new Error("no climate");
    expect(coverAfter(0, climate)).toBe(0);
    expect(coverAfter(climate.coverSeconds / 2, climate)).toBeCloseTo(
      climate.maxCover / 2,
    );
    expect(coverAfter(1e9, climate)).toBe(climate.maxCover);
  });

  it("AC-22-03: cover thresholds and flake seeds are deterministic; rocks never cover", () => {
    const rocks = new Uint8Array(16 * 16);
    rocks[5] = 1;
    const a = coverThresholds(16, 16, rocks, 3);
    expect(coverThresholds(16, 16, rocks, 3)).toEqual(a);
    expect(a[5]).toBe(255);
    expect(flakeSeeds(10, 1)).toEqual(flakeSeeds(10, 1));
  });

  it("AC-22-04: the density multiplier is clamped", () => {
    expect(densityFrom(none)).toBe(1);
    expect(densityFrom(new URLSearchParams("snow=0.5"))).toBe(0.5);
    expect(densityFrom(new URLSearchParams("snow=9"))).toBe(2);
    expect(densityFrom(new URLSearchParams("snow=abc"))).toBe(1);
  });
});
