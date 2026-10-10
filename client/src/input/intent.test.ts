import { describe, expect, it } from "vitest";
import { type EntityState, ENTITY_FLAGS } from "../sim/matchSnapshot";
import { FX_ONE } from "../sim/fixed";
import { typeIndex } from "../rules";
import { resolveRightClick } from "./intent";

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
});

// AC-03-49: own `ua-dozer` 7 at (5, 5), `ua-rifleman` 20 at (6, 5) and
// `ua-supply-truck` 21 at (7, 5); enemy `ru-rifleman` 30 at (40, 40); depot 0
// centred at (13, 55); own incomplete `ua-barracks` 16 centred at (13.5, 66.5).
const entities: EntityState[] = [
  entity({ id: 0, owner: 255, kind: "supply-depot", x: 13, y: 55 }),
  entity({ id: 7, owner: 0, kind: "ua-dozer", x: 5, y: 5 }),
  entity({ id: 16, owner: 0, kind: "ua-barracks", x: 13.5, y: 66.5, flags: ENTITY_FLAGS.underConstruction }),
  entity({ id: 20, owner: 0, kind: "ua-rifleman", x: 6, y: 5 }),
  entity({ id: 21, owner: 0, kind: "ua-supply-truck", x: 7, y: 5 }),
  entity({ id: 30, owner: 1, kind: "ru-rifleman", x: 40, y: 40 }),
];

const selected = [7, 20, 21];
const click = (x: number, y: number, ids: readonly number[] = selected) =>
  resolveRightClick({ player: 0, selected: ids, entities, x, y });

describe("right-click intents", () => {
  it("AC-03-49: resolves right-click intents", () => {
    expect(click(40, 40)).toEqual([
      { kind: "attack", player: 0, units: [20], target: 30 },
      { kind: "move", player: 0, units: [7, 21], xRaw: 40 * FX_ONE, yRaw: 40 * FX_ONE },
    ]);

    expect(click(13, 55)).toEqual([
      { kind: "harvest", player: 0, units: [21], depot: 0 },
      { kind: "move", player: 0, units: [7, 20], xRaw: 13 * FX_ONE, yRaw: 55 * FX_ONE },
    ]);

    expect(click(13.5, 66.5)).toEqual([
      { kind: "resume", player: 0, units: [7], building: 16 },
      { kind: "move", player: 0, units: [20, 21], xRaw: 13.5 * FX_ONE, yRaw: 66.5 * FX_ONE },
    ]);

    expect(click(30, 30)).toEqual([
      { kind: "move", player: 0, units: [7, 20, 21], xRaw: 30 * FX_ONE, yRaw: 30 * FX_ONE },
    ]);
  });

  it("AC-03-49: rallies a selected production building and ignores a plant", () => {
    const barracks = entity({ id: 40, owner: 0, kind: "ua-barracks", x: 20, y: 20 });
    const powerPlant = entity({ id: 41, owner: 0, kind: "ua-power-plant", x: 40, y: 40 });
    expect(
      resolveRightClick({ player: 0, selected: [40], entities: [...entities, barracks], x: 30, y: 30 }),
    ).toEqual([
      { kind: "rally", player: 0, building: 40, xRaw: 30 * FX_ONE, yRaw: 30 * FX_ONE },
    ]);
    expect(
      resolveRightClick({ player: 0, selected: [41], entities: [...entities, powerPlant], x: 30, y: 30 }),
    ).toEqual([]);
  });

  it("AC-03-49: drops unowned ids, ignores ghosts and needs a selection", () => {
    expect(click(30, 30, [7, 30])).toEqual([
      { kind: "move", player: 0, units: [7], xRaw: 30 * FX_ONE, yRaw: 30 * FX_ONE },
    ]);
    expect(click(30, 30, [99])).toEqual([]);
    expect(click(30, 30, [])).toEqual([]);

    const ghost = entity({ id: 31, owner: 1, kind: "ru-barracks", x: 31, y: 30, flags: ENTITY_FLAGS.ghost });
    expect(
      resolveRightClick({
        player: 0,
        selected: [7],
        entities: [...entities, ghost],
        x: 31,
        y: 30,
      }),
    ).toEqual([
      { kind: "move", player: 0, units: [7], xRaw: 31 * FX_ONE, yRaw: 30 * FX_ONE },
    ]);
  });

  it("AC-03-49: keeps a single non-doer unit moving to an incomplete own building", () => {
    expect(click(13.5, 66.5, [20])).toEqual([
      { kind: "move", player: 0, units: [20], xRaw: 13.5 * FX_ONE, yRaw: 66.5 * FX_ONE },
    ]);
  });
});
