import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAME,
  exportProfile,
  importProfile,
  loadProfile,
  MAX_NAME_LENGTH,
  parseProfile,
  recordMatch,
  saveProfile,
  totals,
} from "./profile";
import { STORAGE_KEY as CAMPAIGN_KEY } from "./ui/campaign";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("player profile (spec 59)", () => {
  it("AC-59-01: a fresh browser has the default name and no stats", () => {
    const profile = loadProfile(memory());
    expect(profile.name).toBe(DEFAULT_NAME);
    expect(totals(profile)).toEqual({ played: 0, won: 0, lost: 0 });
  });

  it("AC-59-02: the name and colour are saved, cleaned and survive a reload", () => {
    const store = memory();
    saveProfile(
      { name: `  ${"x".repeat(40)}  `, colour: "#FF0000", stats: {} },
      store,
    );
    const profile = loadProfile(store);
    expect(profile.name).toHaveLength(MAX_NAME_LENGTH);
    expect(profile.colour).toBe("#ff0000");
    expect(parseProfile({ name: "   ", colour: "red" }).name).toBe(
      DEFAULT_NAME,
    );
  });

  it("AC-59-03: a finished match adds to the stats of the player's faction", () => {
    const store = memory();
    recordMatch("usa", "won", store);
    recordMatch("usa", "lost", store);
    recordMatch("china", "draw", store);
    const profile = loadProfile(store);
    expect(profile.stats.usa).toEqual({ played: 2, won: 1, lost: 1 });
    expect(profile.stats.china).toEqual({ played: 1, won: 0, lost: 0 });
    expect(totals(profile)).toEqual({ played: 3, won: 1, lost: 1 });
  });

  it("AC-59-04: export then import restores profile and campaign", () => {
    const a = memory();
    saveProfile({ name: "Ana", colour: "#00ff00", stats: {} }, a);
    recordMatch("usa", "won", a);
    a.setItem(CAMPAIGN_KEY, JSON.stringify({ usa: 3 }));
    const b = memory();
    expect(importProfile(exportProfile(a), b)).toBe(true);
    expect(loadProfile(b)).toEqual(loadProfile(a));
    expect(JSON.parse(b.getItem(CAMPAIGN_KEY) ?? "{}")).toEqual({ usa: 3 });
  });

  it("AC-59-05: a file that is not a profile export changes nothing", () => {
    const store = memory();
    saveProfile({ name: "Ana", colour: "#00ff00", stats: {} }, store);
    expect(importProfile("not json", store)).toBe(false);
    expect(importProfile(JSON.stringify({ format: "other" }), store)).toBe(
      false,
    );
    expect(loadProfile(store).name).toBe("Ana");
  });

  it("AC-59-06: corrupt stored data falls back to defaults", () => {
    const store = memory();
    store.setItem("redline.profile.v1", "{{");
    expect(loadProfile(store).name).toBe(DEFAULT_NAME);
    expect(
      parseProfile({ stats: { usa: { played: -4, won: "x", lost: 2 } } }).stats
        .usa,
    ).toEqual({ played: 2, won: 0, lost: 2 });
  });
});
