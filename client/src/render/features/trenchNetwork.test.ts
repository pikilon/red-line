import { afterEach, describe, expect, it } from "vitest";
import {
  onTrenchFloor,
  onTrenchStrokes,
  publishTrenchStrokes,
  TRENCH_DEPTH,
  TRENCH_HOP,
  trenchHopY,
  trenchLines,
  trenchProfile,
  trenchStrokes,
} from "./trenchNetwork";

const piece = (x: number, y: number, rot = 0, state = 0) => ({
  x,
  y,
  width: rot === 0 ? 2 : 1,
  height: rot === 0 ? 1 : 2,
  state,
  variant: 0,
});

afterEach(() => onTrenchStrokes(null));

describe("spec 35: the trench network", () => {
  it("joins neighbouring pieces into one centreline", () => {
    // Two pieces in a row and an L turn: one run, not three.
    const lines = trenchLines([piece(0, 0), piece(2, 0), piece(4, 1, 1)]);
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? [];
    expect(line[0]).toMatchObject({ x: 0.5, z: 0.5 });
    expect(line[line.length - 1]).toMatchObject({ x: 4.5, z: 2.5 });
  });

  it("keeps apart pieces that do not touch", () => {
    expect(trenchLines([piece(0, 0), piece(5, 5)])).toHaveLength(2);
  });

  it("digs a floor, walls and a raised berm like a crater rim", () => {
    expect(trenchProfile(0)).toBeCloseTo(-1);
    expect(trenchProfile(1.3)).toBeGreaterThan(0);
    expect(trenchProfile(3)).toBe(0);
  });

  it("stands garrisoned soldiers in it and makes walkers jump it", () => {
    publishTrenchStrokes(
      trenchStrokes(trenchLines([piece(0, 0), piece(2, 0)])),
    );
    expect(onTrenchFloor(1.5, 0.5)).toBe(true);
    expect(onTrenchFloor(1.5, 3)).toBe(false);
    // Over the middle the walker is above the untouched ground, not in the hole.
    const carved = -TRENCH_DEPTH;
    expect(trenchHopY(1.5, 0.5, carved)).toBeCloseTo(TRENCH_HOP);
    expect(trenchHopY(1.5, 4, 0)).toBeNull();
  });
});
