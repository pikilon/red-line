import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  type MatchSnapshot,
  NEUTRAL,
} from "../sim/matchSnapshot";
import { detectDeaths, spawnDeathEffects } from "./deaths";
import { createEffects } from "./effects";

function entity(
  id: number,
  owner: number,
  type: string,
  x: number,
  y: number,
  hp: number,
  extra: Partial<EntityState> = {},
): EntityState {
  return {
    id,
    owner,
    kind: typeIndex(type),
    x,
    y,
    hp,
    flags: 0,
    progress: 0,
    target: null,
    ...extra,
  };
}

function snapshot(tick: number, entities: EntityState[]): MatchSnapshot {
  return {
    tick,
    viewer: 0,
    credits: 0,
    powerProduced: 0,
    powerConsumed: 0,
    outcome: "ongoing",
    winner: null,
    entities,
    queues: [],
  };
}

describe("death detection", () => {
  it("AC-07-03: death detection", () => {
    // Full hp (250 > the 200 largest hit against light armor) but targeted:
    // only the `fired` target marks it as a death.
    const killed = entity(1, 1, "ua-kozak-scout", 10, 10, 250);
    const shooter = entity(2, 0, "ru-rifleman", 12, 10, 90, {
      flags: ENTITY_FLAGS.fired,
      target: 1,
    });
    // Full hp and untargeted: its hp (250) exceeds the largest single hit
    // against light armor (200), so leaving vision is not a death.
    const walker = entity(3, 0, "ua-kozak-scout", 3, 3, 250);
    const ghost = entity(4, 1, "ru-hq", 30, 30, 3000, {
      flags: ENTITY_FLAGS.ghost,
    });
    const depot = entity(5, NEUTRAL, "supply-depot", 20, 20, 5000);
    const building = entity(6, 1, "ua-barracks", 25, 25, 1000);
    const alreadyDead = entity(7, 0, "ua-rifleman", 40, 40, 0);

    const prev = snapshot(10, [
      killed,
      shooter,
      walker,
      ghost,
      depot,
      building,
      alreadyDead,
    ]);
    const next = snapshot(11, [shooter, ghost, depot, alreadyDead]);

    expect(detectDeaths(prev, next, 0).map((dead) => dead.id)).toEqual([1, 6]);

    // A non-advancing tick reports nothing.
    expect(detectDeaths(prev, snapshot(10, [shooter]), 0)).toEqual([]);
  });
});

describe("death effects", () => {
  it("AC-07-04: death effects and gore filter", () => {
    const effects = createEffects();
    const vehicle = entity(1, 0, "ua-leopard-2a4", 5, 5, 100);
    const infantry = entity(2, 0, "ua-rifleman", 6, 6, 100);
    const shooter = entity(3, 1, "ru-rifleman", 7, 5, 90, {
      flags: ENTITY_FLAGS.fired,
      target: 1,
    });
    const prev = snapshot(1, [vehicle, infantry, shooter]);
    const next = snapshot(2, [shooter]);
    const deaths = detectDeaths(prev, next, 0);
    expect([...deaths.map((dead) => dead.id)].sort()).toEqual([1, 2]);

    // Gore on: a wreck, a body and blood.
    spawnDeathEffects(deaths, effects, true, 0);
    effects.update(0);
    expect(effects.meshes.wreck.count).toBe(1);
    expect(effects.meshes.body.count).toBe(1);
    expect(effects.meshes.blood.count).toBeGreaterThan(0);

    // Gore off: no blood.
    effects.clear();
    spawnDeathEffects(deaths, effects, false, 0);
    effects.update(0);
    expect(effects.meshes.wreck.count).toBe(1);
    expect(effects.meshes.body.count).toBe(1);
    expect(effects.meshes.blood.count).toBe(0);

    // Turning gore off removes live blood decals.
    effects.clear();
    spawnDeathEffects(deaths, effects, true, 0);
    effects.update(0);
    expect(effects.meshes.blood.count).toBeGreaterThan(0);
    effects.clear("blood");
    effects.update(0);
    expect(effects.meshes.blood.count).toBe(0);
  });
});
