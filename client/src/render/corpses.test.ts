import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import {
  type BodyPose,
  bodyPose,
  CORPSE_MS,
  type Corpse,
  corpseFade,
  corpseLimb,
  createCorpses,
  tossReach,
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

function body(c: Corpse, t: number): BodyPose {
  return bodyPose(c, t, {
    x: 0,
    y: 0,
    lift: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    scale: 1,
  });
}

function limb(c: Corpse, t: number, name: string): LimbPose {
  return corpseLimb(c, t, name, resetPose({} as LimbPose));
}

describe("shot deaths", () => {
  it("has three variants that end lying down, none standing", () => {
    const ends = [0, 1, 2].map((id) => body(corpse(id, "shot"), 2000));
    // Face down, on its back, on its side.
    expect(ends[0]?.pitch).toBeCloseTo(Math.PI / 2);
    expect(ends[1]?.pitch).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(ends[2]?.roll ?? 0)).toBeCloseTo(Math.PI / 2);
    for (const end of ends) expect(end?.lift).toBeGreaterThan(0);
  });

  it("falls over time, not at once", () => {
    const c = corpse(0, "shot");
    expect(body(c, 0).pitch).toBe(0);
    expect(body(c, 400).pitch).toBeGreaterThan(0);
    expect(body(c, 400).pitch).toBeLessThan(body(c, 800).pitch);
  });

  it("falls in the direction of the hit", () => {
    // Pushed along +x (push 0): a forward fall ends facing +x (yaw π/2).
    expect(body(corpse(0, "shot", 0), 2000).yaw).toBeCloseTo(Math.PI / 2);
    // Pushed along +y: it faces +y (yaw 0).
    expect(body(corpse(0, "shot", Math.PI / 2), 2000).yaw).toBeCloseTo(0);
  });

  it("buckles the knees while it crumples", () => {
    const c = corpse(2, "shot");
    expect(limb(c, 0, "m_shin_r").rx).toBeCloseTo(0);
    expect(limb(c, 500, "m_shin_r").rx).toBeCloseTo(Math.PI / 2, 1);
    expect(limb(c, 500, "m_hips").y).toBeLessThan(0);
  });
});

describe("explosion deaths", () => {
  it("throws the body away from the blast and lands it", () => {
    const c = corpse(1, "explosion", 0);
    const start = body(c, 0);
    const air = body(c, 300);
    const end = body(c, 2000);
    expect(start.x).toBeCloseTo(10);
    expect(air.lift).toBeGreaterThan(0.3);
    expect(end.x).toBeCloseTo(10 + tossReach(c));
    expect(end.y).toBeCloseTo(10);
    expect(end.lift).toBeLessThan(0.1);
  });

  it("flips over in the air and lands face down or up", () => {
    const c = corpse(1, "explosion");
    expect(Math.abs(body(c, 100).pitch)).toBeGreaterThan(Math.PI);
    expect(Math.abs(body(c, 2000).pitch)).toBeCloseTo(Math.PI / 2);
  });

  it("flings the arms up and then lets them go limp", () => {
    const c = corpse(1, "explosion");
    expect(limb(c, 100, "m_arms").rx).toBeLessThan(-2);
    expect(limb(c, 2000, "m_arms").rx).toBeCloseTo(-1);
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
