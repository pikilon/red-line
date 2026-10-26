import { describe, expect, it } from "vitest";

import { MusicDirector, menuMusicEvent } from "./music";

describe("Zero Hour music director", () => {
  it("starts on menu music and moves to the faction calm track", () => {
    const director = new MusicDirector(12000);
    expect(director.getEventId()).toBe(menuMusicEvent());
    expect(
      director.update({
        faction: "ukraine",
        combatActive: false,
        result: "ongoing",
        nowMs: 0,
      }),
    ).toBe("music.calm.ukraine");
  });

  it("holds the combat track for the quiet window before returning to calm", () => {
    const director = new MusicDirector(12000);
    director.setFaction("russia");
    expect(
      director.update({
        faction: "russia",
        combatActive: true,
        result: "ongoing",
        nowMs: 1000,
      }),
    ).toBe("music.combat.russia");
    expect(
      director.update({
        faction: "russia",
        combatActive: false,
        result: "ongoing",
        nowMs: 12999,
      }),
    ).toBe("music.combat.russia");
    expect(
      director.update({
        faction: "russia",
        combatActive: false,
        result: "ongoing",
        nowMs: 13001,
      }),
    ).toBe("music.calm.russia");
  });

  it("keeps victory/defeat terminal and follows a side switch", () => {
    const director = new MusicDirector(12000);
    director.setFaction("ukraine");
    expect(
      director.update({
        faction: "ukraine",
        combatActive: true,
        result: "ongoing",
        nowMs: 100,
      }),
    ).toBe("music.combat.ukraine");
    expect(
      director.update({
        faction: "ukraine",
        combatActive: false,
        result: "victory",
        nowMs: 200,
      }),
    ).toBe("music.victory.ukraine");
    expect(
      director.update({
        faction: "ukraine",
        combatActive: false,
        result: "victory",
        nowMs: 999999,
      }),
    ).toBe("music.victory.ukraine");

    director.setFaction("russia");
    expect(
      director.update({
        faction: "russia",
        combatActive: false,
        result: "ongoing",
        nowMs: 1000000,
      }),
    ).toBe("music.calm.russia");
  });
});
