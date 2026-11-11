import { Quaternion } from "three";
import { describe, expect, it } from "vitest";
import { RULES } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import { RANK_SHIFT } from "../sim/veterancy";
import {
  createRankMarkers,
  PROMOTION_FLASH_MS,
  promotionScale,
} from "./rankMarkers";

const kind = RULES.types.findIndex((type) => type.id === "ua-leopard-2a4");

function unit(id: number, rank: number): EntityState {
  return {
    id,
    owner: 0,
    kind,
    x: 5 + id,
    y: 5,
    hp: 100,
    flags: rank << RANK_SHIFT,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
  };
}

describe("rank markers (spec 50 §4)", () => {
  it("draws one marker per promoted unit, by rank", () => {
    const markers = createRankMarkers();
    markers.update(
      [unit(1, 0), unit(2, 1), unit(3, 3), unit(4, 3)],
      () => 0,
      0,
      new Quaternion(),
    );
    expect(markers.counts()).toEqual([1, 0, 2]);
  });

  it("flashes a unit that is promoted while on show, not one loaded with rank", () => {
    const markers = createRankMarkers();
    const facing = new Quaternion();
    markers.update([unit(1, 0), unit(2, 2)], () => 0, 0, facing);
    expect(markers.flashing(0)).toBe(0);
    markers.update([unit(1, 1), unit(2, 2)], () => 0, 100, facing);
    expect(markers.flashing(100)).toBe(1);
    expect(markers.flashing(100 + PROMOTION_FLASH_MS)).toBe(0);
  });

  it("pulses only during the flash", () => {
    expect(promotionScale(0)).toBeGreaterThan(1);
    expect(promotionScale(PROMOTION_FLASH_MS)).toBe(1);
    expect(promotionScale(-1)).toBe(1);
  });
});
