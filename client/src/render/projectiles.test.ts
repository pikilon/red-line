import { type InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { typeDef, typeIndex, WEAPONS } from "../rules";
import type { ProjectileState } from "../sim/combatSnapshot";
import type { EntityState, MatchSnapshot } from "../sim/matchSnapshot";
import { createEffects } from "./effects";
import { type FlightProfile, flightPoint } from "./flight";
import { createProjectiles, PROJECTILE_MODELS } from "./projectiles";

function weaponIndex(id: string): number {
  return WEAPONS.findIndex((weapon) => weapon.id === id);
}

function entity(
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
    rallies: [],
  };
}

function projectile(extra: Partial<ProjectileState>): ProjectileState {
  return {
    id: 0,
    owner: 1,
    weapon: 0,
    shooter: 1,
    target: 9,
    originX: 0,
    originY: 0,
    impactX: 4,
    impactY: 0,
    launchTick: 0,
    impactTick: 10,
    ...extra,
  };
}

function pose(
  mesh: InstancedMesh,
  index: number,
): { position: Vector3; forward: Vector3 } {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  const position = new Vector3();
  const rotation = new Quaternion();
  matrix.decompose(position, rotation, new Vector3());
  return { position, forward: new Vector3(0, 0, 1).applyQuaternion(rotation) };
}

/** Muzzle height of the spec 17 §6: 0.7 × render height of the shooter. */
function muzzle(type: string): number {
  return (0.7 * typeDef(typeIndex(type)).render.size[1]) / 100;
}

describe("AC-17-13: projectile renderer", () => {
  const rpgWeapon = weaponIndex("ru-rpg7");
  const rocketWeapon = weaponIndex("ua-gmlrs");
  const gunner = entity(1, 1, "ru-rpg-gunner", 2, 3);
  const himars = entity(2, 0, "ua-himars", 10, 10);
  const view = snapshot(20, [gunner, himars]);
  const rpg = projectile({
    id: 0,
    weapon: rpgWeapon,
    shooter: gunner.id,
    originX: 2,
    originY: 3,
    impactX: 6,
    impactY: 3,
    launchTick: 15,
    impactTick: 25,
  });
  const rocket = projectile({
    id: 1,
    owner: 0,
    weapon: rocketWeapon,
    shooter: himars.id,
    originX: 10,
    originY: 10,
    impactX: 10,
    impactY: 30,
    launchTick: 10,
    impactTick: 40,
  });
  const landed = projectile({
    id: 2,
    weapon: rpgWeapon,
    shooter: gunner.id,
    launchTick: 5,
    impactTick: 12,
  });
  const tick = 20.5;

  it("draws only the flying projectiles, counted per model", () => {
    const projectiles = createProjectiles();
    projectiles.sync([rpg, rocket, landed], tick, view);
    const counts = projectiles.counts();
    expect(counts.rpg).toBe(1);
    expect(counts.rocket).toBe(1);
    for (const model of PROJECTILE_MODELS) {
      if (model === "rpg" || model === "rocket") continue;
      expect(counts[model]).toBe(0);
    }
    expect(projectiles.meshes.rpg.count).toBe(1);
    expect(projectiles.meshes.rocket.count).toBe(1);
  });

  it("places each instance at its flight point, nose along the flight", () => {
    const projectiles = createProjectiles();
    projectiles.sync([rpg, rocket, landed], tick, view);
    const cases: [ProjectileState, "rpg" | "rocket", string][] = [
      [rpg, "rpg", "ru-rpg-gunner"],
      [rocket, "rocket", "ua-himars"],
    ];
    for (const [state, model, shooterType] of cases) {
      const render = WEAPONS[state.weapon]?.render;
      if (render === undefined) throw new Error("missing weapon");
      const expected = flightPoint(
        state,
        tick,
        render.flight as FlightProfile,
        muzzle(shooterType),
        render.apexCenti / 100,
      );
      const { position, forward } = pose(projectiles.meshes[model], 0);
      expect(position.x).toBeCloseTo(expected.x, 5);
      expect(position.y).toBeCloseTo(expected.z, 5);
      expect(position.z).toBeCloseTo(expected.y, 5);
      expect(forward.x).toBeCloseTo(expected.dx, 5);
      expect(forward.y).toBeCloseTo(expected.dz, 5);
      expect(forward.z).toBeCloseTo(expected.dy, 5);
    }
  });

  it("uses a 0.5 tile muzzle height when the shooter is not in the snapshot", () => {
    const projectiles = createProjectiles();
    projectiles.sync([rpg], 15, snapshot(20, []));
    const expected = flightPoint(rpg, 15, "boost", 0.5, 0);
    expect(pose(projectiles.meshes.rpg, 0).position.y).toBeCloseTo(
      expected.z,
      5,
    );
  });

  it("keeps projectiles out of the shadow pass", () => {
    const projectiles = createProjectiles();
    for (const model of PROJECTILE_MODELS) {
      expect(projectiles.meshes[model].castShadow).toBe(false);
    }
  });
});

