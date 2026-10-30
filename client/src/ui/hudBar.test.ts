import { describe, expect, it } from "vitest";
import { autoTab } from "./hudBar";

const offer = { build: false, newSelection: false, fromGroup: false };

describe("autoTab", () => {
  it("opens Build for a new selection that builds, Orders otherwise", () => {
    const build = { ...offer, newSelection: true, build: true };
    expect(autoTab("orders", build)).toBe("build");
    expect(autoTab("groups", build)).toBe("build");
    expect(autoTab("build", { ...offer, newSelection: true })).toBe("orders");
  });

  it("keeps the tab the player chose while the selection stands", () => {
    expect(autoTab("orders", { ...offer, build: true })).toBe("orders");
    expect(autoTab("groups", offer)).toBe("groups");
  });

  it("leaves Build when there is nothing left to build", () => {
    expect(autoTab("build", offer)).toBe("orders");
  });

  it("stays on Groups for a selection from a group slot", () => {
    const group = { ...offer, newSelection: true, fromGroup: true };
    expect(autoTab("groups", group)).toBe("groups");
    expect(autoTab("build", group)).toBe("orders");
  });
});
