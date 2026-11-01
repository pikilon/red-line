import { Color, Matrix4, Quaternion } from "three";
import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import { createAirOverlay, PIP_EMPTY, PIP_FULL, pipColors } from "./airOverlay";

function unit(id: number, owner: number, type: string, flags = 0): EntityState {
  return {
    id,
    owner,
    kind: typeIndex(type),
    x: 10 + id,
    y: 10,
    hp: 100,
    flags,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
  };
}

const facing = new Quaternion();
const none = (): number => 0;

describe("air overlays (spec 43)", () => {
  it("fills the ammo pips of a clip from the left", () => {
    expect(pipColors(1, 2)).toEqual([PIP_FULL, PIP_EMPTY]);
    expect(pipColors(0, 4)).toEqual([
      PIP_EMPTY,
      PIP_EMPTY,
      PIP_EMPTY,
      PIP_EMPTY,
    ]);
    expect(pipColors(9, 2)).toEqual([PIP_FULL, PIP_FULL]);
    expect(pipColors(3, 0)).toEqual([]);
  });

  it("draws the jam radius of a selected jammer only", () => {
    const overlay = createAirOverlay();
    const jammer = unit(1, 1, "ru-pole-21");
    overlay.update([jammer], new Set(), [], none, 0, facing, 0);
    expect(overlay.counts().rings).toBe(0);
    expect(overlay.rings.visible).toBe(false);
    overlay.update([jammer], new Set([1]), [], none, 0, facing, 0);
    expect(overlay.counts().rings).toBe(1);
    // The unit circle scaled to the 9-tile radius of the ruleset.
    const matrix = new Matrix4();
    overlay.rings.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).toBeCloseTo(9, 6);
    const color = new Color();
    overlay.rings.getColorAt(0, color);
    expect(color.getHex()).toBeGreaterThan(0);
  });

  it("shows pips only for a selected own unit with a clip", () => {
    const overlay = createAirOverlay();
    const jet = unit(2, 0, "ru-su-34", ENTITY_FLAGS.airborne);
    const noClip = unit(3, 0, "ru-geran-2", ENTITY_FLAGS.airborne);
    const air = [
      { id: 2, ammo: 1, clip: 2, fuelPermille: 1000, master: null },
      { id: 3, ammo: 0, clip: 0, fuelPermille: 800, master: null },
    ];
    overlay.update(
      [jet, noClip],
      new Set([2, 3]),
      air,
      () => 3.7,
      0,
      facing,
      0,
    );
    expect(overlay.counts().pips).toBe(2);
    // Not selected: no pips. Enemy: none either.
    overlay.update([jet], new Set(), air, none, 0, facing, 0);
    expect(overlay.counts().pips).toBe(0);
    overlay.update([jet], new Set([2]), air, none, 0, facing, 1);
    expect(overlay.counts().pips).toBe(0);
    expect(overlay.pips.visible).toBe(false);
  });

  it("marks every jammed unit, own or enemy, selected or not", () => {
    const overlay = createAirOverlay();
    const entities = [
      unit(4, 0, "ua-ratel", ENTITY_FLAGS.jammed),
      unit(5, 1, "ua-fpv", ENTITY_FLAGS.jammed | ENTITY_FLAGS.airborne),
      unit(6, 0, "ua-tw-12-7"),
    ];
    overlay.update(entities, new Set(), [], none, 0, facing, 0);
    expect(overlay.counts().jams).toBe(2);
    expect(overlay.jams.count).toBe(2);
  });
});
