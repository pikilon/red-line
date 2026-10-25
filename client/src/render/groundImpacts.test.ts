import { describe, expect, it } from "vitest";
import { typeIndex, WEAPONS } from "../rules";
import type { CombatSnapshot } from "../sim/combatSnapshot";
import type { EntityState, MatchSnapshot } from "../sim/matchSnapshot";
import { createDecals, createTerrainSurface, DECALS } from "./decals";
import { createEffects } from "./effects";
import {
  createGroundImpacts,
  dustColorOf,
  impactProfile,
} from "./groundImpacts";
import { createTerrain, terrainDeformerOf } from "./terrain";

const weapon = (id: string): number =>
  WEAPONS.findIndex((entry) => entry.id === id);

function setup() {
  const terrain = createTerrain(32, 32, new Uint8Array(32 * 32), 1);
  const relief = terrainDeformerOf(terrain);
  const effects = createEffects();
  const decals = createDecals(
    createTerrainSurface(32, 32, new Uint8Array(32 * 32), 1),
  );
  const impacts = createGroundImpacts(effects, decals, () => relief);
  return { relief, effects, decals, impacts };
}

function snapshotWith(entities: EntityState[]): MatchSnapshot {
  return { tick: 1, entities } as unknown as MatchSnapshot;
}

function death(
  victimKind: number,
  weaponIndex: number | null,
  x: number,
  y: number,
): CombatSnapshot {
  return {
    projectiles: [],
    events: [
      {
        kind: "death",
        victim: 9,
        victimKind,
        killer: 1,
        weapon: weaponIndex,
        x,
        y,
      },
    ],
  };
}

function detonation(
  weaponIndex: number,
  x: number,
  y: number,
  hit: number | null = null,
): CombatSnapshot {
  return {
    projectiles: [],
    events: [
      {
        kind: "detonate",
        projectile: 1,
        owner: 0,
        weapon: weaponIndex,
        hit,
        x,
        y,
      },
    ],
  };
}

