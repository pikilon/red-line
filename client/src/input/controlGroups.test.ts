import { describe, expect, it } from "vitest";
import type { EntityState } from "../sim/matchSnapshot";
import {
  centreOf,
  createControlGroups,
  digitOfKey,
  dominantKind,
  nextInCycle,
} from "./controlGroups";

function entity(id: number, kind: number, x = 0, y = 0): EntityState {
  return {
    id,
    owner: 0,
    kind,
    x,
    y,
    hp: 1,
    flags: 0,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
  };
}

describe("control groups", () => {
  it("stores, adds and clears a group", () => {
    const groups = createControlGroups();
    groups.set(1, [5, 3]);
    expect(groups.get(1)).toEqual([3, 5]);
    groups.add(1, [9]);
    expect(groups.get(1)).toEqual([3, 5, 9]);
    groups.set(1, []);
    expect(groups.get(1)).toEqual([]);
  });

  it("drops dead units", () => {
    const groups = createControlGroups();
    groups.set(2, [1, 2, 3]);
    expect(groups.prune(new Set([1, 3]))).toBe(true);
    expect(groups.get(2)).toEqual([1, 3]);
    expect(groups.prune(new Set([1, 3]))).toBe(false);
  });

  it("centres on the second press within 400 ms only", () => {
    const groups = createControlGroups();
    expect(groups.press(1, 1000)).toBe("select");
    expect(groups.press(1, 1399)).toBe("centre");
    expect(groups.press(1, 1500)).toBe("select");
    expect(groups.press(1, 1901)).toBe("select");
    expect(groups.press(2, 1950)).toBe("select");
    expect(groups.press(1, 1960)).toBe("select");
  });

  it("reads digit keys", () => {
    expect(digitOfKey("Digit7")).toBe(7);
    expect(digitOfKey("Numpad0")).toBe(0);
    expect(digitOfKey("KeyA")).toBeNull();
  });

  it("finds the dominant kind and the centre", () => {
    const rows = [entity(1, 4, 0, 0), entity(2, 4, 4, 2), entity(3, 7, 9, 9)];
    expect(dominantKind([1, 2, 3], rows)).toBe(4);
    expect(dominantKind([], rows)).toBeNull();
    expect(centreOf([1, 2], rows)).toEqual({ x: 2, y: 1 });
    expect(centreOf([99], rows)).toBeNull();
  });

  it("cycles through structures", () => {
    expect(nextInCycle([], null)).toBeNull();
    expect(nextInCycle([8, 3], null)).toBe(3);
    expect(nextInCycle([8, 3], 3)).toBe(8);
    expect(nextInCycle([8, 3], 8)).toBe(3);
  });
});
