import { describe, expect, it } from "vitest";

import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import {
  narrowToKind,
  sameTypeEverywhere,
  sameTypeOnScreen,
  selectedUnitKinds,
} from "./sameType";

const RIFLEMAN = 2;
const STUGNA_TEAM = 3;
const BARRACKS = 13;

function unit(id: number, kind: number, x: number, extra = {}): EntityState {
  return {
    id,
    owner: 0,
    kind,
    x,
    y: 0,
    hp: 1,
    flags: 0,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
    ...extra,
  };
}

const view = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const project = (x: number, y: number) => ({ x, y });

describe("same type selection (spec 41 AC-41-07)", () => {
  const entities = [
    unit(1, RIFLEMAN, 10),
    unit(2, RIFLEMAN, 50),
    unit(3, RIFLEMAN, 500),
    unit(4, STUGNA_TEAM, 20),
    unit(5, RIFLEMAN, 20, { owner: 1 }),
    unit(6, RIFLEMAN, 30, { flags: ENTITY_FLAGS.aboard }),
    unit(7, BARRACKS, 30),
  ];

  it("reads the selected unit kinds", () => {
    expect(selectedUnitKinds(entities, new Set([2, 4, 7]))).toEqual([
      RIFLEMAN,
      STUGNA_TEAM,
    ]);
  });

  it("selects only the visible own units of the type on screen", () => {
    expect(sameTypeOnScreen(entities, [RIFLEMAN], 0, view, project)).toEqual([
      1, 2,
    ]);
  });

  it("falls back to the map when none is on screen", () => {
    const far = { minX: 900, minY: 0, maxX: 1000, maxY: 100 };
    expect(sameTypeOnScreen(entities, [RIFLEMAN], 0, far, project)).toEqual([
      1, 2, 3,
    ]);
  });

  it("selects every own unit of the type everywhere", () => {
    expect(sameTypeEverywhere(entities, [RIFLEMAN], 0)).toEqual([1, 2, 3]);
    expect(sameTypeEverywhere(entities, [RIFLEMAN, STUGNA_TEAM], 0)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("narrows the selection to one kind", () => {
    expect(narrowToKind(entities, new Set([1, 2, 4]), RIFLEMAN)).toEqual([
      1, 2,
    ]);
  });
});
