import { describe, expect, it } from "vitest";

import {
  decodeMatchSnapshot,
  type MatchSnapshot,
  type PlayerStats,
} from "../sim/matchSnapshot";
import { matchTime, scoreOf, scoreRows } from "./scoreScreen";

function stats(player: number, overrides: Partial<PlayerStats>): PlayerStats {
  return {
    player,
    unitsBuilt: 0,
    unitsLost: 0,
    unitsDestroyed: 0,
    buildingsBuilt: 0,
    buildingsLost: 0,
    buildingsDestroyed: 0,
    moneyEarned: 0,
    moneySpent: 0,
    ...overrides,
  };
}

function snapshot(overrides: Partial<MatchSnapshot>): MatchSnapshot {
  return {
    tick: 15 * 125,
    viewer: 0,
    credits: 0,
    powerProduced: 0,
    powerConsumed: 0,
    outcome: "winner",
    winner: 1,
    entities: [],
    queues: [],
    rallies: [],
    stats: [
      stats(0, { unitsBuilt: 3, unitsLost: 2, moneySpent: 900 }),
      stats(1, { unitsBuilt: 5, unitsDestroyed: 2, moneyEarned: 1500 }),
    ],
    ...overrides,
  };
}

describe("score screen (spec 57)", () => {
  it("AC-57-07: decodes the counters that close the snapshot", () => {
    const header = [10, 0, 0, 0, 0, 0, -1, 0];
    const data = new Int32Array([
      ...header,
      0, // queues
      0, // rallies
      0, // air
      0, // upgrades
      2, // players
      ...[0, 3, 2, 0, 1, 0, 0, 0, 900],
      ...[1, 5, 0, 2, 0, 1, 1, 1500, 100],
    ]);
    expect(decodeMatchSnapshot(data).stats).toEqual([
      stats(0, {
        unitsBuilt: 3,
        unitsLost: 2,
        buildingsBuilt: 1,
        moneySpent: 900,
      }),
      stats(1, {
        unitsBuilt: 5,
        unitsDestroyed: 2,
        buildingsLost: 1,
        buildingsDestroyed: 1,
        moneyEarned: 1500,
        moneySpent: 100,
      }),
    ]);
    expect(
      decodeMatchSnapshot(new Int32Array([...header, 0, 0])).stats,
    ).toEqual([]);
  });

  it("AC-57-08: orders rows by Zero Hour's score and marks you and the winner", () => {
    expect(scoreOf(stats(0, { unitsBuilt: 1, moneyEarned: 50 }))).toBe(150);
    const rows = scoreRows(snapshot({}), 0, (player) => `P${player + 1}`);
    expect(rows.map((row) => [row.name, row.you, row.winner])).toEqual([
      ["P2", false, true],
      ["P1", true, false],
    ]);
  });

  it("AC-57-09: formats the match time", () => {
    expect(matchTime(0)).toBe("0:00");
    expect(matchTime(15 * 125)).toBe("2:05");
    expect(matchTime(15 * 3725)).toBe("1:02:05");
  });
});
