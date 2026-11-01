import { describe, expect, it } from "vitest";
import { RULES, typeDef, typeIndex } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  type MatchSnapshot,
} from "../sim/matchSnapshot";
import { createEffects } from "./effects";
import {
  AIR_CLEARANCE,
  airInfo,
  approachAltitude,
  bankFor,
  createFlyers,
  type DeathEvent,
  fallPose,
  isAirDeath,
  isSelfDestruct,
  leavesTrail,
  spawnFlyerTrails,
  targetAltitude,
} from "./flyers";

function flyer(
  id: number,
  type: string,
  extra: Partial<EntityState> = {},
): EntityState {
  return {
    id,
    owner: 0,
    kind: typeIndex(type),
    x: 10,
    y: 10,
    hp: 100,
    flags: ENTITY_FLAGS.airborne | ENTITY_FLAGS.moving,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
    ...extra,
  };
}

function snapshot(entities: EntityState[]): MatchSnapshot {
  return {
    tick: 1,
    viewer: 0,
    credits: 0,
    powerProduced: 0,
    powerConsumed: 0,
    outcome: "ongoing",
    winner: null,
    entities,
    queues: [],
    rallies: [],
  };
}

const death = (victim: EntityState, killer: number | null): DeathEvent => ({
  kind: "death",
  victim: victim.id,
  victimKind: victim.kind,
  killer,
  weapon: null,
  x: victim.x,
  y: victim.y,
});

