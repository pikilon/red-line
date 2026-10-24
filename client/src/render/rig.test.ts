import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { LimbModel, TypeModel } from "./models";
import {
  type LimbPose,
  limbPose,
  REST_RIG,
  type RigState,
  reloadProgress,
  resetPose,
} from "./rig";

const EMPTY: TypeModel = {
  parts: new Map(),
  turret: new Map(),
  pivot: new Vector3(),
  fallback: false,
};

function limb(name: string, world: Vector3): LimbModel {
  return { name, parent: null, local: world, world, parts: new Map() };
}

const STUGNA: TypeModel = {
  ...EMPTY,
  limbs: [limb("x_launcher", new Vector3(0, 0.25, 0))],
  anchors: new Map([["anchor_carry", new Vector3(0.1, 0.3, 0.2)]]),
};

function pose(
  typeId: string,
  name: string,
  state: Partial<RigState>,
  model: TypeModel = EMPTY,
): LimbPose {
  return limbPose(
    typeId,
    model,
    name,
    { ...REST_RIG, ...state },
    resetPose({} as LimbPose),
  );
}

describe("walk cycle", () => {
  it("keeps every limb neutral at rest", () => {
    for (const name of ["m_hips", "m_thigh_l", "m_shin_r", "m_arms"]) {
      const out = pose("ua-rifleman", name, {});
      expect(out.rx).toBeCloseTo(0);
      expect(out.y).toBeCloseTo(0);
    }
  });

  it("swings the thighs in opposite directions", () => {
    const left = pose("ua-rifleman", "m_thigh_l", { walk: 1, phase: 0.25 });
    const right = pose("ua-rifleman", "m_thigh_r", { walk: 1, phase: 0.25 });
    expect(left.rx).toBeLessThan(0);
    expect(right.rx).toBeGreaterThan(0);
    expect(left.rx).toBeCloseTo(-right.rx);
  });

  it("bends the knee only in the swing phase", () => {
    expect(
      pose("ua-rifleman", "m_shin_l", { walk: 1, phase: 0 }).rx,
    ).toBeGreaterThan(0.5);
    expect(
      pose("ua-rifleman", "m_shin_l", { walk: 1, phase: 0.5 }).rx,
    ).toBeCloseTo(0);
  });

  it("does not bounce the hips more than a hair", () => {
    for (let phase = 0; phase < 1; phase += 0.05) {
      const out = pose("ua-rifleman", "m_hips", { walk: 1, phase });
      expect(Math.abs(out.y)).toBeLessThan(0.01);
    }
  });
});

describe("kneeling teams", () => {
  it("lowers the hips and kneels the right leg when the stance is 0", () => {
    const hips = pose("ru-rpg-gunner", "g_hips", { stance: 0 });
    expect(hips.y).toBeCloseTo(-0.1);
    expect(pose("ru-rpg-gunner", "a_shin_r", { stance: 0 }).rx).toBeCloseTo(
      Math.PI / 2,
      1,
    );
  });

  it("stands both men up to walk", () => {
    for (const man of ["g", "a"]) {
      const hips = pose("ru-rpg-gunner", `${man}_hips`, {
        stance: 1,
        walk: 1,
        phase: 0.25,
      });
      expect(hips.y).toBeGreaterThan(-0.01);
    }
  });

  it("never kneels a rifleman", () => {
    expect(pose("ua-rifleman", "m_hips", { stance: 0 }).y).toBeCloseTo(0);
  });
});

describe("rocket reload", () => {
  const SHOT = { reloadMs: 3000 };

  it("progresses from 0 at the shot to 1 once loaded", () => {
    expect(reloadProgress({ ...REST_RIG, ...SHOT, sinceShot: 0 })).toBe(0);
    expect(reloadProgress({ ...REST_RIG, ...SHOT, sinceShot: 1500 })).toBe(0.5);
    expect(reloadProgress({ ...REST_RIG, ...SHOT, sinceShot: 9000 })).toBe(1);
    expect(reloadProgress(REST_RIG)).toBe(1);
  });

  it("hides the spent round, then slides a new one in", () => {
    const spent = pose("ru-rpg-gunner", "g_round", { ...SHOT, sinceShot: 0 });
    expect(spent.sx).toBe(0);
    const arriving = pose("ru-rpg-gunner", "g_round", {
      ...SHOT,
      sinceShot: 1500,
    });
    expect(arriving.sx).toBe(1);
    expect(Math.abs(arriving.z)).toBeGreaterThan(0.01);
    const loaded = pose("ru-rpg-gunner", "g_round", {
      ...SHOT,
      sinceShot: 3000,
    });
    expect(loaded.z).toBeCloseTo(0);
    expect(loaded.y).toBeCloseTo(0);
  });

  it("lowers the launcher in the middle of the reload and raises it after", () => {
    const aimed = { aim: 1 };
    const raised = pose("ru-rpg-gunner", "g_arms", aimed);
    const lowered = pose("ru-rpg-gunner", "g_arms", {
      ...aimed,
      ...SHOT,
      sinceShot: 1500,
    });
    const after = pose("ru-rpg-gunner", "g_arms", {
      ...aimed,
      ...SHOT,
      sinceShot: 3000,
    });
    expect(lowered.rx).toBeGreaterThan(raised.rx + 0.8);
    expect(after.rx).toBeCloseTo(raised.rx);
  });

  it("swaps the Stugna canister", () => {
    const spent = pose("ua-stugna-team", "x_canister", {
      reloadMs: 5000,
      sinceShot: 1000,
    });
    expect(spent.sx).toBeLessThan(1);
    const falling = pose("ua-stugna-team", "x_canister", {
      reloadMs: 5000,
      sinceShot: 2000,
    });
    expect(falling.y).toBeGreaterThan(0);
    expect(
      pose("ua-stugna-team", "x_canister", { reloadMs: 5000, sinceShot: 5000 })
        .y,
    ).toBeCloseTo(0);
  });
});

describe("Stugna pick-up", () => {
  it("carries the launcher to the shoulder anchor and folds the tripod", () => {
    const resting = pose("ua-stugna-team", "x_launcher", {}, STUGNA);
    expect(resting.x).toBe(0);
    const carried = pose("ua-stugna-team", "x_launcher", { carry: 1 }, STUGNA);
    expect(carried.x).toBeCloseTo(0.1);
    expect(carried.y).toBeCloseTo(0.05);
    expect(carried.z).toBeCloseTo(0.2);
    const tripod = pose("ua-stugna-team", "x_tripod", { carry: 1 }, STUGNA);
    expect(tripod.sx).toBeLessThan(0.3);
    expect(pose("ua-stugna-team", "x_cable", { carry: 1 }).sx).toBe(0);
  });
});

describe("unrigged types", () => {
  it("stay neutral", () => {
    const out = pose("ua-bradley", "m_hips", { walk: 1, phase: 0.3 });
    expect(out).toEqual(resetPose({} as LimbPose));
  });
});
