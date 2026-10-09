import { describe, expect, it } from "vitest";

import type { MatchSnapshot } from "../sim/matchSnapshot";
import { outcomeText } from "./outcome";
import { resourceText } from "./resourceBar";

function snapshot(overrides: Partial<MatchSnapshot>): MatchSnapshot {
  return {
    tick: 1,
    viewer: 0,
    credits: 0,
    powerProduced: 0,
    powerConsumed: 0,
    outcome: "ongoing",
    winner: null,
    entities: [],
    queues: [],
    ...overrides,
  };
}

describe("resource bar and outcome", () => {
  it("AC-03-52: formats resources and the outcome", () => {
    const balanced = snapshot({
      credits: 4400,
      powerProduced: 10,
      powerConsumed: 8,
    });
    expect(resourceText(balanced)).toEqual({
      credits: "Credits 4400",
      power: "Power 10/8",
      low: false,
    });

    const deficit = snapshot({
      credits: 4400,
      powerProduced: 10,
      powerConsumed: 12,
    });
    expect(resourceText(deficit)).toEqual({
      credits: "Credits 4400",
      power: "Power 10/12",
      low: true,
    });

    // Outcome is reported once the match ends; null while ongoing.
    expect(outcomeText(snapshot({ outcome: "ongoing" }), 0)).toBe(null);
    expect(outcomeText(snapshot({ outcome: "winner", winner: 0 }), 0)).toBe(
      "Victory",
    );
    expect(outcomeText(snapshot({ outcome: "winner", winner: 0 }), 1)).toBe(
      "Defeat",
    );
    expect(outcomeText(snapshot({ outcome: "draw" }), 0)).toBe("Draw");
  });
});
