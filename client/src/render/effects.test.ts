import { Color, type InstancedMesh, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  type MatchSnapshot,
} from "../sim/matchSnapshot";
import {
  createEffects,
  EFFECT_CAPACITY,
  type Effects,
  spawnShotEffects,
} from "./effects";

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
    ...extra,
  };
}

function snapshot(tick: number, entities: EntityState[]): MatchSnapshot {
  return {
    tick,
    viewer: 0,
    credits: 0,
    powerProduced: 0,
    powerConsumed: 0,
    outcome: "ongoing",
    winner: null,
    entities,
    queues: [],
  };
}

function translation(mesh: InstancedMesh, index: number): Vector3 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixPosition(matrix);
}

function scale(mesh: InstancedMesh, index: number): Vector3 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixScale(matrix);
}

function colorAt(mesh: InstancedMesh, index: number): Color {
  const color = new Color();
  mesh.getColorAt(index, color);
  return color;
}

function counts(effects: Effects): Record<string, number> {
  return effects.counts();
}

describe("effects", () => {
  it("AC-07-01: effect pool", () => {
    const effects = createEffects();
    for (let i = 0; i < EFFECT_CAPACITY + 4; i++) {
      effects.spawn("muzzle", { x: i, y: 0, startMs: 0 });
    }
    effects.update(0);
    // Full pool: the oldest four spawns were recycled.
    expect(effects.meshes.muzzle.count).toBe(EFFECT_CAPACITY);
    expect(translation(effects.meshes.muzzle, 0).x).toBeCloseTo(4, 6);

    // Fades by age.
    effects.clear();
    effects.spawn("muzzle", { x: 0, y: 0, startMs: 0 });
    effects.update(0);
    const fresh = colorAt(effects.meshes.muzzle, 0);
    effects.update(40);
    const faded = colorAt(effects.meshes.muzzle, 0);
    expect(faded.r).toBeLessThan(fresh.r);

    // Scales by age (the explosion grows).
    effects.clear();
    effects.spawn("explosion", { x: 0, y: 0, size: 2, startMs: 0 });
    effects.update(0);
    const small = scale(effects.meshes.explosion, 0).x;
    effects.update(450);
    const large = scale(effects.meshes.explosion, 0).x;
    expect(large).toBeGreaterThan(small);

    // Expired instances leave the pool and hide the mesh.
    effects.clear();
    effects.spawn("muzzle", { x: 0, y: 0, startMs: 0 });
    effects.update(0);
    expect(effects.meshes.muzzle.count).toBe(1);
    expect(effects.meshes.muzzle.visible).toBe(true);
    effects.update(81);
    expect(effects.meshes.muzzle.count).toBe(0);
    expect(effects.meshes.muzzle.visible).toBe(false);
  });

  it("AC-07-02: shot effects by damage type", () => {
    const effects = createEffects();
    const target = entity(2, 1, "ru-rifleman", 12, 10, 90);

    // smallArms: muzzle + impact, muzzle offset toward the target.
    const rifleman = entity(1, 0, "ua-rifleman", 10, 10, 100, {
      flags: ENTITY_FLAGS.fired,
      target: 2,
    });
    spawnShotEffects(snapshot(1, [rifleman, target]), effects, 0);
    effects.update(0);
    expect(counts(effects).muzzle).toBe(1);
    expect(counts(effects).impact).toBe(1);
    expect(counts(effects).blast).toBe(0);
    expect(translation(effects.meshes.muzzle, 0).x).toBeCloseTo(10.3, 6);
    expect(translation(effects.meshes.muzzle, 0).z).toBeCloseTo(10, 6);

    // autocannon: also an impact.
    effects.clear();
    const scout = entity(3, 0, "ua-bradley", 10, 10, 500, {
      flags: ENTITY_FLAGS.fired,
      target: 2,
    });
    spawnShotEffects(snapshot(1, [scout, target]), effects, 0);
    effects.update(0);
    expect(counts(effects).impact).toBe(1);

    // antiTank: a blast.
    effects.clear();
    const stugna = entity(4, 0, "ua-stugna-team", 10, 10, 90, {
      flags: ENTITY_FLAGS.fired,
      target: 2,
    });
    spawnShotEffects(snapshot(1, [stugna, target]), effects, 0);
    effects.update(0);
    expect(counts(effects).blast).toBe(1);
    expect(counts(effects).impact).toBe(0);

    // highExplosive: an explosion delayed by projectileTicks / 15 s.
    effects.clear();
    const himars = entity(5, 0, "ua-himars", 10, 10, 200, {
      flags: ENTITY_FLAGS.fired,
      target: 2,
    });
    spawnShotEffects(snapshot(1, [himars, target]), effects, 0);
    effects.update(0);
    expect(counts(effects).explosion).toBe(0);
    effects.update(2000);
    expect(counts(effects).explosion).toBe(1);

    // thermobaric: also an explosion.
    effects.clear();
    const tos = entity(6, 0, "ru-tos-1a", 10, 10, 350, {
      flags: ENTITY_FLAGS.fired,
      target: 2,
    });
    spawnShotEffects(snapshot(1, [tos, target]), effects, 0);
    effects.update(1340);
    expect(counts(effects).explosion).toBe(1);

    // A target that is not in the snapshot draws only the muzzle.
    effects.clear();
    const lonely = entity(7, 0, "ua-rifleman", 10, 10, 100, {
      flags: ENTITY_FLAGS.fired,
      target: 99,
    });
    spawnShotEffects(snapshot(1, [lonely]), effects, 0);
    effects.update(0);
    expect(counts(effects).muzzle).toBe(1);
    expect(counts(effects).impact).toBe(0);
    expect(counts(effects).blast).toBe(0);
    expect(counts(effects).explosion).toBe(0);
  });
});
