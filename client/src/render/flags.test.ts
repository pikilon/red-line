import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { typeDef, typeIndex } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
} from "../sim/matchSnapshot";
import {
  createFlagRenderer,
  FLAG_AMPLITUDE,
  FLAGS,
  flagOf,
  flagSample,
  flagWave,
  POLE_INSET,
  RU_BLUE,
  RU_RED,
} from "./flags";
import { RU_WHITE, UA_BLUE, UA_YELLOW } from "./liveries";

function hq(id: number, type: string, flags = 0): EntityState {
  return {
    id,
    owner: 0,
    kind: typeIndex(type),
    x: 10 + id * 10,
    y: 6,
    hp: 100,
    flags,
    progress: 500,
    target: null,
  };
}

describe("HQ flags", () => {
  it("AC-16-04: flag of each HQ and its stripes", () => {
    expect(flagOf(typeIndex("ua-hq"))).toEqual(FLAGS.ukraine);
    expect(flagOf(typeIndex("ru-hq"))).toEqual(FLAGS.russia);
    expect(flagOf(typeIndex("ru-barracks"))).toBeNull();

    expect(flagSample(FLAGS.ukraine, 0.9)).toBe(UA_BLUE);
    expect(flagSample(FLAGS.ukraine, 0.1)).toBe(UA_YELLOW);
    expect(flagSample(FLAGS.russia, 0.9)).toBe(RU_WHITE);
    expect(flagSample(FLAGS.russia, 0.5)).toBe(RU_BLUE);
    expect(flagSample(FLAGS.russia, 0.1)).toBe(RU_RED);
  });

  it("AC-16-05: the cloth is still at the pole and bounded", () => {
    for (const t of [0, 0.3, 1.7, 12.5]) {
      expect(flagWave(0, t, 3)).toBe(0);
      for (const s of [0.25, 0.5, 1]) {
        expect(Math.abs(flagWave(s, t, 3))).toBeLessThanOrEqual(
          FLAG_AMPLITUDE,
        );
      }
    }
  });

  it("AC-16-06: complete HQs fly their flag at the front-left corner", () => {
    const renderer = createFlagRenderer(8);
    const ua = hq(0, "ua-hq");
    const ru = hq(1, "ru-hq", ENTITY_FLAGS.underConstruction);
    const ghost = hq(2, "ua-hq", ENTITY_FLAGS.ghost);
    const barracks = hq(3, "ua-barracks");
    renderer.update([ua, ru, ghost, barracks], 0);
    expect(renderer.poles.count).toBe(1);
    expect(renderer.cloths.ukraine?.count).toBe(1);
    expect(renderer.cloths.russia?.count).toBe(0);

    const [w, , d] = typeDef(ua.kind).render.size.map((size) => size / 100) as [
      number,
      number,
      number,
    ];
    const matrix = new Matrix4();
    renderer.poles.getMatrixAt(0, matrix);
    const position = new Vector3().setFromMatrixPosition(matrix);
    expect(position.x).toBeCloseTo(ua.x - w / 2 + POLE_INSET, 5);
    expect(position.z).toBeCloseTo(ua.y + d / 2 - POLE_INSET, 5);

    renderer.update([ua, { ...ru, flags: 0 }, ghost, barracks], 100);
    expect(renderer.poles.count).toBe(2);
    expect(renderer.cloths.ukraine?.count).toBe(1);
    expect(renderer.cloths.russia?.count).toBe(1);
  });
});