describe("ground impacts per weapon (spec 29)", () => {
  it("gives each damage type its own look, with weapon overrides", () => {
    const rifle = impactProfile(weapon("ru-ak74"));
    expect(rifle?.pock).toBeDefined();
    expect(rifle?.crater).toBeUndefined();
    const tank = impactProfile(weapon("ru-2a46m"));
    expect(tank?.scorch).toBeDefined();
    expect(tank?.crater?.radiusTiles).toBe(0.75);
    const rockets = impactProfile(weapon("ua-gmlrs"));
    expect(rockets?.crater?.decal).toBe(true);
    expect(rockets?.ring).toBeDefined();
    expect(impactProfile(-1)).toBeNull();
  });

  it("kicks dust and leaves a pock where a bullet lands", () => {
    const { effects, decals, impacts } = setup();
    impacts.record(snapshotWith([]), detonation(weapon("ru-ak74"), 10, 10), 0);
    effects.update(10);
    expect(effects.counts().dust).toBeGreaterThan(0);
    decals.update(10);
    expect(decals.count()).toBe(1);
  });

  it("digs a crater and throws clods for heavy ordnance", () => {
    const { relief, effects, impacts } = setup();
    impacts.record(snapshotWith([]), detonation(weapon("ua-gmlrs"), 16, 16), 0);
    relief?.update(1000);
    effects.update(100);
    expect(effects.counts().clod).toBeGreaterThan(0);
    expect(relief?.heightAt(16, 16) ?? 0).toBeLessThan(-0.1);
  });

  it("keeps craters shallow and marks their floor black", () => {
    // A tank shell leaves a shallow bowl with a scorch and the soot floor.
    const tank = setup();
    tank.impacts.record(
      snapshotWith([]),
      detonation(weapon("ru-2a46m"), 16, 16),
      0,
    );
    tank.relief?.update(1000);
    const shellDepth = -(tank.relief?.heightAt(16, 16) ?? 0);
    expect(shellDepth).toBeGreaterThan(0.03);
    expect(shellDepth).toBeLessThan(0.06);
    tank.decals.update(10);
    expect(tank.decals.count()).toBe(2);

    // The HE rocket digs the deepest profile, still under 0.21 tiles, and gets
    // the scorch, the ejecta ring and the soot floor.
    const rockets = setup();
    rockets.impacts.record(
      snapshotWith([]),
      detonation(weapon("ua-gmlrs"), 16, 16),
      0,
    );
    rockets.relief?.update(1000);
    const rocketDepth = -(rockets.relief?.heightAt(16, 16) ?? 0);
    expect(rocketDepth).toBeGreaterThan(0.1);
    expect(rocketDepth).toBeLessThan(0.13);
    rockets.decals.update(10);
    expect(rockets.decals.count()).toBe(3);
  });

  it("does not stack soot into a well on repeated hits at one spot", () => {
    const { decals, impacts } = setup();
    for (let i = 0; i < 5; i++) {
      impacts.record(
        snapshotWith([]),
        detonation(weapon("ua-gmlrs"), 16, 16),
        i * 500,
      );
    }
    decals.update(2500);
    // Each hit still adds its scorch and ejecta (2), but the black footprint
    // inside the hole stays one layer (3 + 4 × 2) instead of five (15).
    expect(decals.count()).toBe(11);
  });

  it("keeps marks off the roof when a shell strikes a building", () => {
    const { relief, decals, impacts } = setup();
    const hq = {
      id: 7,
      kind: typeIndex("ru-hq"),
      x: 16,
      y: 16,
    } as unknown as EntityState;
    impacts.record(
      snapshotWith([hq]),
      detonation(weapon("ru-2a46m"), 16, 16, 7),
      0,
    );
    relief?.update(1000);
    decals.update(10);
    expect(decals.count()).toBe(0);
    expect(relief?.heightAt(16, 16)).toBe(0);
  });

  it("leaves the ground clean when a shell strikes an armoured vehicle", () => {
    const { relief, effects, decals, impacts } = setup();
    const tank = {
      id: 9,
      kind: typeIndex("ua-leopard-2a4"),
      x: 16,
      y: 16,
    } as unknown as EntityState;
    impacts.record(
      snapshotWith([tank]),
      detonation(weapon("ru-2a46m"), 16, 16, 9),
      0,
    );
    relief?.update(1000);
    effects.update(100);
    decals.update(10);
    // The hull takes the hit: no scorch, no dust and no crater under it.
    expect(decals.count()).toBe(0);
    expect(effects.counts().dust).toBe(0);
    expect(relief?.heightAt(16, 16)).toBe(0);
  });

  it("digs only a minimal crater when an armoured vehicle explodes", () => {
    const { relief, impacts } = setup();
    impacts.record(
      snapshotWith([]),
      death(typeIndex("ua-leopard-2a4"), weapon("ua-stugna-p"), 16, 16),
      0,
    );
    relief?.update(1000);
    const depth = -(relief?.heightAt(16, 16) ?? 0);
    expect(depth).toBeGreaterThan(0.03);
    expect(depth).toBeLessThan(0.1);
  });

  it("leaves no crater when an armoured vehicle is not blown up", () => {
    const { relief, impacts } = setup();
    impacts.record(
      snapshotWith([]),
      death(typeIndex("ua-leopard-2a4"), weapon("ua-rifle"), 16, 16),
      0,
    );
    relief?.update(1000);
    expect(relief?.heightAt(16, 16)).toBe(0);
  });

  it("tints dust by the ground it rises from", () => {
    const rock = { strength: 0, color: 0, hardness: 1 };
    const snow = { strength: 0.9, color: 0, hardness: 0.1, snowy: true };
    expect(dustColorOf(rock)).toBe(0x8c8a84);
    expect(dustColorOf(snow)).toBe(0xe4e8ec);
    expect(DECALS.blasts.maxMarks).toBeGreaterThan(0);
  });
});
