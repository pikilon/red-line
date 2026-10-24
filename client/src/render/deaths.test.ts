import { Color, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { typeDef, typeIndex } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  type MatchSnapshot,
  NEUTRAL,
} from "../sim/matchSnapshot";
import {
  createDeathCauses,
  detectDeaths,
  detectHits,
  spawnDeathEffects,
  spawnHitBlood,
} from "./deaths";
import { createEffects } from "./effects";

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

describe("death detection", () => {
  it("AC-07-03: death detection", () => {
    // Full hp (250 > the 200 largest hit against light armor) but targeted:
    // only the `fired` target marks it as a death.
    const killed = entity(1, 1, "ua-kozak-scout", 10, 10, 250);
    const shooter = entity(2, 0, "ru-rifleman", 12, 10, 90, {
      flags: ENTITY_FLAGS.fired,
      target: 1,
    });
    // Full hp and untargeted: its hp (250) exceeds the largest single hit
    // against light armor (200), so leaving vision is not a death.
    const walker = entity(3, 0, "ua-kozak-scout", 3, 3, 250);
    const ghost = entity(4, 1, "ru-hq", 30, 30, 3000, {
      flags: ENTITY_FLAGS.ghost,
    });
    const depot = entity(5, NEUTRAL, "supply-depot", 20, 20, 5000);
    const building = entity(6, 1, "ua-barracks", 25, 25, 1000);
    const alreadyDead = entity(7, 0, "ua-rifleman", 40, 40, 0);

    const prev = snapshot(10, [
      killed,
      shooter,
      walker,
      ghost,
      depot,
      building,
      alreadyDead,
    ]);
    const next = snapshot(11, [shooter, ghost, depot, alreadyDead]);

    expect(detectDeaths(prev, next, 0).map((dead) => dead.id)).toEqual([1, 6]);

    // A non-advancing tick reports nothing.
    expect(detectDeaths(prev, snapshot(10, [shooter]), 0)).toEqual([]);
  });
});

