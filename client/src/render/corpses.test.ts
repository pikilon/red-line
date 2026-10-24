import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import {
  CORPSE_MS,
  type Corpse,
  corpseFade,
  corpseLimb,
  createCorpses,
  landing,
  type ManBody,
  manBody,
} from "./corpses";
import { createDeathCauses, spawnDeathEffects } from "./deaths";
import { createEffects } from "./effects";
import { type LimbPose, resetPose } from "./rig";
import { createSplatTexture } from "./splat";

function soldier(id: number, extra: Partial<EntityState> = {}): EntityState {
  return {
    id,
    owner: 0,
    kind: typeIndex("ua-rifleman"),
    x: 10,
    y: 10,
    hp: 50,
    flags: 0,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
    ...extra,
  };
}

function corpse(id: number, kind: "shot" | "explosion", push = 0): Corpse {
  return {
    id,
    kind: typeIndex("ua-rifleman"),
    owner: 0,
    x: 10,
    y: 10,
    yaw: 0,
    cause: { kind, push },
    startMs: 0,
  };
}

const ZERO_JOINTS = { thigh_l: 0, thigh_r: 0, shin_l: 0, shin_r: 0, arms: 0 };

function body(c: Corpse, t: number, prefix = "m", index = 0): ManBody {
  return manBody(c, prefix, index, t, {
    u: 0,
    lift: 0,
    tilt: 0,
    joints: { ...ZERO_JOINTS },
    drop: 0,
    splay: 0,
    scale: 1,
  });
}

/** True when the body lies flat: its axis is horizontal. */
function lies(m: ManBody): boolean {
  return Math.abs(Math.cos(m.tilt)) < 0.15;
}

describe("shot deaths (ragdoll)", () => {
  it("tips over its feet and comes to rest lying down, whatever the style", () => {
    for (const id of [0, 1, 2]) {
      const c = corpse(id, "shot", 1);
      expect(body(c, 0).tilt).toBeCloseTo(0.05, 2);
      expect(body(c, 200).tilt).toBeGreaterThan(0.05);
      expect(body(c, 200).tilt).toBeLessThan(1.2);
      const end = body(c, 4000);
      expect(lies(end)).toBe(true);
      expect(end.lift).toBeLessThan(0.08);
    }
  });

  it("falls towards the hit and stays near where it stood", () => {
    const end = body(corpse(0, "shot", 0), 4000);
    expect(end.tilt).toBeGreaterThan(1);
    expect(Math.abs(end.u)).toBeLessThan(0.6);
  });

  it("is deterministic", () => {
    const a = body(corpse(5, "shot", 0.4), 1500);
    const b = body(corpse(5, "shot", 0.4), 1500);
    expect(a.tilt).toBe(b.tilt);
    expect(a.joints.thigh_l).toBe(b.joints.thigh_l);
  });

  it("lets the legs go limp instead of keeping the pose it died in", () => {
    const striding = {
      ...corpse(0, "shot", 1),
      joints: {
        m: { thigh_l: -0.6, thigh_r: 0.6, shin_l: 0.8, shin_r: 0, arms: 0 },
      },
    };
    const start = body(striding, 0).joints;
    expect(start.thigh_l).toBeCloseTo(-0.6, 1);
    expect(start.shin_l).toBeCloseTo(0.8, 1);
    const end = body(striding, 4000).joints;
    expect(
      Math.abs(end.thigh_l + 0.6) + Math.abs(end.thigh_r - 0.6),
    ).toBeGreaterThan(0.2);
    // They settle: nothing moves after the body lies still.
    const later = body(striding, 5000).joints;
    expect(later.thigh_l).toBeCloseTo(end.thigh_l, 3);
  });

  it("keeps the joints inside their limits and the shins bending one way", () => {
    for (const t of [100, 300, 700, 1500, 4000]) {
      const j = body(corpse(1, "shot", 0), t).joints;
      expect(j.shin_l).toBeGreaterThanOrEqual(0);
      expect(j.shin_l).toBeLessThanOrEqual(2.6);
      expect(j.shin_r).toBeGreaterThanOrEqual(0);
      expect(j.thigh_l).toBeGreaterThanOrEqual(-1.8);
      expect(j.thigh_l).toBeLessThanOrEqual(1.4);
    }
  });

  it("crumples: the knees give way and the hips drop", () => {
    const c = corpse(2, "shot", 1);
    const mid = body(c, 300);
    expect(mid.drop).toBeGreaterThan(0.5);
    expect(mid.joints.shin_r).toBeGreaterThan(0.8);
  });

  it("a kneeling soldier keeps the hips low and falls from the kneel", () => {
    const kneeling = {
      ...corpse(0, "shot", 1),
      kneel: 1,
      joints: {
        g: {
          thigh_l: -1.056,
          shin_l: 1.03,
          thigh_r: -0.253,
          shin_r: 1.571,
          arms: 0,
        },
      },
    };
    const start = body(kneeling, 0, "g");
    expect(start.drop).toBe(1);
    expect(start.joints.shin_r).toBeCloseTo(1.571, 1);
  });

  it("the second man of a team reacts a moment later", () => {
    const c = corpse(0, "shot", 1);
    expect(body(c, 150, "a", 1).tilt).toBeLessThan(body(c, 150, "g", 0).tilt);
  });

  it("turns the body into the limb offsets of the fall plane", () => {
    const m = body(corpse(0, "shot", 1), 4000);
    const out = () => resetPose({} as LimbPose);
    const forward = corpseLimb(m, "shin_l", 1, 0, out());
    expect(forward.rx).toBeCloseTo(m.joints.shin_l);
    expect(forward.rz).toBeCloseTo(0);
    expect(corpseLimb(m, "shin_l", -1, 0, out()).rx).toBeCloseTo(
      -m.joints.shin_l,
    );
    expect(corpseLimb(m, "shin_l", 0, 1, out()).rz).toBeCloseTo(
      m.joints.shin_l,
    );
    expect(corpseLimb(m, "torso", 1, 0, out()).rx).toBe(0);
    // Once it lies, the thighs fall apart sideways, the left one to the left.
    expect(m.splay).toBeGreaterThan(0.1);
    expect(corpseLimb(m, "thigh_l", 1, 0, out()).rz).toBeGreaterThan(0);
    expect(corpseLimb(m, "thigh_r", 1, 0, out()).rz).toBeLessThan(0);
  });
});

