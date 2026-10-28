import { describe, expect, it } from "vitest";
import { decodeFeatures } from "./featureSnapshot";

describe("decodeFeatures", () => {
  it("reads kind, state, flags and hit points per row", () => {
    const data = Int32Array.from([2, 0, 7, 1, 1, 640, 1, 9, 2, 6, 0]);
    expect(decodeFeatures(data)).toEqual([
      {
        index: 0,
        kind: 7,
        state: 1,
        alive: true,
        burning: false,
        collapsing: false,
        hpPermille: 640,
      },
      {
        index: 1,
        kind: 9,
        state: 2,
        alive: false,
        burning: true,
        collapsing: true,
        hpPermille: 0,
      },
    ]);
  });

  it("reports an empty array as unchanged", () => {
    expect(decodeFeatures(new Int32Array(0))).toBeNull();
  });
});
