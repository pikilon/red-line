import { describe, expect, it } from "vitest";
import type { UnitState } from "../sim/snapshot";
import { isDrag, pickUnit, rectFromDrag, unitsInRect } from "./selection";

const unit = (id: number, x: number, y: number): UnitState => ({
  id,
  x,
  y,
  moving: false,
});

describe("selection", () => {
  it("AC-02-32: picks the nearest unit under the cursor", () => {
    const units = [unit(0, 1, 1), unit(1, 1.3, 1), unit(2, 5, 5)];
    expect(pickUnit(units, 1.2, 1)).toBe(1);
    expect(pickUnit(units, 1.15, 1)).toBe(0);
    expect(pickUnit(units, 3, 3)).toBeNull();
  });

  it("AC-02-33: selects units inside a dragged rectangle", () => {
    const rect = rectFromDrag({ x: 10, y: 50 }, { x: 2, y: 5 });
    expect(rect).toEqual({ minX: 2, minY: 5, maxX: 10, maxY: 50 });
    const units = [unit(0, 2, 5), unit(1, 10, 50), unit(2, 11, 20)];
    expect(unitsInRect(units, rect, (x, y) => ({ x, y }))).toEqual([0, 1]);
    expect(isDrag({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
  });
});
