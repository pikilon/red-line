import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import {
  advance,
  createEnemyTracker,
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
      "tutorial-ru-base",
      "tutorial-ru-infantry",
      "tutorial-ru-armor",
    ]);
    for (const mission of TUTORIALS) {
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
    expect(nextTutorial(armor)).toBeNull();
  });

  it("counts finished buildings in order, not ones under construction", () => {
    const mission = findTutorial("tutorial-ua-base");
    if (mission === null) throw new Error("missing mission");
    const view = (entities: EntityState[]) => ({
      entities,
      player: 0,
      enemiesLeft: null,
    });
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

  it("counts an enemy destroyed only when it vanishes in sight", () => {
    const tracker = createEnemyTracker();
    const inSight = (x: number) => x < 10;
    expect(
      tracker.update([entity(1, 0, "ua-rifleman")], 0, inSight),
    ).toBeNull();
    const enemies = [
      entity(5, 1, "ru-rifleman", 5),
      entity(6, 1, "ru-rifleman", 20),
    ];
    expect(tracker.update(enemies, 0, inSight)).toBe(2);
    // Both vanish: the one in sight died, the one in the fog may live.
    expect(tracker.update([], 0, inSight)).toBe(1);
    expect(tracker.update([], 0, () => true)).toBe(0);
  });
});