describe("AC-17-14: launch effects and trails", () => {
  const rpgWeapon = weaponIndex("ru-rpg7");
  const rocketWeapon = weaponIndex("ru-tos-thermobaric");
  const stugnaWeapon = weaponIndex("ua-stugna-p");
  const gunner = entity(1, 1, "ru-rpg-gunner", 2, 3);
  const view = snapshot(16, [gunner]);

  function shot(
    weapon: number,
    extra: Partial<ProjectileState> = {},
  ): ProjectileState {
    return projectile({
      id: 7,
      owner: 1,
      weapon,
      shooter: gunner.id,
      originX: 2,
      originY: 3,
      impactX: 6,
      impactY: 3,
      launchTick: 15,
      impactTick: 25,
      ...extra,
    });
  }

  it("spawns the launch effects of a backblast projectile once", () => {
    const effects = createEffects();
    const projectiles = createProjectiles();
    const fired = shot(rpgWeapon);
    projectiles.spawnEffects([fired], 15, view, 0, effects);
    effects.update(0);
    expect(effects.counts().muzzle).toBe(1);
    expect(effects.counts().backblast).toBe(1);
    expect(effects.counts().trail).toBe(3);
    expect(effects.counts().dust).toBe(8);
    // The muzzle flash sits at origin - back × 0.3, the backblast behind it.
    expect(pose(effects.meshes.muzzle, 0).position.x).toBeCloseTo(2.3, 6);
    expect(pose(effects.meshes.backblast, 0).position.x).toBeCloseTo(1.65, 6);

    // The same id seen again is not launched twice.
    projectiles.spawnEffects([fired], 20.5, view, 20, effects);
    effects.update(20);
    expect(effects.counts().muzzle).toBe(1);
    expect(effects.counts().backblast).toBe(1);
    expect(effects.counts().trail).toBe(3);
    expect(effects.counts().dust).toBe(8);
  });

  it("moves the launch dust away from the shooter", () => {
    const effects = createEffects();
    const projectiles = createProjectiles();
    const fired = shot(rpgWeapon, { id: 8 });
    projectiles.spawnEffects([fired], 15, view, 0, effects);
    effects.update(0);
    const start = Math.hypot(
      pose(effects.meshes.dust, 0).position.x - gunner.x,
      pose(effects.meshes.dust, 0).position.z - gunner.y,
    );
    effects.update(500);
    const later = Math.hypot(
      pose(effects.meshes.dust, 0).position.x - gunner.x,
      pose(effects.meshes.dust, 0).position.z - gunner.y,
    );
    expect(start).toBeCloseTo(0.2, 6);
    expect(later).toBeGreaterThan(start + 0.4);
  });

  it("spawns launch smoke for a rocket launch", () => {
    const effects = createEffects();
    const projectiles = createProjectiles();
    const tos = entity(2, 0, "ru-tos-1a", 10, 10);
    const rocket = shot(rocketWeapon, {
      id: 9,
      shooter: tos.id,
      originX: 10,
      originY: 10,
      impactX: 20,
      impactY: 10,
    });
    projectiles.spawnEffects([rocket], 15, snapshot(16, [tos]), 0, effects);
    effects.update(0);
    expect(effects.counts().launchSmoke).toBe(6);
    expect(effects.counts().backblast).toBe(1);
    expect(effects.counts().muzzle).toBe(0);
  });

  it("adds a smoke trail every 40 ms in flight", () => {
    const effects = createEffects();
    const projectiles = createProjectiles();
    const missile = shot(stugnaWeapon, {
      id: 10,
      launchTick: 0,
      impactTick: 10,
    });
    const missileView = snapshot(1, [gunner]);
    projectiles.spawnEffects([missile], 0.5, missileView, 0, effects);
    effects.update(0);
    // A soft launch leaves two trail puffs of its own.
    expect(effects.counts().trail).toBe(2);
    projectiles.spawnEffects([missile], 0.5, missileView, 39, effects);
    effects.update(39);
    expect(effects.counts().trail).toBe(2);
    projectiles.spawnEffects([missile], 0.5, missileView, 40, effects);
    effects.update(40);
    expect(effects.counts().trail).toBe(3);
    projectiles.spawnEffects([missile], 0.5, missileView, 80, effects);
    effects.update(80);
    expect(effects.counts().trail).toBe(4);
  });
});
