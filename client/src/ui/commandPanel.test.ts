import { describe, expect, it } from "vitest";

import { RULES, typeDef } from "../rules";
import type { EntityState, QueueState } from "../sim/matchSnapshot";
import { ENTITY_FLAGS } from "../sim/matchSnapshot";
import { commandButtons } from "./commandPanel";

// Type indices from the builtin ruleset.
const RIFLEMAN = 2;
const STUGNA_TEAM = 3;
const DOZER = 8;
const POWER_PLANT = 11;
const SUPPLY_CENTER = 12;
const BARRACKS = 13;
const VEHICLE_FACTORY = 14;
const DEFENSE = 15;

function entity(overrides: Partial<EntityState>): EntityState {
  return {
    id: 0,
    owner: 0,
    kind: 0,
    x: 0,
    y: 0,
    hp: 0,
    flags: 0,
    progress: 0,
    target: null,
    ...overrides,
  };
}

function complete(kind: number): number {
  // A building is complete when its progress reaches build_ticks * 100.
  return typeDef(kind).buildTicks * 100;
}

describe("command panel", () => {
  it("AC-03-51: lists construct and produce buttons", () => {
    const dozer = entity({ id: 1, owner: 0, kind: DOZER });
    const powerPlant = entity({
      id: 2,
      owner: 0,
      kind: POWER_PLANT,
      progress: complete(POWER_PLANT),
    });

    const buttons = commandButtons({
      selected: [dozer],
      ownEntities: [dozer, powerPlant],
      credits: 700,
      queue: null,
    });

    // construct buttons for the dozer's builds list, in ruleset order.
    expect(buttons.map((button) => button.typeIndex)).toEqual([
      POWER_PLANT,
      SUPPLY_CENTER,
      BARRACKS,
      VEHICLE_FACTORY,
      DEFENSE,
    ]);
    expect(buttons.every((button) => button.action === "construct")).toBe(true);
    // enabled true, false, true, false, false.
    expect(buttons.map((button) => button.enabled)).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
    // First label is "Power plant (600)".
    const [first] = buttons;
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.label).toBe("Power plant (600)");
    expect(first.cost).toBe(typeDef(POWER_PLANT).cost);
  });

  it("AC-03-51: produces units from a complete barracks", () => {
    const barracks = entity({
      id: 10,
      owner: 0,
      kind: BARRACKS,
      progress: complete(BARRACKS),
    });

    const buttons = commandButtons({
      selected: [barracks],
      ownEntities: [barracks],
      credits: 5000,
      queue: { building: 10, headPermille: 0, items: [] },
    });

    expect(buttons.map((button) => button.typeIndex)).toEqual([
      RIFLEMAN,
      STUGNA_TEAM,
    ]);
    expect(buttons.every((button) => button.action === "produce")).toBe(true);
    expect(buttons.map((button) => button.enabled)).toEqual([true, true]);
  });

  it("AC-03-51: disables produce buttons when the queue is full", () => {
    const barracks = entity({
      id: 10,
      owner: 0,
      kind: BARRACKS,
      progress: complete(BARRACKS),
    });
    const fullQueue: QueueState = {
      building: 10,
      headPermille: 1000,
      items: [RIFLEMAN, STUGNA_TEAM, RIFLEMAN, STUGNA_TEAM, RIFLEMAN],
    };

    const buttons = commandButtons({
      selected: [barracks],
      ownEntities: [barracks],
      credits: 5000,
      queue: fullQueue,
    });

    expect(buttons.map((button) => button.enabled)).toEqual([false, false]);
  });

  it("AC-03-51: gives no buttons for an under-construction barracks", () => {
    const barracks = entity({
      id: 10,
      owner: 0,
      kind: BARRACKS,
      flags: ENTITY_FLAGS.underConstruction,
      progress: 0,
    });

    const buttons = commandButtons({
      selected: [barracks],
      ownEntities: [barracks],
      credits: 5000,
      queue: { building: 10, headPermille: 0, items: [] },
    });

    expect(buttons).toEqual([]);
  });

  it("AC-03-51: gives no buttons for an enemy entity", () => {
    const enemy = entity({ id: 200, owner: 1, kind: RIFLEMAN });

    const buttons = commandButtons({
      selected: [enemy],
      ownEntities: [],
      credits: 5000,
      queue: null,
    });

    expect(buttons).toEqual([]);
  });

  it("AC-03-51: gives no buttons when nothing relevant is selected", () => {
    const rifleman = entity({ id: 300, owner: 0, kind: RIFLEMAN });

    const buttons = commandButtons({
      selected: [rifleman],
      ownEntities: [rifleman],
      credits: 5000,
      queue: null,
    });

    expect(buttons).toEqual([]);
  });

  it("AC-03-51: uses the lowest-id builder when several are selected", () => {
    const dozerA = entity({ id: 5, owner: 0, kind: DOZER });
    const dozerB = entity({ id: 2, owner: 0, kind: DOZER });

    const buttons = commandButtons({
      selected: [dozerA, dozerB],
      ownEntities: [dozerA, dozerB],
      credits: 700,
      queue: null,
    });

    expect(buttons.map((button) => button.typeIndex)).toEqual([
      POWER_PLANT,
      SUPPLY_CENTER,
      BARRACKS,
      VEHICLE_FACTORY,
      DEFENSE,
    ]);
    // The queue is only consulted for a producing building.
    expect(RULES.maxQueue).toBe(5);
  });
});
