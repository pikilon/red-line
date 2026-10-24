import { Quaternion } from "three";
import { describe, expect, it } from "vitest";
import { typeDef, typeIndex } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  type MatchSnapshot,
} from "../sim/matchSnapshot";
import type { DeathCauses } from "./deaths";
import {
  canTossTurret,
  damageState,
  deathVariant,
  detectRicochets,
  detectVehicleHits,
  HULK_LIFE_MS,
  HULK_SINK_DELAY_MS,
  type Hulk,
  hulkPose,
  hulkRates,
  kickOf,
  rockAt,
  unitHash,
  type VehicleDeath,
} from "./vehicleDeaths";
import { createVehicleFx } from "./vehicleFx";

const T72 = typeDef(typeIndex("ru-t-72b3"));
const LEOPARD = typeDef(typeIndex("ua-leopard-2a4"));
const TRUCK = typeDef(typeIndex("ru-supply-truck"));

function entity(id: number, kind: number, hp: number): EntityState {
  return {
    id,
    kind,
    owner: 1,
    x: 10,
    y: 10,
    hp,
    heading: 0,
    turretAngle: 0,
    flags: 0,
    target: null,
  } as unknown as EntityState;
}

function snapshot(tick: number, entities: EntityState[]): MatchSnapshot {
  return { tick, entities } as unknown as MatchSnapshot;
}

const causes = (kind: "shot" | "explosion"): DeathCauses => ({
  record() {},
  causeOf: () => ({ kind, push: 0 }),
});

function hulk(variant: VehicleDeath, id = 7): Hulk {
  return {
    id,
    kind: typeIndex("ru-t-72b3"),
    owner: 1,
    x: 10,
    y: 10,
    yaw: 0,
    turretYaw: 0,
    variant,
    push: 0,
    startMs: 0,
  };
}

const PIVOT = { x: 0, y: 0.35, z: 0 };

