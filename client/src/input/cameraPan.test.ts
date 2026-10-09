import { describe, expect, it } from "vitest";
import { panDelta } from "./cameraPan";

describe("camera pan", () => {
  it("AC-02-34: pans the camera with keys", () => {
    const right = panDelta(new Set(["ArrowRight"]), 0.5);
    expect(right.x).toBeCloseTo(10 / Math.SQRT2, 9);
    expect(right.y).toBeCloseTo(-10 / Math.SQRT2, 9);
    expect(panDelta(new Set(["ArrowUp", "ArrowDown"]), 1)).toEqual({
      x: 0,
      y: 0,
    });
    expect(panDelta(new Set(["KeyQ"]), 1)).toEqual({ x: 0, y: 0 });
  });
});
