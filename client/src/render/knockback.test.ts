import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import type { EntityState, MatchSnapshot } from "../sim/matchSnapshot";
import { TICK_MS } from "../sim/protocol";
import { createKnockback, KNOCK_MS } from "./knockback";

function unit(
  id: number,
  owner: number,
  type: string,
  x: number,
  y: number,
): EntityState {
  return {
    id,
    owner,
    kind: typeIndex(type),
    x,
    y,
    hp: 100,
    flags: 0,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
  };
}

function snap(tick: number, entities: EntityState[]): MatchSnapshot {
  return { tick, entities } as unknown as MatchSnapshot;
}

describe("knockback (spec 28 §5a, AC-28-13)", () => {
  const truck = unit(2, 0, "ua-supply-truck", 5, 5);
  const before = snap(1, [truck, unit(1, 1, "ru-rifleman", 5.2, 5)]);
  const after = snap(2, [truck, unit(1, 1, "ru-rifleman", 5.2, 5.6)]);

  it("eases a thrown soldier across the slide instead of snapping", () => {
    const knock = createKnockback();
    knock.record(before, after, 1000);
    const at = (ms: number) => {
      // What interpolateEntities draws at that moment.
      const lerped = Math.min(1, ms / TICK_MS);
      const drawn = [
        { ...after.entities[1], y: 5 + 0.6 * lerped },
      ] as EntityState[];
      knock.apply(drawn, 1000 + ms);
      return drawn[0]?.y ?? 0;
    };
    expect(at(0)).toBeCloseTo(5, 5);
    expect(at(TICK_MS)).toBeLessThan(5.6 - 0.05);
    expect(at(KNOCK_MS / 2)).toBeGreaterThan(at(TICK_MS));
    expect(at(KNOCK_MS)).toBeCloseTo(5.6, 5);
  });

  it("ignores a soldier that jumps with no wheeled vehicle at him", () => {
    const knock = createKnockback();
    knock.record(
      snap(1, [unit(1, 1, "ru-rifleman", 5.2, 5)]),
      snap(2, [unit(1, 1, "ru-rifleman", 5.2, 5.6)]),
      1000,
    );
    const drawn = [{ ...after.entities[1] }] as EntityState[];
    knock.apply(drawn, 1010);
    expect(drawn[0]?.y).toBe(5.6);
  });
});
