import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { FX_ONE } from "../sim/fixed";
import type { EntityState } from "../sim/matchSnapshot";
import { resolveModeOrder } from "./intent";

const entity = (
  id: number,
  owner: number,
  kind: string,
  x: number,
): EntityState => ({
  id,
  owner,
  kind: typeIndex(kind),
  x,
  y: 5,
  hp: 100,
  flags: 0,
  progress: 0,
  target: null,
  heading: 0,
  turretAngle: 0,
});

const entities: EntityState[] = [
  entity(7, 0, "ua-dozer", 5),
  entity(16, 0, "ua-barracks", 13),
  entity(20, 0, "ua-rifleman", 6),
  entity(30, 1, "ru-rifleman", 40),
];

describe("resolveModeOrder (AC-49-07)", () => {
  it("gives every selected own unit the armed order at the point", () => {
    for (const mode of ["attackMove", "guard"] as const) {
      expect(
        resolveModeOrder({
          mode,
          player: 0,
          selected: [7, 16, 20, 30],
          entities,
          x: 10,
          y: 12,
        }),
      ).toEqual([
        {
          kind: mode,
          player: 0,
          units: [7, 20],
          xRaw: 10 * FX_ONE,
          yRaw: 12 * FX_ONE,
        },
      ]);
    }
  });

  it("gives nothing without own units", () => {
    expect(
      resolveModeOrder({
        mode: "guard",
        player: 0,
        selected: [30],
        entities,
        x: 1,
        y: 1,
      }),
    ).toEqual([]);
  });
});
