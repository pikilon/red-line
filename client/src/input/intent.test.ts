import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { FX_ONE } from "../sim/fixed";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import { resolveClickOrder, resolveForceFire, resolveRally } from "./intent";

const entity = (args: {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  flags?: number;
}): EntityState => ({
  id: args.id,
  owner: args.owner,
  kind: typeIndex(args.kind),
  x: args.x,
  y: args.y,
  hp: 100,
  flags: args.flags ?? 0,
  progress: 0,
  target: null,
  heading: 0,
  turretAngle: 0,
});

// AC-03-49: own `ua-dozer` 7 at (5, 5), `ua-rifleman` 20 at (6, 5) and
// `ua-supply-truck` 21 at (7, 5); enemy `ru-rifleman` 30 at (40, 40); depot 0
// centred at (13, 55); own incomplete `ua-barracks` 16 centred at (13.5, 66.5).
const entities: EntityState[] = [
  entity({ id: 0, owner: 255, kind: "supply-depot", x: 13, y: 55 }),
  entity({ id: 7, owner: 0, kind: "ua-dozer", x: 5, y: 5 }),
  entity({
    id: 16,
    owner: 0,
    kind: "ua-barracks",
    x: 13.5,
    y: 66.5,
    flags: ENTITY_FLAGS.underConstruction,
  }),
  entity({ id: 20, owner: 0, kind: "ua-rifleman", x: 6, y: 5 }),
  entity({ id: 21, owner: 0, kind: "ua-supply-truck", x: 7, y: 5 }),
  entity({ id: 30, owner: 1, kind: "ru-rifleman", x: 40, y: 40 }),
];

const selected = [7, 20, 21];
const click = (x: number, y: number, ids: readonly number[] = selected) =>
  resolveClickOrder({ player: 0, selected: ids, entities, x, y });

describe("left-click intents", () => {
  it("AC-03-49: resolves left-click intents", () => {
    // The `move` of the unarmed units 7 and 21 is superseded by AC-08-20.
    expect(click(40, 40)).toEqual([
      { kind: "attack", player: 0, units: [20], target: 30 },
    ]);

    expect(click(13, 55)).toEqual([
      { kind: "harvest", player: 0, units: [21], depot: 0 },
      {
        kind: "move",
        player: 0,
        units: [7, 20],
        xRaw: 13 * FX_ONE,
        yRaw: 55 * FX_ONE,
      },
    ]);

    expect(click(13.5, 66.5)).toEqual([
      { kind: "resume", player: 0, units: [7], building: 16 },
      {
        kind: "move",
        player: 0,
        units: [20, 21],
        xRaw: 13.5 * FX_ONE,
        yRaw: 66.5 * FX_ONE,
      },
    ]);

    expect(click(30, 30)).toEqual([
      {
        kind: "move",
        player: 0,
        units: [7, 20, 21],
        xRaw: 30 * FX_ONE,
        yRaw: 30 * FX_ONE,
      },
    ]);
  });

  it("AC-08-25: a ground click never rallies; resolveRally does", () => {
    const barracks = entity({
      id: 40,
      owner: 0,
      kind: "ua-barracks",
      x: 20,
      y: 20,
    });
    const powerPlant = entity({
      id: 41,
      owner: 0,
      kind: "ua-power-plant",
      x: 40,
      y: 40,
    });
    const withBarracks = [...entities, barracks];
    const rally = {
      kind: "rally",
      player: 0,
      building: 40,
      xRaw: 30 * FX_ONE,
      yRaw: 30 * FX_ONE,
    } as const;
    expect(
      resolveClickOrder({
        player: 0,
        selected: [40],
        entities: withBarracks,
        x: 30,
        y: 30,
      }),
    ).toEqual([rally]);
    expect(
      resolveClickOrder({
        player: 0,
        selected: [41],
        entities: [...entities, powerPlant],
        x: 30,
        y: 30,
      }),
    ).toEqual([]);
    expect(
      resolveRally({
        player: 0,
        selected: [40],
        entities: withBarracks,
        x: 30,
        y: 30,
      }),
    ).toEqual([rally]);
    expect(
      resolveRally({
        player: 0,
        selected: [41],
        entities: [...entities, powerPlant],
        x: 30,
        y: 30,
      }),
    ).toEqual([]);
    expect(
      resolveRally({
        player: 0,
        selected: [40, 20],
        entities: withBarracks,
        x: 30,
        y: 30,
      }),
    ).toEqual([]);
  });

  it("AC-03-49: drops unowned ids, ignores ghosts and needs a selection", () => {
    expect(click(30, 30, [7, 30])).toEqual([
      {
        kind: "move",
        player: 0,
        units: [7],
        xRaw: 30 * FX_ONE,
        yRaw: 30 * FX_ONE,
      },
    ]);
    expect(click(30, 30, [99])).toEqual([]);
    expect(click(30, 30, [])).toEqual([]);

    const ghost = entity({
      id: 31,
      owner: 1,
      kind: "ru-barracks",
      x: 31,
      y: 30,
      flags: ENTITY_FLAGS.ghost,
    });
    expect(
      resolveClickOrder({
        player: 0,
        selected: [7],
        entities: [...entities, ghost],
        x: 31,
        y: 30,
      }),
    ).toEqual([
      {
        kind: "move",
        player: 0,
        units: [7],
        xRaw: 31 * FX_ONE,
        yRaw: 30 * FX_ONE,
      },
    ]);
  });

  it("AC-03-49: keeps a single non-doer unit moving to an incomplete own building", () => {
    expect(click(13.5, 66.5, [20])).toEqual([
      {
        kind: "move",
        player: 0,
        units: [20],
        xRaw: 13.5 * FX_ONE,
        yRaw: 66.5 * FX_ONE,
      },
    ]);
  });
});

