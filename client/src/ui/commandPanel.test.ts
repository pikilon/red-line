import { describe, expect, it } from "vitest";

import { RULES, typeDef } from "../rules";
import type { EntityState, QueueState } from "../sim/matchSnapshot";
import { ENTITY_FLAGS } from "../sim/matchSnapshot";
import { commandButtons, samePanelInput } from "./commandPanel";

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
      items: [
        RIFLEMAN,
        STUGNA_TEAM,
        RIFLEMAN,
        STUGNA_TEAM,
        RIFLEMAN,
        STUGNA_TEAM,
        RIFLEMAN,
        STUGNA_TEAM,
        RIFLEMAN,
      ],
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
    expect(RULES.maxQueue).toBe(9);
  });

  it("AC-03-51: reads the permille progress of the match snapshot", () => {
    // §5.15: snapshot progress is permille and a complete building is exactly
    // 1000, so `build_ticks * 100` is never the completeness threshold.
    const HQ = 10;
    const PERMILLE_FULL = 1000;
    // The HQ has build_ticks 0: only the permille total makes it complete.
    const unfinishedHq = entity({
      id: 4,
      owner: 0,
      kind: HQ,
      flags: ENTITY_FLAGS.underConstruction,
      progress: 900,
    });
    const dozer = entity({ id: 1, owner: 0, kind: DOZER });
    const powerPlant = entity({
      id: 2,
      owner: 0,
      kind: POWER_PLANT,
      progress: PERMILLE_FULL,
    });
    const barracks = entity({
      id: 3,
      owner: 0,
      kind: BARRACKS,
      progress: PERMILLE_FULL,
    });

    // The complete power plant satisfies the barracks requirement.
    const construct = commandButtons({
      selected: [dozer],
      ownEntities: [dozer, powerPlant, unfinishedHq],
      credits: 700,
      queue: null,
    });
    expect(construct.map((button) => button.enabled)).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);

    // The complete barracks at the permille total offers its produce buttons.
    const produce = commandButtons({
      selected: [barracks],
      ownEntities: [barracks],
      credits: 5000,
      queue: { building: 3, headPermille: 0, items: [] },
    });
    expect(produce.map((button) => button.typeIndex)).toEqual([
      RIFLEMAN,
      STUGNA_TEAM,
    ]);

    // Below the permille total the building is still under construction, even
    // when its build_ticks are 0 (the HQ) or just one permille short.
    expect(
      commandButtons({
        selected: [unfinishedHq],
        ownEntities: [unfinishedHq],
        credits: 5000,
        queue: { building: 4, headPermille: 0, items: [] },
      }),
    ).toEqual([]);
    const almostBarracks = entity({
      id: 5,
      owner: 0,
      kind: BARRACKS,
      flags: ENTITY_FLAGS.underConstruction,
      progress: 999,
    });
    expect(
      commandButtons({
        selected: [almostBarracks],
        ownEntities: [almostBarracks],
        credits: 5000,
        queue: { building: 5, headPermille: 0, items: [] },
      }),
    ).toEqual([]);
  });
});

describe("samePanelInput", () => {
  const button = {
    typeIndex: POWER_PLANT,
    label: "Power plant (600)",
    cost: 600,
    enabled: true,
    action: "construct" as const,
  };
  const queue = { building: 4, headPermille: 100, items: [RIFLEMAN] };

  it("is true for equal content in fresh objects", () => {
    expect(
      samePanelInput(
        { buttons: [button], queue, placing: null },
        {
          buttons: [{ ...button }],
          queue: { ...queue, items: [RIFLEMAN] },
          placing: null,
        },
      ),
    ).toBe(true);
  });

  it("is false when a button, the queue or placing changes", () => {
    const base = { buttons: [button], queue, placing: null };
    expect(
      samePanelInput(base, {
        ...base,
        buttons: [{ ...button, enabled: false }],
      }),
    ).toBe(false);
    expect(
      samePanelInput(base, { ...base, queue: { ...queue, headPermille: 200 } }),
    ).toBe(false);
    expect(samePanelInput(base, { ...base, queue: null })).toBe(false);
    expect(samePanelInput(base, { ...base, placing: POWER_PLANT })).toBe(false);
  });
});