describe("death effects", () => {
  it("AC-07-04: death effects and gore filter", () => {
    const effects = createEffects();
    const vehicle = entity(1, 0, "ua-leopard-2a4", 5, 5, 100);
    const infantry = entity(2, 0, "ua-rifleman", 6, 6, 100);
    const shooter = entity(3, 1, "ru-rifleman", 7, 5, 90, {
      flags: ENTITY_FLAGS.fired,
      target: 1,
    });
    const prev = snapshot(1, [vehicle, infantry, shooter]);
    const next = snapshot(2, [shooter]);
    const deaths = detectDeaths(prev, next, 0);
    expect([...deaths.map((dead) => dead.id)].sort()).toEqual([1, 2]);

    // Gore on: a wreck, a body and blood.
    spawnDeathEffects(deaths, effects, true, 0);
    effects.update(0);
    expect(effects.meshes.wreck.count).toBe(1);
    expect(effects.meshes.body.count).toBe(1);
    expect(effects.meshes.blood.count).toBeGreaterThan(0);

    // Gore off: no blood.
    effects.clear();
    spawnDeathEffects(deaths, effects, false, 0);
    effects.update(0);
    expect(effects.meshes.wreck.count).toBe(1);
    expect(effects.meshes.body.count).toBe(1);
    expect(effects.meshes.blood.count).toBe(0);

    // Turning gore off removes live blood decals.
    effects.clear();
    spawnDeathEffects(deaths, effects, true, 0);
    effects.update(0);
    expect(effects.meshes.blood.count).toBeGreaterThan(0);
    effects.clear("blood");
    effects.update(0);
    expect(effects.meshes.blood.count).toBe(0);
  });

  it("AC-09-05: debris", () => {
    const effects = createEffects();
    // Centered on the origin keeps the piece coordinates small, so the check
    // matches the §6 formulas to full double precision despite the Matrix4
    // round-trip.
    const building = entity(6, 1, "ua-barracks", 0, 0, 1000);

    // A dead building spawns eight debris pieces and no wreck at the §6 positions.
    spawnDeathEffects([building], effects, true, 0);
    effects.update(0);
    expect(effects.meshes.wreck.count).toBe(0);
    expect(effects.meshes.debris.count).toBe(8);

    // Each piece i matches §6 exactly: angle, radius, position and size.
    const type = typeDef(building.kind);
    const [width, , depth] = type.render.size.map((size) => size / 100) as [
      number,
      number,
      number,
    ];
    const id = building.id;
    const matrix = new Matrix4();
    const pos = new Vector3();
    const q = new Quaternion();
    const scale = new Vector3();
    for (let i = 0; i < 8; i++) {
      const angle = (i * 2 * Math.PI) / 8 + id * 0.7;
      const radius = ((0.25 + 0.15 * (i % 3)) * Math.min(width, depth)) / 2;
      const s = 0.2 + 0.1 * ((id + i) % 3);
      const expectedX = building.x + Math.cos(angle) * radius;
      const expectedY = building.y + Math.sin(angle) * radius;
      effects.meshes.debris.getMatrixAt(i, matrix);
      matrix.decompose(pos, q, scale);
      // Values are read back through Three.js's Matrix4, so allow its ~1e-8
      // round-trip error (6 decimals) while still catching any wrong formula.
      expect(pos.x).toBeCloseTo(expectedX, 6);
      expect(pos.y).toBeCloseTo((s * 0.8) / 2, 6);
      expect(pos.z).toBeCloseTo(expectedY, 6);
      expect(scale.x).toBeCloseTo(s, 6);
      expect(scale.y).toBeCloseTo(s * 0.8, 6);
      expect(scale.z).toBeCloseTo(s, 6);
    }

    // A dead vehicle or infantry spawns no debris.
    effects.clear();
    const vehicle = entity(1, 0, "ua-leopard-2a4", 5, 5, 100);
    spawnDeathEffects([vehicle], effects, true, 0);
    effects.update(0);
    expect(effects.meshes.debris.count).toBe(0);

    effects.clear();
    const infantry = entity(2, 0, "ua-rifleman", 6, 6, 100);
    spawnDeathEffects([infantry], effects, true, 0);
    effects.update(0);
    expect(effects.meshes.debris.count).toBe(0);

    // Debris expires after 15 s.
    effects.clear();
    spawnDeathEffects([building], effects, true, 0);
    effects.update(0);
    expect(effects.meshes.debris.count).toBe(8);
    effects.update(15_000);
    expect(effects.meshes.debris.count).toBe(0);
  });

  it("AC-10-05: building debris only", () => {
    const effects = createEffects();
    // Centered on the origin keeps the piece coordinates small, so the check
    // matches the §6 formulas to full double precision despite the Matrix4
    // round-trip.
    const building = entity(6, 1, "ua-barracks", 0, 0, 1000);

    // A dead building spawns eight debris and no wreck (spec 10 §6, AC-10-05).
    spawnDeathEffects([building], effects, true, 0);
    effects.update(0);
    expect(effects.meshes.wreck.count).toBe(0);
    expect(effects.meshes.debris.count).toBe(8);
    // The debris colour is 0x4a4038 (spec 10 §6, AC-10-05).
    const debrisColor = new Color();
    effects.meshes.debris.getColorAt(0, debrisColor);
    expect(debrisColor.getHex()).toBe(0x4a4038);

    // Each piece i matches §6 exactly: angle, radius, position and size (height s × 0.8).
    const type = typeDef(building.kind);
    const [width, , depth] = type.render.size.map((size) => size / 100) as [
      number,
      number,
      number,
    ];
    const id = building.id;
    const matrix = new Matrix4();
    const pos = new Vector3();
    const q = new Quaternion();
    const scale = new Vector3();
    for (let i = 0; i < 8; i++) {
      const angle = (i * 2 * Math.PI) / 8 + id * 0.7;
      const radius = ((0.25 + 0.15 * (i % 3)) * Math.min(width, depth)) / 2;
      const s = 0.2 + 0.1 * ((id + i) % 3);
      const expectedX = building.x + Math.cos(angle) * radius;
      const expectedY = building.y + Math.sin(angle) * radius;
      effects.meshes.debris.getMatrixAt(i, matrix);
      matrix.decompose(pos, q, scale);
      // Values are read back through Three.js's Matrix4, so allow its ~1e-8
      // round-trip error (6 decimals) while still catching any wrong formula.
      expect(pos.x).toBeCloseTo(expectedX, 6);
      expect(pos.y).toBeCloseTo((s * 0.8) / 2, 6);
      expect(pos.z).toBeCloseTo(expectedY, 6);
      expect(scale.x).toBeCloseTo(s, 6);
      expect(scale.y).toBeCloseTo(s * 0.8, 6);
      expect(scale.z).toBeCloseTo(s, 6);
    }

    // A dead vehicle still spawns one wreck and no debris (spec 10 §6, AC-10-05).
    effects.clear();
    const vehicle = entity(1, 0, "ua-leopard-2a4", 5, 5, 100);
    spawnDeathEffects([vehicle], effects, true, 0);
    effects.update(0);
    expect(effects.meshes.wreck.count).toBe(1);
    expect(effects.meshes.debris.count).toBe(0);

    // Debris expires after 15 s.
    effects.clear();
    spawnDeathEffects([building], effects, true, 0);
    effects.update(0);
    expect(effects.meshes.debris.count).toBe(8);
    effects.update(15_000);
    expect(effects.meshes.debris.count).toBe(0);
  });
});