// AC-08-20: an enemy `ru-barracks` 50 centred at (25.5, 25.5), an incomplete
// enemy `ru-power-plant` 51 centred at (31, 31), plus the AC-03-49 entities.
describe("attack intents", () => {
  const withBuildings = [
    ...entities,
    entity({ id: 50, owner: 1, kind: "ru-barracks", x: 25.5, y: 25.5 }),
    entity({
      id: 51,
      owner: 1,
      kind: "ru-power-plant",
      x: 31,
      y: 31,
      flags: ENTITY_FLAGS.underConstruction,
    }),
  ];
  const clickAt = (x: number, y: number, ids: readonly number[]) =>
    resolveClickOrder({
      player: 0,
      selected: ids,
      entities: withBuildings,
      x,
      y,
    });

  it("AC-08-20: attacks enemy units and buildings with the armed units only", () => {
    expect(clickAt(40, 40, [7, 20, 21])).toEqual([
      { kind: "attack", player: 0, units: [20], target: 30 },
    ]);
    expect(clickAt(25.5, 25.5, [7, 20, 21])).toEqual([
      { kind: "attack", player: 0, units: [20], target: 50 },
    ]);
    expect(clickAt(31, 31, [20])).toEqual([
      { kind: "attack", player: 0, units: [20], target: 51 },
    ]);
  });

  it("AC-08-20: picks the enemy model, not only its centre", () => {
    expect(clickAt(40.8, 40, [20])).toEqual([
      { kind: "attack", player: 0, units: [20], target: 30 },
    ]);
  });

  it("AC-08-20: unarmed units ignore a left click on an enemy", () => {
    expect(clickAt(40, 40, [7, 21])).toEqual([]);
    expect(clickAt(25.5, 25.5, [7, 21])).toEqual([]);
  });
});

describe("resolveForceFire (AC-20-02)", () => {
  it("AC-20-02: attacks an enemy unit under the cursor", () => {
    expect(
      resolveForceFire({
        player: 0,
        selected: [7, 20, 30],
        entities,
        x: 40,
        y: 40,
      }),
    ).toEqual([{ kind: "attack", player: 0, units: [20], target: 30 }]);
  });

  it("AC-20-02: picks the enemy model, not only its centre", () => {
    expect(
      resolveForceFire({
        player: 0,
        selected: [20],
        entities,
        x: 40.8,
        y: 40,
      }),
    ).toEqual([{ kind: "attack", player: 0, units: [20], target: 30 }]);
  });

  it("AC-20-02: attacks an enemy building under the cursor", () => {
    expect(
      resolveForceFire({
        player: 0,
        selected: [20],
        entities: [
          ...entities,
          entity({ id: 50, owner: 1, kind: "ru-barracks", x: 25.5, y: 25.5 }),
        ],
        x: 25.5,
        y: 25.5,
      }),
    ).toEqual([{ kind: "attack", player: 0, units: [20], target: 50 }]);
  });

  it("sends only the armed own units to the point", () => {
    expect(
      resolveForceFire({
        player: 0,
        selected: [7, 20, 30],
        entities,
        x: 12,
        y: 34,
      }),
    ).toEqual([
      {
        kind: "attackGround",
        player: 0,
        units: [20],
        xRaw: 12 * FX_ONE,
        yRaw: 34 * FX_ONE,
      },
    ]);
  });

  it("does nothing when no selected unit is armed", () => {
    expect(
      resolveForceFire({
        player: 0,
        selected: [7],
        entities,
        x: 12,
        y: 34,
      }),
    ).toEqual([]);
  });
});
