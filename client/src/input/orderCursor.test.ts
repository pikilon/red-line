import { describe, expect, it } from "vitest";
import { cursorFor, orderHint } from "./orderCursor";

describe("orderHint", () => {
  it("shows garrison and repair for their orders", () => {
    expect(
      orderHint([
        [],
        [{ kind: "garrison", player: 0, units: [1], feature: 2 }],
      ]),
    ).toBe("garrison");
    expect(
      orderHint([
        [{ kind: "repairBuilding", player: 0, units: [1], building: 3 }],
      ]),
    ).toBe("repair");
  });
  it("shows nothing for other orders or none", () => {
    expect(orderHint([[], []])).toBeNull();
    expect(
      orderHint([[{ kind: "board", player: 0, units: [1], carrier: 4 }]]),
    ).toBeNull();
  });
  it("has a cursor per hint and none by default", () => {
    expect(cursorFor("garrison")).toContain("svg");
    expect(cursorFor("repair")).not.toBe(cursorFor("garrison"));
    expect(cursorFor(null)).toBe("");
    expect(cursorFor("attackMove")).toContain("crosshair");
    expect(cursorFor("guard")).not.toBe(cursorFor("attackMove"));
  });
});
