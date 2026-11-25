import { describe, expect, it } from "vitest";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import { createHordeRings } from "./hordeRings";

function unit(id: number, flags: number): EntityState {
  return { id, x: id, y: 1, flags } as unknown as EntityState;
}

describe("horde rings", () => {
  it("draws a ring only under units in a horde", () => {
    const rings = createHordeRings();
    rings.update(
      [unit(1, ENTITY_FLAGS.horde), unit(2, 0), unit(3, ENTITY_FLAGS.horde)],
      () => 0,
    );
    expect(rings.count()).toBe(2);
  });
});
