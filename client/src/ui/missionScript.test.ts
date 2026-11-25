import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import { findCampaignMission } from "./campaign";
import {
  createScriptRunner,
  type MissionScript,
  type ScriptView,
} from "./missionScript";

function unit(owner: number, x: number, y: number): EntityState {
  return {
    id: 1,
    owner,
    kind: typeIndex("ua-rifleman"),
    x,
    y,
    hp: 100,
    flags: 0,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
  };
}

const view = (over: Partial<ScriptView> = {}): ScriptView => ({
  tick: 0,
  player: 0,
  entities: [],
  goalsDone: 0,
  dead: () => false,
  ...over,
});

const say = { kind: "message", text: "campaign.ru.01.script.ambush" } as const;
const script = (over: Partial<MissionScript>): MissionScript => ({
  id: "s",
  when: [],
  actions: [say],
  repeat: false,
  everyTicks: 15,
  ...over,
});

describe("mission scripts (spec 62)", () => {
  it("AC-62-01 fires a timed script once, when its tick passes", () => {
    const runner = createScriptRunner([
      script({ when: [{ kind: "after", ticks: 30 }] }),
    ]);
    expect(runner.update(view({ tick: 29 }))).toEqual([]);
    expect(runner.update(view({ tick: 30 }))).toEqual([say]);
    expect(runner.update(view({ tick: 31 }))).toEqual([]);
  });

  it("AC-62-02 enters needs a unit of that side inside the area", () => {
    const own = script({
      when: [{ kind: "enters", side: "own", area: [10, 10, 20, 20] }],
    });
    const outside = view({ entities: [unit(0, 9.5, 12), unit(1, 15, 15)] });
    expect(createScriptRunner([own]).update(outside)).toEqual([]);
    const inside = view({ entities: [unit(1, 15, 15), unit(0, 20.9, 10.1)] });
    expect(createScriptRunner([own]).update(inside)).toEqual([say]);
    const enemy = script({
      when: [{ kind: "enters", side: "enemy", area: [10, 10, 20, 20] }],
    });
    expect(createScriptRunner([enemy]).update(inside)).toEqual([say]);
    expect(
      createScriptRunner([enemy]).update(view({ entities: [unit(0, 15, 15)] })),
    ).toEqual([]);
  });

  it("AC-62-03 destroyed and goal conditions read the mission", () => {
    const both = script({
      when: [
        { kind: "destroyed", entity: 7 },
        { kind: "goal", steps: 1 },
      ],
    });
    const runner = createScriptRunner([both]);
    const dead = (index: number) => index === 7;
    expect(runner.watched()).toEqual([7]);
    expect(runner.update(view({ dead }))).toEqual([]);
    expect(runner.update(view({ goalsDone: 1 }))).toEqual([]);
    expect(runner.update(view({ dead, goalsDone: 1 }))).toEqual([say]);
    expect(runner.watched()).toEqual([]);
  });

  it("AC-62-04 repeat fires again every interval while it holds", () => {
    const runner = createScriptRunner([
      script({
        repeat: true,
        everyTicks: 15,
        when: [{ kind: "after", ticks: 0 }],
      }),
    ]);
    expect(runner.update(view({ tick: 0 }))).toEqual([say]);
    expect(runner.update(view({ tick: 14 }))).toEqual([]);
    expect(runner.update(view({ tick: 15 }))).toEqual([say]);
  });

  it("AC-62-05 hands every action of a script over in order", () => {
    const end = { kind: "end", won: false } as const;
    const runner = createScriptRunner([
      script({ actions: [say, end], when: [{ kind: "after", ticks: 0 }] }),
    ]);
    expect(runner.update(view())).toEqual([say, end]);
  });

  it("AC-62-06 mission 1 of each campaign has scripts over real labels", () => {
    for (const id of ["campaign-ua-01-hostomel", "campaign-ru-01-hostomel"]) {
      const mission = findCampaignMission(id);
      const scripts = mission?.scripts ?? [];
      expect(scripts.length).toBeGreaterThan(0);
      const kinds = scripts.flatMap((s) => s.actions.map((a) => a.kind));
      expect(kinds).toContain("reinforce");
      expect(kinds).toContain("objective");
      expect(kinds.some((k) => k === "message" || k === "dialogue")).toBe(true);
    }
  });
});
