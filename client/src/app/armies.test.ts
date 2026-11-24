import { describe, expect, it } from "vitest";
import {
  enemyArmyIds,
  factionIdOfPlayer,
  personalityFor,
  readArmies,
  startArmies,
} from "./armies";

describe("armies (spec 53)", () => {
  it("AC-53-01: reads the URL pick, then the saved one, ignoring unknown ids", () => {
    const url = new URLSearchParams("army=russia&enemy=russia");
    expect(readArmies(url, undefined)).toEqual({
      player: "russia",
      enemy: "russia",
    });
    const saved = { player: "russia", enemy: "ukraine" };
    expect(readArmies(new URLSearchParams(), saved)).toEqual(saved);
    expect(
      readArmies(new URLSearchParams("army=atlantis"), undefined),
    ).toBeNull();
    expect(readArmies(new URLSearchParams(), undefined)).toBeNull();
  });

  it("AC-53-02: the player's army goes to the controlled start", () => {
    const choice = { player: "ukraine", enemy: "russia" };
    expect(startArmies(choice, 0)).toEqual(["ukraine", "russia"]);
    expect(startArmies(choice, 1)).toEqual(["russia", "ukraine"]);
    expect(startArmies(null, 0)).toEqual([]);
  });

  it("AC-53-03: enemies are the factions an AI can play; personalities follow the faction", () => {
    expect(enemyArmyIds()).toEqual(["ukraine", "russia"]);
    expect(personalityFor("russia", "balanced")).toBe("russia-balanced");
    expect(personalityFor("ukraine", "rush")).toBe("ukraine-rush");
  });

  it("AC-53-04: the faction of a player falls back to the map's default", () => {
    expect(factionIdOfPlayer([], 1)).toBe("russia");
    expect(factionIdOfPlayer([], 7)).toBe("ukraine");
  });
});
