import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import {
  BOB_PERIOD_MS,
  BOB_TILES,
  bobHeight,
  createAnimator,
  RECOIL_MS,
  RECOIL_TILES,
  recoilOffset,
} from "./animation";

function entity(
  id: number,
  owner: number,
  type: string,
  x: number,
  y: number,
  hp: number,
  extra: Partial<EntityState> = {},
): EntityState {
  return {
    id,
    owner,
    kind: typeIndex(type),
    x,
    y,
    hp,
    flags: 0,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
    ...extra,
  };
}

describe("AC-09-01: recoil and walk bob curves", () => {
  it("recoilOffset(0) is RECOIL_TILES", () => {
    expect(recoilOffset(0)).toBe(RECOIL_TILES);
  });

  it("recoilOffset(RECOIL_MS / 2) is half of RECOIL_TILES", () => {
    expect(recoilOffset(RECOIL_MS / 2)).toBe(RECOIL_TILES / 2);
  });

  it("recoilOffset(RECOIL_MS) and negative ages are 0", () => {
    expect(recoilOffset(RECOIL_MS)).toBe(0);
    expect(recoilOffset(-10)).toBe(0);
  });

  it("bobHeight stays in [0, BOB_TILES] across ids and times", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let id = 0; id < 8; id++) {
      for (let nowMs = 0; nowMs < 2_000; nowMs += 7) {
        const bob = bobHeight(id, nowMs);
        min = Math.min(min, bob);
        max = Math.max(max, bob);
      }
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(BOB_TILES);
  });

  it("bobHeight is 0 at nowMs = 0 for id 0 and BOB_TILES at nowMs = BOB_PERIOD_MS / 2", () => {
    expect(bobHeight(0, 0)).toBe(0);
    expect(bobHeight(0, BOB_PERIOD_MS / 2)).toBe(BOB_TILES);
  });
});

describe("AC-09-02: animator poses", () => {
  it("a fired tank recoils RECOIL_TILES at the shot instant and 0 after RECOIL_MS", () => {
    const animator = createAnimator();
    const tank = entity(7, 0, "ua-leopard-2a4", 3, 4, 100, {
      flags: ENTITY_FLAGS.fired,
    });
    animator.recordShots([tank], 1_000);

    expect(animator.pose(tank, 1_000).recoil).toBe(RECOIL_TILES);
    expect(animator.pose(tank, 1_200).recoil).toBe(0);
  });

  it("a shot without the fired flag does not recoil", () => {
    const animator = createAnimator();
    const tank = entity(7, 0, "ua-leopard-2a4", 3, 4, 100);
    animator.recordShots([tank], 1_000);

    expect(animator.pose(tank, 1_000).recoil).toBe(0);
  });

  it("a moving infantry unit lifts by bobHeight; a stationary one and a moving tank lift 0", () => {
    const animator = createAnimator();
    const movingRifleman = entity(8, 0, "ua-rifleman", 5, 6, 100, {
      flags: ENTITY_FLAGS.moving,
    });
    const stationaryRifleman = entity(9, 0, "ua-rifleman", 6, 7, 100);
    const movingTank = entity(10, 0, "ua-leopard-2a4", 7, 8, 100, {
      flags: ENTITY_FLAGS.moving,
    });
    const now = 1_000;

    expect(animator.pose(movingRifleman, now).lift).toBe(
      bobHeight(movingRifleman.id, now),
    );
    expect(animator.pose(movingRifleman, now).lift).toBeGreaterThan(0);
    expect(animator.pose(stationaryRifleman, now).lift).toBe(0);
    expect(animator.pose(movingTank, now).lift).toBe(0);
  });
});

describe("spec 21: soldier rig state", () => {
  const MOVING = { flags: ENTITY_FLAGS.moving };

  it("only rigged infantry get a rig", () => {
    const animator = createAnimator();
    expect(
      animator.pose(entity(1, 0, "ua-bradley", 0, 0, 100), 0).rig,
    ).toBeNull();
    expect(
      animator.pose(entity(2, 0, "ua-rifleman", 0, 0, 100), 0).rig,
    ).not.toBeNull();
  });

  it("eases the walk in and advances the cycle only while walking", () => {
    const animator = createAnimator();
    const walker = entity(3, 0, "ru-rpg-gunner", 0, 0, 100);
    animator.pose(walker, 0);
    const moving = { ...walker, ...MOVING };
    let rig = animator.pose(moving, 50)?.rig;
    expect(rig?.walk).toBeGreaterThan(0);
    expect(rig?.walk).toBeLessThan(1);
    for (let ms = 100; ms <= 1000; ms += 50)
      rig = animator.pose(moving, ms).rig;
    expect(rig?.walk).toBe(1);
    expect(rig?.stance).toBe(1);
    const phase = rig?.phase ?? 0;
    for (let ms = 1050; ms <= 2000; ms += 50)
      rig = animator.pose(walker, ms).rig;
    expect(rig?.walk).toBe(0);
    expect(rig?.phase).toBeGreaterThan(phase);
    expect(rig?.stance).toBeLessThan(1);
  });

  it("drops the weapon pose while moving and raises it on a target", () => {
    const animator = createAnimator();
    const shooter = entity(4, 0, "ua-rifleman", 0, 0, 100, { target: 9 });
    let rig = animator.pose(shooter, 0).rig;
    for (let ms = 50; ms <= 1000; ms += 50)
      rig = animator.pose(shooter, ms).rig;
    expect(rig?.aim).toBe(1);
    rig = animator.pose({ ...shooter, ...MOVING }, 1050).rig;
    expect(rig?.aim).toBeLessThan(1);
  });

  it("times a rocket reload from the shot and forgets despawned units", () => {
    const animator = createAnimator();
    const gunner = entity(5, 0, "ru-rpg-gunner", 0, 0, 100);
    const fired = { ...gunner, flags: ENTITY_FLAGS.fired };
    animator.pose(gunner, 1000);
    animator.recordShots([fired], 1000);
    const rig = animator.pose(gunner, 2000).rig;
    expect(rig?.sinceShot).toBe(1000);
    expect(rig?.reloadMs).toBe(3000);
    // A rifle shows no reload.
    expect(
      animator.pose(entity(6, 0, "ua-rifleman", 0, 0, 100), 0).rig?.reloadMs,
    ).toBe(0);
    animator.recordShots([], 3000);
    expect(animator.pose(gunner, 3000).rig?.sinceShot).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