describe("hit detection (spec 22 §6)", () => {
  it("reports soldiers that lost hp and lived, harder for blasts", () => {
    const causes = createDeathCauses();
    const hurt = entity(1, 0, "ua-rifleman", 12, 10, 90);
    const rifle = entity(2, 1, "ru-rifleman", 5, 10, 90, {
      flags: ENTITY_FLAGS.fired,
      target: 1,
    });
    causes.record([hurt, rifle], 1000);
    const prev = snapshot(1, [entity(1, 0, "ua-rifleman", 12, 10, 90), rifle]);
    const next = snapshot(2, [entity(1, 0, "ua-rifleman", 12, 10, 80), rifle]);
    const [hit] = detectHits(prev, next, causes, 1100);
    expect(hit?.id).toBe(1);
    expect(hit?.push).toBeCloseTo(0);
    expect(hit?.amplitude).toBeGreaterThan(0.1);
    expect(hit?.amplitude).toBeLessThanOrEqual(0.7);

    const blasts = createDeathCauses();
    const rpg = entity(3, 1, "ru-rpg-gunner", 5, 10, 90, {
      flags: ENTITY_FLAGS.fired,
      target: 1,
    });
    blasts.record([hurt, rpg], 1000);
    const [blast] = detectHits(prev, next, blasts, 1100);
    expect(blast?.amplitude).toBeGreaterThan(hit?.amplitude ?? 1);
  });

  it("skips the unhurt, the dead and what is not a soldier", () => {
    const causes = createDeathCauses();
    const prev = snapshot(1, [
      entity(1, 0, "ua-rifleman", 1, 1, 90),
      entity(2, 0, "ua-rifleman", 2, 2, 90),
      entity(3, 0, "ua-leopard-2a4", 3, 3, 500),
    ]);
    const next = snapshot(2, [
      entity(1, 0, "ua-rifleman", 1, 1, 90),
      entity(2, 0, "ua-rifleman", 2, 2, 0),
      entity(3, 0, "ua-leopard-2a4", 3, 3, 300),
    ]);
    expect(detectHits(prev, next, causes, 0)).toEqual([]);
    expect(detectHits(next, prev, causes, 0)).toEqual([]);
  });
});

describe("blood of a wound (spec 22 §6)", () => {
  const hit = (amplitude: number, health = 0.4) => ({
    id: 4,
    x: 10,
    y: 10,
    push: 0,
    amplitude,
    health,
  });

  it("only bleeds under 60 % of his hp: above it the hit just jolts him", () => {
    const effects = createEffects();
    spawnHitBlood([hit(0.5, 0.6), hit(0.5, 0.9)], effects, true, 0);
    effects.update(100);
    expect(effects.meshes.droplet.count).toBe(0);
    effects.update(6000);
    expect(effects.meshes.blood.count).toBe(0);
    spawnHitBlood([hit(0.2, 0.59)], effects, true, 7000);
    effects.update(7060);
    expect(effects.meshes.droplet.count).toBeGreaterThan(0);
  });

  it("throws a fan of droplets, more for a hard hit, that land and stain the ground", () => {
    const light = createEffects();
    spawnHitBlood([hit(0.12)], light, true, 0);
    light.update(250);
    const hard = createEffects();
    spawnHitBlood([hit(0.5)], hard, true, 0);
    hard.update(250);
    expect(light.meshes.droplet.count).toBe(3);
    expect(hard.meshes.droplet.count).toBeGreaterThan(
      light.meshes.droplet.count,
    );
    // Nothing on the ground until the first drop lands, then one splat each.
    expect(hard.meshes.blood.count).toBe(0);
    // Frames come in order, so every drop is drawn once before it lands.
    hard.update(700);
    hard.update(3000);
    expect(hard.meshes.droplet.count).toBe(0);
    expect(hard.meshes.blood.count).toBe(5);
  });

  it("flies the drops out along the push, up and down again", () => {
    const effects = createEffects();
    spawnHitBlood([hit(0.5)], effects, true, 0);
    effects.update(150);
    const matrix = new Matrix4();
    const at = new Vector3();
    let farthest = 0;
    let highest = 0;
    for (let i = 0; i < effects.meshes.droplet.count; i++) {
      effects.meshes.droplet.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      farthest = Math.max(farthest, at.x - 10);
      highest = Math.max(highest, at.y);
    }
    expect(farthest).toBeGreaterThan(0);
    expect(highest).toBeGreaterThan(0.3);
  });

  it("the splats of the drops are small", () => {
    const effects = createEffects();
    spawnHitBlood([hit(0.5)], effects, true, 0);
    effects.update(3000);
    const matrix = new Matrix4();
    const q = new Quaternion();
    const position = new Vector3();
    const scale = new Vector3();
    for (let i = 0; i < effects.meshes.blood.count; i++) {
      effects.meshes.blood.getMatrixAt(i, matrix);
      matrix.decompose(position, q, scale);
      expect(scale.x).toBeLessThan(0.3);
      expect(scale.z).toBeLessThan(0.06);
    }
  });

  it("shows no blood without gore", () => {
    const effects = createEffects();
    spawnHitBlood([hit(0.5)], effects, false, 0);
    effects.update(1000);
    expect(effects.meshes.droplet.count).toBe(0);
    expect(effects.meshes.blood.count).toBe(0);
  });

  it("dries up sooner than a pool", () => {
    const effects = createEffects();
    spawnHitBlood([hit(0.5)], effects, true, 0);
    effects.update(3000);
    expect(effects.meshes.blood.count).toBe(5);
    effects.update(14_000);
    expect(effects.meshes.blood.count).toBe(0);
  });
});
