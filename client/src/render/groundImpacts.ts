import ruleset from "@data/ruleset.json";
import { typeDef, WEAPONS } from "../rules";
import type { CombatSnapshot } from "../sim/combatSnapshot";
import type { EntityState, MatchSnapshot } from "../sim/matchSnapshot";
import { DECALS, type Decals, IMPACTS, type SurfaceSample } from "./decals";
import type { DecalCell } from "./decalTextures";
import type { Effects } from "./effects";
import { groundY } from "./elevation";
import type { TerrainDeformer } from "./terrainDeform";
import { createRng } from "./terrainTexture";

/** Ground impacts per weapon (spec 29): where a shot lands, the ground shows
 *  it — dust kicks and pocks for bullets, scorch and thrown clods for shells
 *  and missiles, a real crater with a rim and a dust wave for heavy
 *  ordnance. All of it is cosmetic and comes from `data/render/impacts.json`. */

export interface DustSpec {
  count: number;
  sizeTiles: number;
  spreadTiles: number;
  riseTiles: number;
  durationMs: number;
  alpha: number;
}

export interface ClodSpec {
  count: number;
  sizeTiles: number;
  speed: number;
  durationMs: number;
}

export interface PockSpec {
  radiusTiles: number;
  alpha: number;
}

export interface ScorchSpec {
  radiusTiles: number;
  splashFactor: number;
  alpha: number;
  variants: DecalCell[];
}

export interface CraterSpec {
  radiusTiles: number;
  splashFactor: number;
  depthPerRadius: number;
  /** Rim height as a share of the depth. */
  rim: number;
  /** Also stamp a ring of ejecta around the rim. */
  decal: boolean;
}

export interface ImpactProfile {
  /** Shots spread this far around the point they hit (near misses). */
  scatterTiles?: number;
  dust?: DustSpec;
  /** Fast, low dust thrown outward in a ring: the blast wave. */
  ring?: DustSpec;
  clods?: ClodSpec;
  pock?: PockSpec;
  scorch?: ScorchSpec;
  crater?: CraterSpec;
}

const DAMAGE_TYPES = ruleset.damageTypes as readonly string[];
/** Weapons that blow a vehicle up, and so leave the small death crater
 *  (spec 29 §3.6). */
const EXPLOSIVE = new Set(["antiTank", "highExplosive", "thermobaric"]);
const BY_DAMAGE_TYPE = IMPACTS.byDamageType as Record<string, ImpactProfile>;
const BY_WEAPON = IMPACTS.byWeapon as Record<string, Partial<ImpactProfile>>;

/** The ground impact of weapon `index`: its damage type's profile with the
 *  weapon's own sections on top. Null for an unknown weapon. */
export function impactProfile(index: number): ImpactProfile | null {
  const weapon = WEAPONS[index];
  if (weapon === undefined) return null;
  const damageType = DAMAGE_TYPES[weapon.damageType] ?? "";
  return { ...BY_DAMAGE_TYPE[damageType], ...BY_WEAPON[weapon.id] };
}

/** Tint of the dust a surface throws up. */
export function dustColorOf(sample: SurfaceSample): number {
  const colors = IMPACTS.dustColors;
  if (sample.strength <= 0) return Number(colors.rock);
  if (sample.snowy === true) return Number(colors.snow);
  const grass = DECALS.surfaces.grass.hardness;
  const dirt = DECALS.surfaces.dirt.hardness;
  const soil = Math.min(
    1,
    Math.max(0, (grass - sample.hardness) / (grass - dirt)),
  );
  return mixColor(Number(colors.grass), Number(colors.soil), soil);
}

function mixColor(from: number, to: number, amount: number): number {
  let result = 0;
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    result |= Math.round(a + (b - a) * amount) << shift;
  }
  return result;
}

/** Half extents (tiles) of a building, or null for anything else. */
function buildingHalf(entity: EntityState): [number, number] | null {
  const type = typeDef(entity.kind);
  if (type.category !== "building") return null;
  return [type.footprint[0] / 2, type.footprint[1] / 2];
}

export interface GroundImpacts {
  /** Spawns the impacts of the detonations of `combat` (they happened
   *  between the previous snapshot and `snapshot`). */
  record(snapshot: MatchSnapshot, combat: CombatSnapshot, nowMs: number): void;
  /** One impact of weapon `weapon` at tile (x, y). */
  impact(weapon: number, x: number, y: number, nowMs: number): void;
}

