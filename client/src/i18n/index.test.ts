import { describe, expect, it } from "vitest";
import en from "./en.json";
import { type MessageKey, t } from "./index";

describe("i18n", () => {
  it("AC-02-35: translates keys with parameters", () => {
    expect(t("hud.selectedCount", { count: 3 })).toBe("Selected: 3");
    expect(t("hud.tick", {})).toBe("Tick {tick}");
    const values = Object.values(en) as unknown[];
    expect(Object.keys(en).length).toBeGreaterThan(0);
    for (const value of values) {
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
    expect(Object.keys(en)).toContain("error.simInit" satisfies MessageKey);
  });
});
