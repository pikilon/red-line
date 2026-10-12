import { describe, expect, it } from "vitest";
import type { EntityState } from "../sim/matchSnapshot";
import { createCameraMemory, homeView } from "./cameraMemory";

const HQ = 1;
const BARRACKS = 2;
const RIFLEMAN = 3;
const isBuilding = (kind: number): boolean => kind === HQ || kind === BARRACKS;

function entity(
  id: number,
  owner: number,
  kind: number,
  x: number,
  y: number,
): EntityState {
  return {
    id,
    owner,
    kind,
    x,
    y,
    hp: 100,
    flags: 0,
    progress: 0,
    target: null,
  };
}

describe("cameraMemory", () => {
  it("AC-08-05: camera memory", () => {
    const memory = createCameraMemory();
    expect(memory.switchPlayer(0, 1, { x: 10, y: 20 })).toBeNull();
    expect(memory.switchPlayer(1, 0, { x: 70, y: 80 })).toEqual({
      x: 10,
      y: 20,
    });
    expect(memory.switchPlayer(0, 1, { x: 5, y: 5 })).toEqual({
      x: 70,
      y: 80,
    });

    const entities = [
      entity(1, 1, HQ, 90, 90),
      entity(2, 0, RIFLEMAN, 4, 4),
      entity(3, 0, BARRACKS, 12, 14),
      entity(4, 0, HQ, 20, 22),
    ];
    expect(homeView(entities, 0, HQ, isBuilding)).toEqual({ x: 20, y: 22 });
    expect(
      homeView(
        entities.filter((e) => e.id !== 4),
        0,
        HQ,
        isBuilding,
      ),
    ).toEqual({ x: 12, y: 14 });
    expect(
      homeView([entity(2, 0, RIFLEMAN, 4, 4)], 0, HQ, isBuilding),
    ).toBeNull();
  });
});
