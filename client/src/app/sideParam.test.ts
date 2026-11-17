import { describe, expect, it } from "vitest";
import { sideParam, withSideParam } from "./sideParam";

describe("side URL parameter", () => {
  it("reads only 0 or 1", () => {
    expect(sideParam(new URLSearchParams("side=1"))).toBe(1);
    expect(sideParam(new URLSearchParams("side=0"))).toBe(0);
    expect(sideParam(new URLSearchParams("side=7"))).toBeNull();
    expect(sideParam(new URLSearchParams(""))).toBeNull();
  });

  it("writes the side onto a ?load= address and leaves others alone", () => {
    expect(withSideParam("?load=showcase", 1)).toBe("?load=showcase&side=1");
    expect(withSideParam("?load=showcase&side=1", 0)).toBe(
      "?load=showcase&side=0",
    );
    expect(withSideParam("?mute", 1)).toBe("?mute");
  });
});