describe("explosion deaths (ragdoll)", () => {
  it("throws the body up and away along the push and lands it", () => {
    const c = corpse(1, "explosion", 0);
    const peak = Math.max(
      ...[100, 200, 300, 400, 500].map((t) => body(c, t).lift),
    );
    expect(peak).toBeGreaterThan(0.3);
    const end = body(c, 5000);
    expect(end.u).toBeGreaterThan(1);
    expect(lies(end)).toBe(true);
    expect(end.lift).toBeLessThan(0.08);
  });

  it("tumbles in the air: well over a half turn before it lands", () => {
    const c = corpse(1, "explosion", 0);
    expect(Math.abs(body(c, 450).tilt)).toBeGreaterThan(Math.PI);
  });

  it("flings the arms and legs about while it flies", () => {
    const c = corpse(1, "explosion", 0);
    const mid = body(c, 350).joints;
    const moved =
      Math.abs(mid.arms) + Math.abs(mid.thigh_l) + Math.abs(mid.thigh_r);
    expect(moved).toBeGreaterThan(1);
  });

  it("knows where and when it lands, for the blood", () => {
    const c = corpse(1, "explosion", 0);
    const down = landing(c);
    expect(down.u).toBeGreaterThan(1);
    expect(down.ms).toBeGreaterThan(500);
    expect(down.ms).toBeLessThan(5000);
    expect(landing(corpse(0, "shot", 0)).u).toBeLessThan(down.u);
  });
});

describe("corpse lifetime", () => {
  it("shrinks away over the last seconds and is dropped after", () => {
    expect(corpseFade(1000)).toBe(1);
    expect(corpseFade(CORPSE_MS - 1500)).toBeCloseTo(0.5);
    expect(corpseFade(CORPSE_MS)).toBe(0);
    const bodies = createCorpses();
    bodies.add(corpse(0, "shot"));
    expect(bodies.live(CORPSE_MS - 1)).toHaveLength(1);
    expect(bodies.live(CORPSE_MS)).toHaveLength(0);
  });
});

