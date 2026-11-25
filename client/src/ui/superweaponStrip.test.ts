// Spec 64 AC-64-08: the countdowns every player sees and the launch notices.
import { describe, expect, it } from "vitest";
import { RULES } from "../rules";
import type { MatchSnapshot } from "../sim/matchSnapshot";
import { generalView } from "./generalsPanel";
import {
  clock,
  superweaponEvents,
  superweaponTimers,
} from "./superweaponStrip";

function snapshot(
  tick: number,
  generals?: MatchSnapshot["generals"],
): MatchSnapshot {
  return {
    tick,
    viewer: 0,
    credits: 0,
    powerProduced: 0,
    powerConsumed: 0,
    outcome: "ongoing",
    winner: null,
    entities: [],
    queues: [],
    rallies: [],
    generals,
  };
}

const power = (id: string): number =>
  RULES.general.powers.findIndex((p) => p.id === id);

describe("superweaponTimers", () => {
  it("lists the countdowns of every player and ignores bought powers", () => {
    const ua = power("strike-ukraine");
    const ru = power("strike-russia");
    const scan = power("recon-scan");
    const timers = superweaponTimers(
      snapshot(100, [
        { player: 0, xp: 0, powers: [{ power: ua, readyTick: 100 }] },
        {
          player: 1,
          xp: 0,
          powers: [
            { power: scan, readyTick: 0 },
            { power: ru, readyTick: 1600 },
          ],
        },
      ]),
    );
    expect(timers.map((x) => [x.player, x.id, x.secondsLeft, x.ready])).toEqual(
      [
        [0, "strike-ukraine", 0, true],
        [1, "strike-russia", 100, false],
      ],
    );
  });

  it("keeps superweapons out of the General's buy list", () => {
    const view = generalView(snapshot(0), 0, 0);
    expect(view.powers.some((p) => p.id.startsWith("strike-"))).toBe(false);
  });
});

describe("superweaponEvents", () => {
  const ua = power("strike-ukraine");
  const at = (tick: number, readyTick: number) =>
    snapshot(tick, [{ player: 0, xp: 0, powers: [{ power: ua, readyTick }] }]);

  it("reports a new countdown and a launch, not a halted one", () => {
    expect(superweaponEvents(snapshot(9), at(10, 5410))).toEqual([
      { kind: "building", player: 0, id: "strike-ukraine" },
    ]);
    expect(superweaponEvents(at(10, 0), at(11, 5411))).toEqual([
      { kind: "launch", player: 0, id: "strike-ukraine" },
    ]);
    expect(superweaponEvents(at(10, 5410), at(11, 5411))).toEqual([]);
    expect(superweaponEvents(null, at(11, 5411))).toEqual([]);
  });
});

describe("clock", () => {
  it("shows minutes and seconds", () => {
    expect(clock(125)).toBe("2:05");
    expect(clock(0)).toBe("0:00");
  });
});