describe("flyers (spec 43)", () => {
  it("reads the cruise height of the air locomotors, lifted to clear buildings", () => {
    const jet = airInfo(typeDef(typeIndex("ru-su-34")));
    const drone = airInfo(typeDef(typeIndex("ua-fpv")));
    expect(jet).toEqual({ altitude: 3.2 + AIR_CLEARANCE, airClass: "high" });
    expect(drone).toEqual({ altitude: 1.4 + AIR_CLEARANCE, airClass: "low" });
    expect(airInfo(typeDef(typeIndex("ru-t-72b3")))).toBeNull();
    // Higher than the tallest building, so a flyer is never hidden behind one.
    const tallest = Math.max(
      ...RULES.types
        .filter((type) => type.category === "building")
        .map((type) => type.render.size[1] / 100),
    );
    expect(drone?.altitude).toBeGreaterThan(tallest);
  });

  it("holds a parked aircraft on the ground and an airborne one at cruise", () => {
    const parked = flyer(1, "ru-su-34", { flags: 0 });
    const flying = flyer(2, "ru-su-34");
    expect(targetAltitude(parked)).toBe(0);
    expect(targetAltitude(flying)).toBeCloseTo(3.7, 9);
  });

  it("approaches an altitude smoothly and always arrives", () => {
    let altitude = 0;
    const history: number[] = [];
    for (let i = 0; i < 400; i++) {
      altitude = approachAltitude(altitude, 3.7, 1 / 60);
      history.push(altitude);
    }
    expect(history[0]).toBeGreaterThan(0);
    expect(history[0]).toBeLessThan(0.2);
    expect(
      history.every((value, i) => i === 0 || value >= (history[i - 1] ?? 0)),
    ).toBe(true);
    expect(altitude).toBe(3.7);
    // And back down.
    expect(approachAltitude(3.7, 0, 10)).toBe(0);
  });

  it("banks into a turn and levels out when flying straight", () => {
    expect(bankFor(0)).toBeCloseTo(0, 9);
    // A left turn (positive yaw rate) rolls negative about the nose.
    expect(bankFor(2)).toBeLessThan(0);
    expect(bankFor(-2)).toBeGreaterThan(0);
    expect(bankFor(100)).toBeCloseTo(-0.55, 9);
  });

  it("climbs a launched unit from the ground, but starts a flyer already seen up there", () => {
    const flyers = createFlyers();
    const jet = flyer(5, "ru-su-34");
    flyers.update([jet], 0);
    // Present from the first snapshot: already at height.
    expect(flyers.pose(5).altitude).toBeCloseTo(3.7, 9);
    // A new, higher id appears later: launched, so it starts on the ground.
    const drone = flyer(9, "ua-fpv");
    flyers.update([jet, drone], 16);
    expect(flyers.pose(9).altitude).toBeLessThan(0.2);
    for (let t = 32; t < 1500; t += 16) flyers.update([jet, drone], t);
    expect(flyers.pose(9).altitude).toBeCloseTo(1.9, 9);
    // An old id coming back into sight does not climb out of the ground.
    flyers.update([jet], 1520);
    const back = flyer(3, "ua-fpv");
    flyers.update([jet, back], 1536);
    expect(flyers.pose(3).altitude).toBeCloseTo(1.9, 9);
  });

  it("leans into a turn and spins its rotors only while airborne", () => {
    const flyers = createFlyers();
    const quad = flyer(1, "ua-baba-yaga");
    flyers.update([quad], 0);
    let heading = 0;
    for (let t = 16; t <= 400; t += 16) {
      heading += 600; // about 3.3 degrees a frame
      flyers.update([{ ...quad, heading }], t);
    }
    expect(flyers.pose(1).roll).toBeLessThan(-0.1);
    expect(flyers.pose(1).spin).toBeGreaterThan(0.2);
    const spun = flyers.pose(1).spin;
    // Parked: it settles, the rotors wind down and stop.
    const parked = { ...quad, heading, flags: 0 };
    for (let t = 416; t < 8000; t += 16) flyers.update([parked], t);
    expect(flyers.pose(1).altitude).toBe(0);
    expect(flyers.pose(1).spin - spun).toBeLessThan(2);
    const settled = flyers.pose(1).spin;
    flyers.update([parked], 8100);
    expect(flyers.pose(1).spin).toBeCloseTo(settled, 2);
  });

  it("forgets a flyer that left the snapshot", () => {
    const flyers = createFlyers();
    flyers.update([flyer(1, "ru-su-34")], 0);
    flyers.update([], 16);
    expect(flyers.pose(1).altitude).toBe(0);
  });

  it("sorts deaths: shot down, self-destructed, and a parked aircraft", () => {
    const jet = flyer(1, "ru-su-34");
    const parked = flyer(2, "ru-su-34", { flags: 0 });
    const tank = flyer(3, "ru-t-72b3", { flags: 0 });
    const before = snapshot([jet, parked, tank]);
    expect(isAirDeath(death(jet, null), before)).toBe(true);
    expect(isAirDeath(death(parked, null), before)).toBe(false);
    expect(isAirDeath(death(tank, null), before)).toBe(false);
    expect(isSelfDestruct(death(jet, jet.id))).toBe(true);
    expect(isSelfDestruct(death(jet, null))).toBe(false);
  });

  it("makes a shot-down flyer fall and crash with a puff and, when big, a fireball", () => {
    const effects = createEffects();
    const flyers = createFlyers();
    const jet = flyer(1, "ru-su-34", { heading: 16384 });
    flyers.update([jet], 0);
    flyers.kill([death(jet, null)], snapshot([jet]), 1000, effects);
    const [start] = flyers.falling(1000);
    expect(start?.altitude).toBeCloseTo(3.7, 6);
    const [mid] = flyers.falling(1500);
    expect(mid?.altitude).toBeLessThan(start?.altitude ?? 0);
    expect(mid?.pitch).toBeGreaterThan(0);
    // The crash is scheduled ahead of time: nothing yet, then the puff.
    effects.update(1000);
    expect(effects.counts().explosion).toBe(0);
    effects.update(2500);
    expect(effects.counts().explosion).toBe(1);
    expect(effects.counts().dust).toBe(6);
    expect(flyers.falling(5000)).toEqual([]);
  });

  it("a small drone crashes with a puff, not a fireball", () => {
    const effects = createEffects();
    const flyers = createFlyers();
    const drone = flyer(1, "ua-fpv");
    flyers.update([drone], 0);
    flyers.kill([death(drone, null)], snapshot([drone]), 0, effects);
    effects.update(2000);
    expect(effects.counts().explosion).toBe(0);
    expect(effects.counts().impact + effects.counts().dust).toBeGreaterThan(0);
  });

  it("starts no fall for a detonation or a parked aircraft", () => {
    const effects = createEffects();
    const flyers = createFlyers();
    const missile = flyer(1, "ua-flamingo");
    const parked = flyer(2, "ru-su-34", { flags: 0 });
    const before = snapshot([missile, parked]);
    flyers.update(before.entities, 0);
    flyers.kill(
      [death(missile, missile.id), death(parked, null)],
      before,
      0,
      effects,
    );
    expect(flyers.falling(10)).toEqual([]);
  });

  it("leaves a smoke trail from missiles and jet drones only", () => {
    expect(leavesTrail(typeDef(typeIndex("ua-flamingo")))).toBe(true);
    expect(leavesTrail(typeDef(typeIndex("ua-storm-shadow")))).toBe(true);
    expect(leavesTrail(typeDef(typeIndex("ru-geran-3")))).toBe(true);
    expect(leavesTrail(typeDef(typeIndex("ru-geran-2")))).toBe(false);
    expect(leavesTrail(typeDef(typeIndex("ru-su-34")))).toBe(false);
    expect(leavesTrail(typeDef(typeIndex("ua-fpv")))).toBe(false);

    const effects = createEffects();
    const flyers = createFlyers();
    const missile = flyer(1, "ua-flamingo");
    const prop = flyer(2, "ru-geran-2");
    const view = snapshot([missile, prop]);
    flyers.update(view.entities, 0);
    const last = new Map<number, number>();
    spawnFlyerTrails(view, flyers, effects, 100, last);
    effects.update(100);
    expect(effects.counts().trail).toBe(1);
    // Not again until the interval has passed.
    spawnFlyerTrails(view, flyers, effects, 110, last);
    effects.update(110);
    expect(effects.counts().trail).toBe(1);
    spawnFlyerTrails(view, flyers, effects, 400, last);
    effects.update(400);
    expect(effects.counts().trail).toBe(2);
  });

  it("tumbles a falling flyer faster as it drops", () => {
    const flyers = createFlyers();
    const jet = flyer(2, "ru-su-34");
    flyers.update([jet], 0);
    flyers.kill([death(jet, null)], snapshot([jet]), 0, createEffects());
    const [a] = flyers.falling(100);
    const [b] = flyers.falling(600);
    expect(Math.abs(b?.roll ?? 0)).toBeGreaterThan(Math.abs(a?.roll ?? 0));
    expect(fallPose).toBeTypeOf("function");
  });
});