describe("death causes", () => {
  const rifleman = typeIndex("ru-rifleman");
  const rpg = typeIndex("ru-rpg-gunner");

  it("a rifle shot pushes the victim away from the shooter", () => {
    const causes = createDeathCauses();
    const victim = soldier(1, { x: 12, y: 10 });
    causes.record(
      [
        victim,
        soldier(2, {
          kind: rifleman,
          x: 5,
          y: 10,
          flags: ENTITY_FLAGS.fired,
          target: 1,
        }),
      ],
      1000,
    );
    const cause = causes.causeOf(victim, 1500);
    expect(cause.kind).toBe("shot");
    expect(cause.push).toBeCloseTo(0);
  });

  it("a rocket makes it an explosion, also for a victim next to the target", () => {
    const causes = createDeathCauses();
    const target = soldier(1, { x: 12, y: 10 });
    const neighbour = soldier(3, { x: 12, y: 11 });
    causes.record(
      [
        target,
        neighbour,
        soldier(2, {
          kind: rpg,
          x: 5,
          y: 10,
          flags: ENTITY_FLAGS.fired,
          target: 1,
        }),
      ],
      1000,
    );
    expect(causes.causeOf(target, 2000).kind).toBe("explosion");
    const near = causes.causeOf(neighbour, 2000);
    expect(near.kind).toBe("explosion");
    // Thrown away from the blast: the neighbour is south of it (+y).
    expect(near.push).toBeCloseTo(Math.PI / 2);
    expect(causes.causeOf(soldier(9, { x: 30, y: 30 }), 2000).kind).toBe(
      "shot",
    );
  });

  it("forgets old shots", () => {
    const causes = createDeathCauses();
    const victim = soldier(1, { x: 12, y: 10 });
    causes.record(
      [
        victim,
        soldier(2, {
          kind: rpg,
          x: 5,
          y: 10,
          flags: ENTITY_FLAGS.fired,
          target: 1,
        }),
      ],
      0,
    );
    expect(causes.causeOf(victim, 20_000).kind).toBe("shot");
  });
});

describe("death effects with bodies", () => {
  it("adds a body and delays the blood until it lands", () => {
    const effects = createEffects();
    const bodies = createCorpses();
    const causes = {
      record() {},
      causeOf: () => ({ kind: "shot" as const, push: 0 }),
    };
    spawnDeathEffects([soldier(1)], effects, true, 0, bodies, causes);
    expect(bodies.live(0)).toHaveLength(1);
    expect(effects.meshes.body.count).toBe(0);
    effects.update(0);
    // A drop flies off at once; the pool shows up when the body is down.
    const early = effects.meshes.blood.count;
    effects.update(2000);
    expect(effects.meshes.blood.count).toBeGreaterThan(early);
  });

  it("sprays more for an explosion and none without gore", () => {
    const blast = {
      record() {},
      causeOf: () => ({ kind: "explosion" as const, push: 0 }),
    };
    const shot = {
      record() {},
      causeOf: () => ({ kind: "shot" as const, push: 0 }),
    };
    const count = (causes: typeof blast | typeof shot, gore: boolean) => {
      const effects = createEffects();
      spawnDeathEffects(
        [soldier(1)],
        effects,
        gore,
        0,
        createCorpses(),
        causes,
      );
      effects.update(3000);
      return effects.meshes.blood.count;
    };
    expect(count(blast, true)).toBeGreaterThan(count(shot, true));
    expect(count(blast, false)).toBe(0);
  });
});

describe("blood splat texture", () => {
  it("is a soft-edged blob with scattered drops: opaque centre, clear corners", () => {
    const texture = createSplatTexture();
    const data = texture.image.data as Uint8Array;
    const size = texture.image.width;
    const alphaAt = (x: number, y: number) => data[(y * size + x) * 4 + 3] ?? 0;
    expect(alphaAt(size / 2, size / 2)).toBeGreaterThan(200);
    expect(alphaAt(0, 0)).toBe(0);
    let covered = 0;
    for (let i = 0; i < size * size; i++)
      if ((data[i * 4 + 3] ?? 0) > 20) covered++;
    // Irregular: neither empty nor a filled square.
    expect(covered / (size * size)).toBeGreaterThan(0.15);
    expect(covered / (size * size)).toBeLessThan(0.6);
  });
});

describe("blood on the clothes", () => {
  it("a death is soaked by the blow plus what hurt him before", () => {
    const effects = createEffects();
    const bodies = createCorpses();
    const wounded = soldier(1, { hp: 30 });
    const fresh = soldier(2, { hp: 90 });
    const cause = { kind: "shot" as const, push: 0 };
    spawnDeathEffects([wounded, fresh], effects, true, 0, bodies, {
      record() {},
      causeOf: () => cause,
    });
    const [a, b] = bodies.live(0);
    expect(a?.blood).toBeGreaterThan(b?.blood ?? 1);
    expect(b?.blood).toBeGreaterThan(0.4);
    expect(a?.blood).toBeLessThanOrEqual(1);
  });
});
