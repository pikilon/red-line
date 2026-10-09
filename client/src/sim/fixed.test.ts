import { describe, expect, it } from "vitest";
import { fromRaw, toRaw } from "./fixed";

describe("fixed conversion", () => {
  it("AC-02-25: converts tiles to raw fixed point and back", () => {
    expect(toRaw(1)).toBe(65536);
    expect(toRaw(100.5)).toBe(6586368);
    expect(toRaw(-0.5)).toBe(-32768);
    expect(fromRaw(98304)).toBe(1.5);
  });
});
