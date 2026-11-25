// Spec 63 AC-63-10: what the rank badge and the General's powers panel show.
import { describe, expect, it } from "vitest";
import { RULES } from "../rules";
import { decodeMatchSnapshot, type MatchSnapshot } from "../sim/matchSnapshot";
import { generalView } from "./generalsPanel";

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

describe("generalView", () => {
  it("starts at rank 1 with one point and only the player's faction powers", () => {
    const view = generalView(snapshot(0), 0, 0);
    expect(view.rank).toBe(1);
    expect(view.points).toBe(1);
    expect(view.nextXp).toBe(RULES.general.ranks[1]?.xp);
    const ids = view.powers.map((p) => p.id);
    expect(ids).toContain("paradrop-ukraine");
    expect(ids).not.toContain("paradrop-russia");
    const states = Object.fromEntries(view.powers.map((p) => [p.id, p.state]));
    expect(states["recon-scan"]).toBe("affordable");
    expect(states["emergency-repair"]).toBe("locked");
  });

  it("derives rank and points from skill points and the powers bought", () => {
    const scan = power("recon-scan");
    const view = generalView(
      snapshot(100, [
        { player: 0, xp: 900, powers: [{ power: scan, readyTick: 130 }] },
      ]),
      0,
      0,
    );
    expect(view.rank).toBe(3);
    expect(view.points).toBe(2);
    const scanView = view.powers.find((p) => p.id === "recon-scan");
    expect(scanView?.state).toBe("recharging");
    expect(scanView?.secondsLeft).toBe(2);
    const barrage = view.powers.find((p) => p.id === "artillery-barrage");
    expect(barrage?.state).toBe("affordable");
  });

  it("offers a bought power to cast once its recharge has passed", () => {
    const scan = power("recon-scan");
    const view = generalView(
      snapshot(200, [
        { player: 0, xp: 0, powers: [{ power: scan, readyTick: 130 }] },
      ]),
      0,
      0,
    );
    expect(view.points).toBe(0);
    expect(view.powers.find((p) => p.id === "recon-scan")?.state).toBe("ready");
  });
});

describe("decodeMatchSnapshot generals tail", () => {
  it("reads the skill points and powers after the counters", () => {
    // header(8) + 0 entities, 0 queues, 0 rallies, air 0, upgrades 0, then one
    // stats record (player 0 + 8 counters) and one general (player 0, 900 xp,
    // one power 3 ready at tick 77).
    const data = Int32Array.from([
      5, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
      900, 1, 3, 77,
    ]);
    const decoded = decodeMatchSnapshot(data);
    expect(decoded.generals).toEqual([
      { player: 0, xp: 900, powers: [{ power: 3, readyTick: 77 }] },
    ]);
  });
});
