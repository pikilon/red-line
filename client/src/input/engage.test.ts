import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import { canAttackGround, canEngage, isArmed, weaponOf } from "./engage";
import { resolveClickOrder, resolveForceFire } from "./intent";

let next = 1;
function unit(
  type: string,
  owner: number,
  extra: Partial<EntityState> = {},
): EntityState {
  return {
    id: next++,
    owner,
    kind: typeIndex(type),
    x: 10,
    y: 10,
    hp: 100,
    flags: 0,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
    ...extra,
  };
}

const AIRBORNE = ENTITY_FLAGS.airborne;

describe("who can hit what by height (spec 43 §4.1)", () => {
  const rifle = unit("ua-rifleman", 0);
  const gepard = unit("ua-gepard", 0);
  const patriot = unit("ua-patriot", 0);
  const tank = unit("ua-leopard-2a4", 0);
  const flamingo = unit("ua-flamingo", 0);
  const orlan = unit("ru-orlan", 1);
  const sting = unit("ua-sting", 0);
  const jet = unit("ru-su-34", 1, { flags: AIRBORNE, x: 30, y: 30 });
  const drone = unit("ru-geran-2", 1, { flags: AIRBORNE });
  const parkedJet = unit("ru-su-34", 1);
  const flyingOrlan = unit("ru-orlan", 1, { flags: AIRBORNE });
  const enemyTank = unit("ru-t-72b3", 1);

  it("counts a one-way unit as armed and an unarmed flyer as not", () => {
    expect(isArmed(flamingo)).toBe(true);
    expect(isArmed(rifle)).toBe(true);
    expect(isArmed(orlan)).toBe(false);
    expect(weaponOf(flamingo)?.id).toBe("ua-flamingo-warhead");
    expect(weaponOf(orlan)).toBeNull();
  });

  it("lets small arms reach a low flyer but not a high one", () => {
    expect(canEngage(rifle, drone)).toBe(true);
    expect(canEngage(rifle, flyingOrlan)).toBe(true);
    expect(canEngage(rifle, jet)).toBe(false);
  });

  it("offers a high flyer only to anti-air that reaches it", () => {
    expect(canEngage(gepard, jet)).toBe(true);
    expect(canEngage(patriot, jet)).toBe(true);
    expect(canEngage(sting, jet)).toBe(false);
    expect(canEngage(sting, drone)).toBe(true);
    expect(canEngage(tank, jet)).toBe(false);
  });

  it("treats a parked aircraft as ground and keeps anti-air off the ground", () => {
    expect(canEngage(tank, parkedJet)).toBe(true);
    expect(canEngage(rifle, enemyTank)).toBe(true);
    expect(canEngage(gepard, enemyTank)).toBe(false);
    expect(canEngage(gepard, parkedJet)).toBe(false);
    expect(canAttackGround(gepard)).toBe(false);
    expect(canAttackGround(tank)).toBe(true);
    // A one-way unit goes to any point and detonates there.
    expect(canAttackGround(flamingo)).toBe(true);
  });

  it("attacks an airborne enemy only with the units that can hit it", () => {
    const entities = [rifle, gepard, tank, jet];
    const commands = resolveForceFire({
      player: 0,
      selected: [rifle.id, gepard.id, tank.id],
      entities,
      x: jet.x,
      y: jet.y,
    });
    expect(commands).toEqual([
      { kind: "attack", player: 0, units: [gepard.id], target: jet.id },
    ]);
    // A click on it does the same.
    expect(
      resolveClickOrder({
        player: 0,
        selected: [rifle.id, gepard.id, tank.id],
        entities,
        x: jet.x,
        y: jet.y,
      }),
    ).toEqual(commands);
    // Nobody who can hit it: no order at all.
    expect(
      resolveForceFire({
        player: 0,
        selected: [rifle.id, tank.id],
        entities,
        x: jet.x,
        y: jet.y,
      }),
    ).toEqual([]);
  });

  it("sends a one-way unit to attack any point and keeps anti-air home", () => {
    const entities = [flamingo, gepard];
    expect(
      resolveForceFire({
        player: 0,
        selected: [flamingo.id, gepard.id],
        entities,
        x: 55.5,
        y: 3.25,
      }),
    ).toEqual([
      {
        kind: "attackGround",
        player: 0,
        units: [flamingo.id],
        xRaw: Math.round(55.5 * 65536),
        yRaw: Math.round(3.25 * 65536),
      },
    ]);
  });
});
