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
    expect(relief?.heightAt(16, 16) ?? 0).toBeLessThan(-0.2);
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

  it("tints dust by the ground it rises from", () => {
    const rock = { strength: 0, color: 0, hardness: 1 };
    const snow = { strength: 0.9, color: 0, hardness: 0.1, snowy: true };
    expect(dustColorOf(rock)).toBe(0x8c8a84);
    expect(dustColorOf(snow)).toBe(0xe4e8ec);
    expect(DECALS.blasts.maxMarks).toBeGreaterThan(0);
  });
});
