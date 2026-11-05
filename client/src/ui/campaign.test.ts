import { readFileSync } from "node:fs";
import savesIndex from "@data/saves.json";
import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import { typeIndex } from "../rules";
import {
  CAMPAIGNS,
  createCampaignProgress,
  findCampaignMission,
  nextCampaignMission,
} from "./campaign";
import { advance } from "./tutorial";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("campaigns (spec 48)", () => {
  it("has ten missions per army, each on a listed save with known keys", () => {
    const saves = savesIndex.saves.map((save) => save.id);
    const keys = new Set(Object.keys(en));
    for (const campaign of CAMPAIGNS) {
      expect(campaign.missions.map((m) => m.number)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(keys.has(campaign.aim) && keys.has(campaign.ending)).toBe(true);
      for (const mission of campaign.missions) {
        expect(saves).toContain(mission.id);
        for (const key of [
          mission.title,
          mission.when,
          mission.video,
          mission.briefing,
        ]) {
          expect(keys.has(key), key).toBe(true);
        }
        for (const goal of mission.goals) {
          if (goal.kind === "own")
            expect(typeIndex(goal.type)).toBeGreaterThan(-1);
          if (goal.kind === "destroy" || goal.kind === "survive")
            expect(keys.has(goal.text), goal.text).toBe(true);
          if (goal.hint !== undefined)
            expect(keys.has(goal.hint), goal.hint).toBe(true);
        }
      }
    }
  });

  it("destroy goals name enemies of the save; the player owns entity 0", () => {
    for (const campaign of CAMPAIGNS) {
      for (const mission of campaign.missions) {
        const file = JSON.parse(
          readFileSync(
            new URL(
              `../../../data/generated/saves/${mission.id}.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ) as {
          setup: { victory: boolean; entities: { player: number }[] };
          client: { controlled: number };
        };
        const player = file.client.controlled;
        expect(player).toBe(campaign.faction === "ukraine" ? 0 : 1);
        expect(file.setup.victory).toBe(true);
        expect(file.setup.entities[0]?.player).toBe(player);
        for (const goal of mission.goals) {
          if (goal.kind !== "destroy") continue;
          for (const index of goal.entities) {
            expect(file.setup.entities[index]?.player, mission.id).toBe(
              1 - player,
            );
          }
        }
      }
    }
  });

  it("chains missions in order and ends after the tenth", () => {
    const first = findCampaignMission("campaign-ua-01-hostomel");
    if (first === null) throw new Error("missing mission");
    expect(nextCampaignMission(first)?.id).toBe("campaign-ua-02-irpin");
    const last = findCampaignMission("campaign-ru-10-narva");
    if (last === null) throw new Error("missing mission");
    expect(nextCampaignMission(last)).toBeNull();
  });

  it("records the highest mission won per army and never goes back", () => {
    const progress = createCampaignProgress(memoryStorage());
    const [ukraine] = CAMPAIGNS;
    if (ukraine === undefined) throw new Error("missing campaign");
    expect(progress.won("ukraine")).toBe(0);
    progress.record(ukraine.missions[1] as never);
    progress.record(ukraine.missions[0] as never);
    expect(progress.won("ukraine")).toBe(2);
    expect(progress.won("russia")).toBe(0);
  });

  it("a survive goal holds once its ticks passed since it became current", () => {
    const mission = findCampaignMission("campaign-ua-01-hostomel");
    if (mission === null) throw new Error("missing mission");
    const starts = new Map<number, number>();
    let tick = 100;
    const view = {
      built: () => 0,
      dead: () => false,
      held: (step: number, ticks: number) => {
        const start = starts.get(step) ?? tick;
        starts.set(step, start);
        return tick - start >= ticks;
      },
    };
    expect(advance(mission, 0, view)).toBe(0);
    tick += 4 * 60 * 15;
    expect(advance(mission, 0, view)).toBe(1);
    // The victory step holds once the sim names the player the winner.
    const won = { ...view, dead: () => true, won: () => true };
    expect(advance(mission, 1, won)).toBe(3);
  });
});
