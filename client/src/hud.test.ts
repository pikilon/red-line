import { describe, expect, it } from "vitest";
import { selectionLabel } from "./hud";

describe("hud", () => {
  it("AC-14-03: selection label", () => {
    expect(selectionLabel([])).toBe("");
    expect(selectionLabel(["M2 Bradley"])).toBe("M2 Bradley");
    expect(selectionLabel(["M2 Bradley", "HIMARS", "M2 Bradley"])).toBe(
      "M2 Bradley x 2, HIMARS",
    );
  });
});
