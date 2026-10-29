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
  /** Poses `entity` every 50 ms from `from` to `to`, sliding it `speed`
   *  tiles per second along x; returns the last rig. */
  function run(
    animator: ReturnType<typeof createAnimator>,
    entity: EntityState,
    from: number,
    to: number,
    speed: number,
  ) {
    let rig = animator.pose(entity, from).rig;
    for (let ms = from + 50; ms <= to; ms += 50) {
      entity.x += speed * 0.05;
      rig = animator.pose(entity, ms).rig;
    }
    return rig;
  }

  it("only rigged infantry get a rig", () => {
    const animator = createAnimator();
    expect(
      animator.pose(entity(1, 0, "ua-bradley", 0, 0, 100), 0).rig,
    ).toBeNull();
    expect(
      animator.pose(entity(2, 0, "ua-rifleman", 0, 0, 100), 0).rig,
    ).not.toBeNull();
  });

  it("walks with the speed it really has, not with its order", () => {
    const animator = createAnimator();
    // An attacker standing in range has an order (the moving flag) and no speed.
    const standing = entity(3, 0, "ua-rifleman", 5, 5, 100, {
      flags: ENTITY_FLAGS.moving,
    });
    expect(run(animator, standing, 0, 1000, 0)?.walk).toBe(0);
    const walker = entity(4, 0, "ua-rifleman", 5, 5, 100);
    const rig = run(animator, walker, 0, 1000, 1.2);
    expect(rig?.walk).toBe(1);
    expect(rig?.phase).toBeGreaterThan(1);
  });

  it("eases the walk out and kneels a team that stops", () => {
    const animator = createAnimator();
    const unit = entity(5, 0, "ru-rpg-gunner", 5, 5, 100);
    expect(run(animator, unit, 0, 1500, 1.2)?.stance).toBe(1);
    const stopped = run(animator, unit, 1550, 3500, 0);
    expect(stopped?.walk).toBe(0);
    expect(stopped?.stance).toBe(0);
  });

  it("holds the legs of a launcher team until the pick-up is done", () => {
    const animator = createAnimator();
    const unit = entity(6, 0, "ua-stugna-team", 5, 5, 100);
    // The simulation roots the team while it stows the launcher and reports
    // the stow in `progress` (spec 11): the pose follows it, and the legs only
    // start walking once the launcher is on the shoulder.
    const stowing = { ...unit, progress: 500 };
    const early = run(animator, stowing, 0, 500, 0);
    expect(early?.carry).toBeCloseTo(0.5, 2);
    expect(early?.walk).toBe(0);
    unit.progress = 1000;
    const later = run(animator, unit, 550, 2500, 1.2);
    expect(later?.carry).toBe(1);
    expect(later?.walk).toBe(1);
    // Stopped, the team sets the launcher up again: the reported stow falls.
    unit.progress = 0;
    const stopped = run(animator, unit, 2550, 4500, 0);
    expect(stopped?.carry).toBe(0);
  });

  it("drops the weapon pose while moving and raises it on a target", () => {
    const animator = createAnimator();
    const shooter = entity(7, 0, "ua-rifleman", 5, 5, 100, { target: 9 });
    expect(run(animator, shooter, 0, 1000, 0)?.aim).toBe(1);
    expect(run(animator, shooter, 1050, 1300, 1.2)?.aim).toBeLessThan(1);
  });

  it("keeps aiming after a shot at the ground, which has no target", () => {
    const animator = createAnimator();
    const shooter = entity(8, 0, "ua-rifleman", 5, 5, 100);
    animator.recordShots([{ ...shooter, flags: ENTITY_FLAGS.fired }], 0);
    expect(run(animator, shooter, 0, 1000, 0)?.aim).toBe(1);
    expect(run(animator, shooter, 1050, 4000, 0)?.aim).toBe(0);
  });

  it("times a rocket reload from the shot and forgets despawned units", () => {
    const animator = createAnimator();
    const gunner = entity(9, 0, "ru-rpg-gunner", 0, 0, 100);
    const fired = { ...gunner, flags: ENTITY_FLAGS.fired };
    animator.pose(gunner, 1000);
    animator.recordShots([fired], 1000);
    const rig = animator.pose(gunner, 2000).rig;
    expect(rig?.sinceShot).toBe(1000);
    expect(rig?.reloadMs).toBe(3000);
    // A rifle shows no reload.
    expect(
      animator.pose(entity(10, 0, "ua-rifleman", 0, 0, 100), 0).rig?.reloadMs,
    ).toBe(0);
    animator.recordShots([], 3000);
    expect(animator.pose(gunner, 3000).rig?.sinceShot).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("spec 22 §6: hits that do not kill", () => {
  it("jolts the body quickly and lets it recover, never past the cap", () => {
    const animator = createAnimator();
    const unit = entity(20, 0, "ua-rifleman", 5, 5, 100);
    animator.pose(unit, 0);
    animator.recordHits?.([{ id: 20, push: 1, amplitude: 0.4 }], 1000);
    expect(animator.pose(unit, 1000).rig?.flinch).toBeCloseTo(0);
    const peak = animator.pose(unit, 1070).rig;
    expect(peak?.flinch).toBeCloseTo(0.4, 1);
    expect(peak?.flinchPush).toBe(1);
    const later = animator.pose(unit, 1400).rig?.flinch ?? 1;
    expect(later).toBeLessThan(0.15);
    expect(animator.pose(unit, 1800).rig?.flinch).toBe(0);
    // Two hits add up but stay under the cap.
    animator.recordHits?.([{ id: 20, push: 0, amplitude: 0.6 }], 2000);
    animator.recordHits?.([{ id: 20, push: 0, amplitude: 0.6 }], 2070);
    expect(animator.pose(unit, 2140).rig?.flinch).toBeLessThanOrEqual(0.75);
  });

  it("ignores hits on units that were never drawn as soldiers", () => {
    const animator = createAnimator();
    expect(() =>
      animator.recordHits?.([{ id: 999, push: 0, amplitude: 0.5 }], 0),
    ).not.toThrow();
  });
});
