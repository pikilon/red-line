import { describe, expect, it } from "vitest";
import { decodeSnapshot, interpolateUnits, type Snapshot } from "./snapshot";

describe("snapshot", () => {
  it("AC-02-26: decodes a snapshot buffer", () => {
    const data = new Int32Array([7, 2, 0, 98304, 65536, 1, 5, 0, 32768, 0]);
    expect(decodeSnapshot(data)).toEqual({
      tick: 7,
      units: [
        { id: 0, x: 1.5, y: 1, moving: true },
        { id: 5, x: 0, y: 0.5, moving: false },
      ],
    });
  });

  it("AC-02-27: interpolates unit positions", () => {
    const prev: Snapshot = {
      tick: 1,
      units: [{ id: 0, x: 0, y: 0, moving: false }],
    };
    const next: Snapshot = {
      tick: 2,
      units: [
        { id: 0, x: 2, y: 4, moving: true },
        { id: 9, x: 3, y: 3, moving: false },
      ],
    };
    expect(interpolateUnits(prev, next, 0.5)[0]).toEqual({
      id: 0,
      x: 1,
      y: 2,
      moving: true,
    });
    expect(interpolateUnits(prev, next, -1)[0]).toMatchObject({ x: 0, y: 0 });
    expect(interpolateUnits(prev, next, 3)[0]).toMatchObject({ x: 2, y: 4 });
    expect(interpolateUnits(prev, next, 0.5)[1]).toEqual({
      id: 9,
      x: 3,
      y: 3,
      moving: false,
    });
  });
});
