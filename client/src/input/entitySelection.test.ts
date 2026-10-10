import { describe, expect, it } from "vitest";
import { type EntityState, ENTITY_FLAGS } from "../sim/matchSnapshot";
import { typeIndex } from "../rules";
import {
  boxSelect,
  clickSelect,
  pickEntity,
  selectAllOwnUnits,
} from "./entitySelection";

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

// AC-03-48: own `ua-rifleman` 2 at (1, 1), enemy `ru-rifleman` 3 at (1.3, 1),
// own `ua-power-plant` 5 at (10.5, 10.5), depot 0 at (20, 20).
const entities: EntityState[] = [
  entity({ id: 0, owner: 255, kind: "supply-depot", x: 20, y: 20 }),
  entity({ id: 2, owner: 0, kind: "ua-rifleman", x: 1, y: 1 }),
  entity({ id: 3, owner: 1, kind: "ru-rifleman", x: 1.3, y: 1 }),
  entity({ id: 5, owner: 0, kind: "ua-power-plant", x: 10.5, y: 10.5 }),
];

describe("entity selection", () => {
  it("AC-03-48: picks entities and selects own units", () => {
    expect(pickEntity(entities, 1.1, 1)).toBe(2);
    expect(pickEntity(entities, 1.25, 1)).toBe(3);
    expect(pickEntity(entities, 9.2, 9.2)).toBe(5);
    expect(pickEntity(entities, 20.9, 20.9)).toBe(0);
    expect(pickEntity(entities, 5, 5)).toBeNull();

    expect(clickSelect(entities, 1.1, 1, 0)).toEqual([2]);
    expect(clickSelect(entities, 1.25, 1, 0)).toEqual([]);
    expect(clickSelect(entities, 10, 10, 0)).toEqual([5]);

    const project = (x: number, y: number) => ({ x, y });
    expect(
      boxSelect(
        entities,
        { minX: 0, minY: 0, maxX: 30, maxY: 30 },
        project,
        0,
      ),
    ).toEqual([2]);
    expect(boxSelect(entities, { minX: 0, minY: 0, maxX: 0.5, maxY: 0.5 }, project, 0)).toEqual([]);
    expect(selectAllOwnUnits(entities, 0)).toEqual([2]);
  });

  it("AC-03-48: ignores ghosts and neutral or enemy entities when selecting", () => {
    const withGhost = [
      ...entities,
      entity({ id: 7, owner: 0, kind: "ua-barracks", x: 10, y: 10, flags: ENTITY_FLAGS.ghost }),
    ];
    expect(pickEntity(entities, 1.3, 1)).toBe(3);
    expect(clickSelect(entities, 20.9, 20.9, 0)).toEqual([]);
    expect(clickSelect(entities, 1.1, 1, 1)).toEqual([]);
    expect(clickSelect(withGhost, 10, 10, 0)).toEqual([5]);
  });

  it("AC-03-48: picks buildings by footprint and keeps box selection inclusive", () => {
    const project = (x: number, y: number) => ({ x: x * 10, y: y * 10 });
    expect(boxSelect(entities, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, project, 0)).toEqual([2]);
    expect(selectAllOwnUnits(entities, 1)).toEqual([3]);
    expect(selectAllOwnUnits([], 0)).toEqual([]);
  });
});
