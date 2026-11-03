import { readFileSync } from "node:fs";
import savesIndex from "@data/saves.json";
import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import {
  advance,
  createBuiltTracker,
  findTutorial,
  nextTutorial,
  TUTORIALS,
} from "./tutorial";

function entity(
  id: number,
  owner: number,
  type: string,
  x = 0,
  flags = 0,
): EntityState {
  return {
    id,
    owner,
    kind: typeIndex(type),
    x,
    y: 0,
    hp: 100,
    flags,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
  };
}

describe("tutorials (spec 46)", () => {
  it("lists three missions per army, each with known types", () => {
    expect(TUTORIALS.map((mission) => mission.id)).toEqual([
      "tutorial-ua-base",
      "tutorial-ua-infantry",
      "tutorial-ua-armor",
      "tutorial-ua-drones",
      "tutorial-ua-air-defense",
      "tutorial-ru-base",
      "tutorial-ru-infantry",
      "tutorial-ru-armor",
      "tutorial-ru-drones",
      "tutorial-ru-air-defense",
    ]);
    const saves = savesIndex.saves.map((save) => save.id);
    for (const mission of TUTORIALS) {
      expect(saves).toContain(mission.id);
      for (const goal of mission.goals) {
        if (goal.kind === "own")
          expect(typeIndex(goal.type)).toBeGreaterThan(-1);
      }
    }
  });

  it("chains missions within one army only", () => {
    const base = findTutorial("tutorial-ua-base");
    const armor = findTutorial("tutorial-ua-armor");
    if (base === null || armor === null) throw new Error("missing mission");
    expect(nextTutorial(base)?.id).toBe("tutorial-ua-infantry");
    expect(nextTutorial(armor)?.id).toBe("tutorial-ua-drones");
    const last = findTutorial("tutorial-ua-air-defense");
    expect(last === null ? undefined : nextTutorial(last)).toBeNull();
  });

  it("counts finished buildings in order, not ones under construction", () => {
    const mission = findTutorial("tutorial-ua-base");
    if (mission === null) throw new Error("missing mission");
    const view = (entities: EntityState[]) => {
      const built = createBuiltTracker();
      built.update(entities, 0);
      return { built: built.built, dead: () => false };
    };
    const building = ENTITY_FLAGS.underConstruction;
    expect(
      advance(mission, 0, view([entity(1, 0, "ua-power-plant", 0, building)])),
    ).toBe(0);
    // The barracks alone does not skip the supply center step.
    expect(
      advance(
        mission,
        0,
        view([entity(1, 0, "ua-power-plant"), entity(2, 0, "ua-barracks")]),
      ),
    ).toBe(1);
    expect(
      advance(
        mission,
        1,
        view([entity(2, 0, "ua-supply-center"), entity(3, 0, "ua-barracks")]),
      ),
    ).toBe(3);
  });

  it("remembers what was built after it is gone, like BUILT_BY_PLAYER", () => {
    const built = createBuiltTracker();
    built.update([entity(4, 1, "ru-geran-2")], 1);
    built.update([entity(5, 1, "ru-geran-2")], 1);
    expect(built.built(typeIndex("ru-geran-2"))).toBe(2);
  });

  it("a destroy goal holds once the sim reports every entity dead", () => {
    const mission = findTutorial("tutorial-ua-infantry");
    if (mission === null) throw new Error("missing mission");
    const built = { built: () => 3 };
    expect(advance(mission, 2, { ...built, dead: (i) => i !== 6 })).toBe(2);
    expect(advance(mission, 2, { ...built, dead: () => true })).toBe(3);
  });

  it("destroy goals and waves name entities of the save", () => {
    for (const mission of TUTORIALS) {
      const file = JSON.parse(
        readFileSync(
          new URL(
            `../../../data/generated/saves/${mission.id}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as {
        setup: { entities: { player: number }[] };
        client: { controlled: number };
      };
      const { entities } = file.setup;
      const player = file.client.controlled;
      expect(entities[0]?.player).toBe(player);
      const enemies = mission.goals.flatMap((goal) =>
        goal.kind === "destroy" ? goal.entities : [],
      );
      for (const index of [...enemies, ...(mission.wave?.units ?? [])]) {
        expect(entities[index]?.player, `${mission.id} ${index}`).toBe(
          1 - player,
        );
      }
      if (mission.wave !== undefined) {
        expect(entities[mission.wave.target]?.player).toBe(player);
      }
    }
  });
});
