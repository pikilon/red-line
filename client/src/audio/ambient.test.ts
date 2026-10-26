import { describe, expect, it } from "vitest";

import { ambientEventFor } from "./ambient";

describe("ambient bed selection", () => {
  it("uses cold wind for opted-in snow and meadow otherwise", () => {
    expect(ambientEventFor(new URLSearchParams("weather=snow"))).toBe(
      "ambient.snow",
    );
    expect(ambientEventFor(new URLSearchParams())).toBe("ambient.temperate");
    expect(ambientEventFor(new URLSearchParams("weather=temperate"))).toBe(
      "ambient.temperate",
    );
  });

  it("honours explicit silence", () => {
    expect(ambientEventFor(new URLSearchParams("weather=none"))).toBeNull();
  });
});