describe("vehicle deaths", () => {
  it("AC-27-01: the death variant is a weighted roll on the id hash", () => {
    expect(unitHash(5, 1)).toBe(unitHash(5, 1));
    expect(deathVariant(T72, 42)).toBe(deathVariant(T72, 42));
    expect(canTossTurret(T72)).toBe(true);
    expect(canTossTurret(TRUCK)).toBe(false);
    const tally = (type: typeof T72) => {
      const counts: Record<VehicleDeath, number> = {
        cookOff: 0,
        blast: 0,
        burnOut: 0,
      };
      for (let id = 1; id <= 2000; id++) counts[deathVariant(type, id)]++;
      return counts;
    };
    const ru = tally(T72);
    const ua = tally(LEOPARD);
    const truck = tally(TRUCK);
    // Every variant shows up; Russian turrets fly most often.
    expect(ru.cookOff).toBeGreaterThan(ru.blast);
    expect(ru.cookOff / 2000).toBeCloseTo(0.45, 1);
    expect(ua.cookOff / 2000).toBeCloseTo(0.2, 1);
    expect(ua.blast).toBeGreaterThan(0);
    expect(ua.burnOut).toBeGreaterThan(0);
    expect(truck.cookOff).toBe(0);
  });

  it("AC-27-02: damage states follow the hp share", () => {
    expect(damageState(850, 850)).toBe("pristine");
    expect(damageState(400, 850)).toBe("damaged");
    expect(damageState(200, 850)).toBe("burning");
  });

  it("AC-27-03: hits on vehicles are detected with their kind", () => {
    const kind = typeIndex("ru-t-72b3");
    const before = snapshot(1, [entity(1, kind, 850), entity(2, kind, 850)]);
    const after = snapshot(2, [entity(1, kind, 840), entity(2, kind, 850)]);
    const hits = detectVehicleHits(before, after, causes("shot"), 0);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("shot");
    expect(hits[0]?.loss).toBeCloseTo(10 / 850);
    // A rifle fired at a tank sparks even though it cannot hurt it.
    const rifleman = {
      ...entity(5, typeIndex("ua-rifleman"), 100),
      x: 5,
      flags: ENTITY_FLAGS.fired,
      target: 1,
    } as EntityState;
    const sparks = detectRicochets(
      snapshot(3, [rifleman, entity(1, kind, 850)]),
    );
    expect(sparks).toHaveLength(1);
    expect(sparks[0]?.push).toBeCloseTo(0);
    // Soldiers are left to spec 22.
    const man = typeIndex("ua-rifleman");
    expect(
      detectVehicleHits(
        snapshot(1, [entity(3, man, 100)]),
        snapshot(2, [entity(3, man, 50)]),
        causes("shot"),
        0,
      ),
    ).toHaveLength(0);
  });

  it("AC-27-04: a hit rocks the hull away from it and settles", () => {
    const shell = kickOf(
      { id: 1, x: 0, y: 0, kind: "explosion", push: 0, loss: 0.1 },
      0,
    );
    const bullet = kickOf(
      { id: 1, x: 0, y: 0, kind: "shot", push: 0, loss: 0.01 },
      0,
    );
    expect(shell.amplitude).toBeGreaterThan(bullet.amplitude * 3);
    // Yaw π/2: the hull faces +x, the push is along it: nose down first.
    const peak = rockAt([shell], Math.PI / 2, 110);
    expect(peak.pitch).toBeGreaterThan(0.03);
    expect(Math.abs(peak.roll)).toBeLessThan(1e-6);
    // Pushed from the side it rolls instead.
    const side = rockAt([shell], 0, 110);
    expect(Math.abs(side.roll)).toBeGreaterThan(0.03);
    expect(Math.abs(rockAt([shell], 0, 1300).roll)).toBe(0);
  });

  it("AC-27-05: a cook-off throws the turret up and lands it away", () => {
    const h = hulk("cookOff");
    expect(hulkPose(h, 100, PIVOT, 0.55).turret).toBeNull();
    const air = hulkPose(h, 700, PIVOT, 0.55).turret;
    expect(air).not.toBeNull();
    expect(air?.z ?? 0).toBeGreaterThan(0.8);
    const down = hulkPose(h, 5000, PIVOT, 0.55).turret;
    expect(down?.z ?? 1).toBeLessThan(0.2);
    const distance = Math.hypot((down?.x ?? 10) - 10, (down?.y ?? 10) - 10);
    expect(distance).toBeGreaterThan(0.6);
    expect(distance).toBeLessThan(3);
    expect(hulkPose(h, 5000, PIVOT, 0.55).char).toBe(1);
  });

  it("AC-27-06: a blast lifts the hull; a burn-out chars before it blows", () => {
    expect(hulkPose(hulk("blast"), 150, PIVOT, 0.55).lift).toBeGreaterThan(
      0.05,
    );
    expect(hulkPose(hulk("blast"), 3000, PIVOT, 0.55).lift).toBe(0);
    const burn = hulk("burnOut");
    expect(hulkPose(burn, 500, PIVOT, 0.55).char).toBeLessThan(0.5);
    expect(hulkPose(burn, 1500, PIVOT, 0.55).lift).toBe(0);
    expect(hulkPose(burn, 2150, PIVOT, 0.55).lift).toBeGreaterThan(0);
    expect(hulkRates("burnOut", 1.9).fire).toBeGreaterThan(
      hulkRates("burnOut", 0.1).fire,
    );
    expect(hulkRates("cookOff", 0.5).jet).toBeGreaterThan(0);
    expect(hulkRates("blast", 0.5).jet).toBe(0);
  });

  it("AC-27-07: hulks burn, smoke, then sink and go", () => {
    for (const variant of ["cookOff", "blast", "burnOut"] as const) {
      expect(hulkRates(variant, 1).fire).toBeGreaterThan(0);
      expect(hulkRates(variant, 14).fire).toBe(0);
      expect(hulkRates(variant, 10).smoke).toBeGreaterThan(0);
      expect(hulkRates(variant, 19).smoke).toBe(0);
    }
    const h = hulk("blast");
    expect(hulkPose(h, HULK_SINK_DELAY_MS - 100, PIVOT, 0.55).lift).toBe(0);
    expect(hulkPose(h, HULK_LIFE_MS - 10, PIVOT, 0.55).lift).toBeLessThan(-0.5);
  });

  it("AC-27-08: the renderer keeps a hulk for its life and emits fire", () => {
    const fx = createVehicleFx();
    const kind = typeIndex("ru-t-72b3");
    const camera = new Quaternion();
    fx.kill([entity(9, kind, 10)], causes("explosion"), 0);
    fx.update([], 0, camera);
    for (let ms = 100; ms <= 1000; ms += 50) fx.update([], ms, camera);
    expect(fx.hulks(1000)).toHaveLength(1);
    expect(fx.counts().fire).toBeGreaterThan(0);
    expect(fx.counts().smoke).toBeGreaterThan(0);
    expect(fx.hulks(HULK_LIFE_MS + 1)).toHaveLength(0);
    // A damaged living tank smokes; a pristine one does not.
    const smoky = createVehicleFx();
    smoky.update([entity(1, kind, 850)], 0, camera);
    smoky.update([entity(1, kind, 850)], 500, camera);
    expect(smoky.counts().smoke).toBe(0);
    for (let ms = 550; ms <= 1000; ms += 50) {
      smoky.update([entity(1, kind, 300)], ms, camera);
    }
    expect(smoky.counts().smoke).toBeGreaterThan(0);
    // A bullet makes sparks on the armour and rocks the hull a little.
    smoky.ricochet([{ id: 1, x: 10, y: 10, kind: "shot", push: 0, loss: 0 }]);
    smoky.hit(
      [{ id: 1, x: 10, y: 10, kind: "shot", push: 0, loss: 0.01 }],
      1100,
    );
    smoky.update([entity(1, kind, 300)], 1160, camera);
    smoky.update([entity(1, kind, 300)], 1210, camera);
    expect(smoky.counts().spark).toBeGreaterThan(0);
    expect(smoky.rock(1, 0, 1200).roll).not.toBe(0);
  });
});