export function createGroundImpacts(
  effects: Effects,
  decals: Decals,
  relief: () => TerrainDeformer | null,
): GroundImpacts {
  /** Cosmetic only: never feeds the simulation. */
  const rng = createRng(0x1a9ac7);
  /** Launch point of every projectile seen in flight. */
  const origins = new Map<number, [number, number]>();
  const groundAt = (x: number, y: number): number =>
    relief()?.heightAt(x, y) ?? groundY(x, y);

  function spawnDust(
    spec: DustSpec,
    x: number,
    y: number,
    color: number,
    ring: boolean,
    nowMs: number,
  ): void {
    for (let i = 0; i < spec.count; i++) {
      const angle = ring
        ? ((i + rng() * 0.5) / spec.count) * Math.PI * 2
        : rng() * Math.PI * 2;
      const reach = spec.spreadTiles * (ring ? 0.8 + 0.4 * rng() : rng());
      const size = spec.sizeTiles * (0.7 + 0.6 * rng());
      const durationMs = spec.durationMs * (0.75 + 0.5 * rng());
      const seconds = durationMs / 1000;
      const start = ring ? 0.2 : 0.3 * rng();
      effects.spawn("dust", {
        x: x + Math.cos(angle) * spec.spreadTiles * start * 0.5,
        y: y + Math.sin(angle) * spec.spreadTiles * start * 0.5,
        height: groundAt(x, y) + size * 0.35,
        size,
        rotationY: rng() * Math.PI * 2,
        startMs: nowMs + (ring ? 0 : rng() * 60),
        durationMs,
        // Distance per second of life; `effects` eases it out.
        velocity: [
          (Math.cos(angle) * reach) / seconds,
          (Math.sin(angle) * reach) / seconds,
          (spec.riseTiles * (0.6 + 0.8 * rng())) / seconds,
        ],
        color: shade(color, 0.85 + 0.3 * rng()),
        alpha: spec.alpha,
      });
    }
  }

  function spawnClods(spec: ClodSpec, x: number, y: number, nowMs: number) {
    const ground = groundAt(x, y);
    for (let i = 0; i < spec.count; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = spec.speed * (0.4 + 0.6 * rng());
      const size = spec.sizeTiles * (0.6 + 0.8 * rng());
      effects.spawn("clod", {
        x,
        y,
        sizeXYZ: [size, size * 0.7, size * (0.8 + 0.4 * rng())],
        height: ground + size,
        ground: ground + size * 0.3,
        rotationY: rng() * Math.PI * 2,
        startMs: nowMs,
        durationMs: spec.durationMs * (0.7 + 0.6 * rng()),
        velocity: [
          Math.cos(angle) * speed * 0.5,
          Math.sin(angle) * speed * 0.5,
          speed * (0.8 + 0.6 * rng()),
        ],
        color: shade(Number(IMPACTS.clodColor), 0.8 + 0.4 * rng()),
      });
    }
  }

  function stampMark(
    cell: DecalCell,
    x: number,
    y: number,
    radius: number,
    color: number,
    alpha: number,
    sample: SurfaceSample,
    nowMs: number,
    lifeMs: number,
    fadeMs: number,
  ): void {
    const angle = rng() * Math.PI * 2;
    decals.stamp({
      x,
      y,
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      halfWidth: radius * (0.85 + 0.3 * rng()),
      halfLength: radius * (0.85 + 0.3 * rng()),
      cell,
      color,
      alpha: alpha * (0.75 + 0.25 * rng()),
      snowy: sample.snowy,
      startMs: nowMs,
      lifeMs,
      fadeMs,
    });
  }

  /** Every ground effect of `profile` at (x, y); `onBuilding` keeps only the
   *  dust (the shot struck a wall, not the ground). */
  function land(
    profile: ImpactProfile,
    splash: number,
    x: number,
    y: number,
    onBuilding: boolean,
    nowMs: number,
  ): void {
    const sample = decals.surfaceAt(x, y);
    const color = dustColorOf(sample);
    if (profile.dust !== undefined) {
      spawnDust(profile.dust, x, y, color, false, nowMs);
    }
    if (profile.ring !== undefined && !onBuilding) {
      spawnDust(profile.ring, x, y, color, true, nowMs);
    }
    if (onBuilding) return;
    // Rock shows scorches but keeps no pocks, clods or craters.
    const soil = sample.strength > 0;
    if (profile.clods !== undefined && soil) {
      spawnClods(profile.clods, x, y, nowMs);
    }
    const blasts = DECALS.blasts;
    if (profile.scorch !== undefined) {
      const spec = profile.scorch;
      const variants = spec.variants.length > 0 ? spec.variants : ["scorch"];
      // Zero Hour picks one of four scorch textures at random (spec 29 §2).
      const cell = variants[Math.floor(rng() * variants.length)] ?? "scorch";
      stampMark(
        cell as DecalCell,
        x,
        y,
        Math.max(spec.radiusTiles, splash * spec.splashFactor),
        Number(blasts.scorchColor),
        spec.alpha,
        sample,
        nowMs,
        blasts.lifetimeMs,
        blasts.fadeMs,
      );
    }
    if (profile.pock !== undefined && soil) {
      stampMark(
        "pock",
        x,
        y,
        profile.pock.radiusTiles,
        Number(blasts.pockColor),
        profile.pock.alpha * Math.min(1, 0.4 + sample.strength),
        sample,
        nowMs,
        IMPACTS.pockLifetimeMs,
        IMPACTS.pockFadeMs,
      );
    }
    if (profile.crater !== undefined && soil) {
      const spec = profile.crater;
      const radius = Math.max(spec.radiusTiles, splash * spec.splashFactor);
      const dug =
        relief()?.crater(
          x,
          y,
          radius,
          radius * spec.depthPerRadius,
          nowMs,
          spec.rim,
        ) ?? false;
      if (spec.decal && dug) {
        stampMark(
          "ejecta",
          x,
          y,
          radius * blasts.ejectaPerCrater,
          Number(blasts.ejectaColor),
          blasts.ejectaAlpha * Math.min(1, 0.4 + sample.strength),
          sample,
          nowMs,
          blasts.lifetimeMs,
          blasts.fadeMs,
        );
      }
    }
  }

  function impact(weapon: number, x: number, y: number, nowMs: number): void {
    const profile = impactProfile(weapon);
    if (profile === null) return;
    const splash = (WEAPONS[weapon]?.splashCenti ?? 0) / 100;
    land(profile, splash, x, y, false, nowMs);
  }

  /** A destroyed armoured vehicle digs only a small crater under its wreck,
   *  never the full shell crater of a ground hit (spec 29 §3.6). */
  function digUnitDeathCrater(x: number, y: number, nowMs: number): void {
    // Rock keeps no craters (spec 29 §3.3).
    if (decals.surfaceAt(x, y).strength <= 0) return;
    const spec = IMPACTS.unitDeathCrater;
    relief()?.crater(
      x,
      y,
      spec.radiusTiles,
      spec.radiusTiles * spec.depthPerRadius,
      nowMs,
      spec.rim,
    );
  }

  return {
    impact,
    record(snapshot, combat, nowMs) {
      const byId = new Map<number, EntityState>();
      for (const entity of snapshot.entities) byId.set(entity.id, entity);
      // A vehicle this snapshot removed is still a target: its death event
      // names the kind (spec 29 §3.6).
      const deadKinds = new Map<number, number>();
      for (const event of combat.events) {
        if (event.kind === "death")
          deadKinds.set(event.victim, event.victimKind);
      }
      for (const event of combat.events) {
        if (event.kind !== "detonate") continue;
        const profile = impactProfile(event.weapon);
        if (profile === null) continue;
        let x = event.x;
        let y = event.y;
        const scatter = profile.scatterTiles ?? 0;
        if (scatter > 0) {
          const angle = rng() * Math.PI * 2;
          const reach = scatter * Math.sqrt(rng());
          x += Math.cos(angle) * reach;
          y += Math.sin(angle) * reach;
        }
        // A shot into a building strikes its wall: the dust rises at the
        // wall facing the shooter and the ground under the roof stays clean.
        let onBuilding = false;
        const struck = event.hit === null ? undefined : byId.get(event.hit);
        const struckKind =
          struck?.kind ??
          (event.hit === null ? undefined : deadKinds.get(event.hit));
        const struckType =
          struckKind === undefined ? null : typeDef(struckKind);
        // The hull takes the hit: no dust, clods, scorch or crater under an
        // armoured vehicle, which would read as a ground hit (spec 29 §3.6).
        if (
          struckType !== null &&
          struckType.category === "unit" &&
          struckType.armor !== 0
        ) {
          continue;
        }
        const half = struck === undefined ? null : buildingHalf(struck);
        if (struck !== undefined && half !== null) {
          const from = origins.get(event.projectile) ?? [x - 1, y];
          const dx = from[0] - struck.x;
          const dy = from[1] - struck.y;
          const length = Math.hypot(dx, dy) || 1;
          // Distance from the centre to the footprint edge along (dx, dy).
          const edge = Math.min(
            Math.abs(dx) > 1e-6 ? half[0] / Math.abs(dx / length) : Infinity,
            Math.abs(dy) > 1e-6 ? half[1] / Math.abs(dy / length) : Infinity,
          );
          const reach = edge + IMPACTS.buildingStandOff;
          x = struck.x + (dx / length) * reach + (x - event.x) * 0.5;
          y = struck.y + (dy / length) * reach + (y - event.y) * 0.5;
          onBuilding = true;
        }
        const splash = (WEAPONS[event.weapon]?.splashCenti ?? 0) / 100;
        // A wall hit still throws dust; marks stay off the roof.
        land(profile, splash, x, y, onBuilding && scatter === 0, nowMs);
      }
      // Only the explosion of an armoured vehicle leaves a crater, and a
      // minimal one (spec 29 §3.6).
      for (const event of combat.events) {
        if (event.kind !== "death") continue;
        const type = typeDef(event.victimKind);
        if (type.category !== "unit" || type.armor === 0) continue;
        if (event.weapon === null) continue;
        const damageType =
          DAMAGE_TYPES[WEAPONS[event.weapon]?.damageType ?? -1] ?? "";
        if (!EXPLOSIVE.has(damageType)) continue;
        digUnitDeathCrater(event.x, event.y, nowMs);
      }
      // Remember where the flying projectiles came from, for wall hits.
      const flying = new Set<number>();
      for (const projectile of combat.projectiles) {
        flying.add(projectile.id);
        origins.set(projectile.id, [projectile.originX, projectile.originY]);
      }
      for (const id of origins.keys()) if (!flying.has(id)) origins.delete(id);
    },
  };
}

function shade(color: number, factor: number): number {
  return mixColor(0, color, Math.min(1, factor)) | 0;
}
