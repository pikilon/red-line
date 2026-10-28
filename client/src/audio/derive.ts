// Read-only snapshot diff & combat event consumer for client audio (specs/25-audio.md §5.2, §6, §8).
// Never mutates sim state; derives `AudioPlayRequest`, EVA triggers, construction loops and
// building damage purely from snapshots.
//
// Adding a trigger: add the event id to data/audio/events.yaml (or eva.yaml),
// map it in reference.yaml, then push the request from the loop below. The
// client never needs sim changes for a new sound; if a fact is missing (a
// production-ready flag, a surface type...), add an output-only snapshot field
// and document it in the phase PR (spec 25 §8).

import ruleset from "@data/ruleset.json";
import { RULES, typeDef, WEAPONS } from "../rules";
import type { CombatSnapshot } from "../sim/combatSnapshot";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  type MatchSnapshot,
  OBSERVER,
} from "../sim/matchSnapshot";
import type {
  AudioCatalog,
  AudioPlayRequest,
  ConstructionLoopState,
  PlayerRelation,
  UnitLoopState,
} from "./types";

const DAMAGE_TYPES: readonly string[] = ruleset.damageTypes;
/** Turret slew per snapshot (65536 units per turn) that counts as moving: ~0.8°. */
const TURRET_SLEW_MIN = 150;

function wrapAngle(delta: number): number {
  return ((((delta + 32768) % 65536) + 65536) % 65536) - 32768;
}

export interface ScreenProjector {
  /** Projects world tile `(x, y)` to normalized screen X in `[-1, 1]` and `onScreen` flag. */
  projectTile(
    tileX: number,
    tileY: number,
  ): { screenX: number; onScreen: boolean };
  /** Returns true when tile `(x, y)` is currently in clear vision (`fog === 2`). */
  isTileVisible(tileX: number, tileY: number): boolean;
}

export interface DerivedAudioBatch {
  requests: { request: AudioPlayRequest; fallbackCategory?: string }[];
  evaEvents: string[];
  /** Buildings that need an `UnderConstructionLoop` this snapshot. */
  constructionLoops: ConstructionLoopState[];
  unitLoops: UnitLoopState[];
  combatActive: boolean;
}

function relationOf(owner: number, localPlayer: number): PlayerRelation {
  if (localPlayer === OBSERVER || owner === localPlayer) return "self";
  if (owner === 255) return "neutral";
  return "enemy";
}

function resolveWeaponFireEvent(
  catalog: AudioCatalog,
  weaponIdx: number,
): string {
  const weapon = WEAPONS[weaponIdx];
  if (!weapon) return "weapon.smallArms.fire";
  const byId = `weapon.${weapon.id}.fire`;
  if (catalog.events[byId]) return byId;
  const dmgName = DAMAGE_TYPES[weapon.damageType] ?? "smallArms";
  const byDmg = `weapon.${dmgName}.fire`;
  if (catalog.events[byDmg]) return byDmg;
  const byLaunch = `weapon.${weapon.render.launch}.fire`;
  if (catalog.events[byLaunch]) return byLaunch;
  return "weapon.smallArms.fire";
}

function resolveImpactEvent(catalog: AudioCatalog, weaponIdx: number): string {
  const weapon = WEAPONS[weaponIdx];
  if (!weapon) return "impact.smallArms";
  const byId = `impact.${weapon.id}`;
  if (catalog.events[byId]) return byId;
  const dmgName = DAMAGE_TYPES[weapon.damageType] ?? "smallArms";
  const byDmg = `impact.${dmgName}`;
  if (catalog.events[byDmg]) return byDmg;
  return weapon.damage >= 35 ? "impact.heavy" : "impact.light";
}

function resolveExplosionEvent(weaponIdx: number): string | null {
  const weapon = WEAPONS[weaponIdx];
  if (!weapon) return null;
  if (weapon.splashCenti >= 150 || weapon.damage >= 70)
    return "explosion.large";
  if (weapon.splashCenti > 0 || weapon.damage >= 30) return "explosion.medium";
  return null;
}

function locomotorKindOf(typeIdx: number): "foot" | "wheels" | "tracks" | null {
  const t = RULES.types[typeIdx];
  if (!t || t.locomotor < 0) return null;
  return RULES.locomotors[t.locomotor]?.kind ?? null;
}

/**
 * Derives audio play requests and EVA triggers from the transition
 * `prev -> next` and `combat`.
 */
export function deriveSnapshotAudio(
  prev: MatchSnapshot | null,
  next: MatchSnapshot,
  combat: CombatSnapshot,
  localPlayer: number,
  projector: ScreenProjector,
  catalog: AudioCatalog,
): DerivedAudioBatch {
  const requests: { request: AudioPlayRequest; fallbackCategory?: string }[] =
    [];
  const evaEvents: string[] = [];
  const constructionLoops: ConstructionLoopState[] = [];
  const unitLoops: UnitLoopState[] = [];
  let combatActive = false;

  const isFirstSnapshot = prev === null || prev.tick === 0;
  const prevTick = prev?.tick ?? next.tick;
  const prevById = new Map<number, EntityState>();
  if (prev) {
    for (const e of prev.entities) prevById.set(e.id, e);
  }
  const nextById = new Map<number, EntityState>();
  for (const e of next.entities) nextById.set(e.id, e);

  // Track entities killed on this tick so underFire doesn't play alongside die (spec 25 §6.4)
  const killedIds = new Set<number>();
  for (const ev of combat.events) {
    if (ev.kind === "death") killedIds.add(ev.victim);
  }

  // 1. Projectiles launched since prev.tick -> weapon fire sound at origin
  const shootersWithProjectile = new Set<number>();
  for (const proj of combat.projectiles) {
    if (proj.launchTick > prevTick && proj.launchTick <= next.tick) {
      shootersWithProjectile.add(proj.shooter);
      const { screenX, onScreen } = projector.projectTile(
        proj.originX,
        proj.originY,
      );
      requests.push({
        request: {
          eventId: resolveWeaponFireEvent(catalog, proj.weapon),
          entityId: proj.shooter,
          ownerPlayer: proj.owner,
          relation: relationOf(proj.owner, localPlayer),
          tileX: proj.originX,
          tileY: proj.originY,
          screenX,
          onScreen,
          tileVisible: projector.isTileVisible(proj.originX, proj.originY),
        },
      });
    }
  }

  // 1b. Entities with `fired` flag that did not spawn a projectile in this snapshot
  for (const entity of next.entities) {
    if (
      hasFlag(entity, ENTITY_FLAGS.fired) &&
      !shootersWithProjectile.has(entity.id)
    ) {
      const def = typeDef(entity.kind);
      if (def.weapon >= 0) {
        const { screenX, onScreen } = projector.projectTile(entity.x, entity.y);
        requests.push({
          request: {
            eventId: resolveWeaponFireEvent(catalog, def.weapon),
            entityId: entity.id,
            ownerPlayer: entity.owner,
            relation: relationOf(entity.owner, localPlayer),
            tileX: entity.x,
            tileY: entity.y,
            screenX,
            onScreen,
            tileVisible: projector.isTileVisible(entity.x, entity.y),
          },
        });
      }
    }
  }

  // 2. Combat events: detonations and deaths
  for (const ev of combat.events) {
    if (ev.kind === "detonate") {
      combatActive = true;
      const { screenX, onScreen } = projector.projectTile(ev.x, ev.y);
      const tileVisible = projector.isTileVisible(ev.x, ev.y);
      const relation = relationOf(ev.owner, localPlayer);

      const impactId = resolveImpactEvent(catalog, ev.weapon);
      requests.push({
        request: {
          eventId: impactId,
          ownerPlayer: ev.owner,
          relation,
          tileX: ev.x,
          tileY: ev.y,
          screenX,
          onScreen,
          tileVisible,
        },
      });

      const explosionId = resolveExplosionEvent(ev.weapon);
      if (explosionId && catalog.events[explosionId]) {
        requests.push({
          request: {
            eventId: explosionId,
            ownerPlayer: ev.owner,
            relation,
            tileX: ev.x,
            tileY: ev.y,
            screenX,
            onScreen,
            tileVisible,
          },
        });
      }

      // Under fire check for own hit entities that survive this tick
      if (ev.hit !== null && !killedIds.has(ev.hit)) {
        const hitEntity = nextById.get(ev.hit) ?? prevById.get(ev.hit);
        if (hitEntity && relationOf(hitEntity.owner, localPlayer) === "self") {
          const hitDef = typeDef(hitEntity.kind);
          if (hitDef.category === "building") {
            evaEvents.push("baseUnderAttack");
          } else if (hitDef.category === "unit") {
            const loco = locomotorKindOf(hitEntity.kind) ?? "unit";
            requests.push({
              request: {
                eventId: `voice.${hitDef.id}.underFire`,
                entityId: hitEntity.id,
                ownerPlayer: hitEntity.owner,
                relation: "self",
                tileX: hitEntity.x,
                tileY: hitEntity.y,
                screenX,
                onScreen,
                tileVisible: true,
                isUnderFire: true,
              },
              fallbackCategory:
                loco === "wheels"
                  ? "wheeled"
                  : loco === "tracks"
                    ? "tracked"
                    : loco,
            });
          }
        }
      }
    } else if (ev.kind === "death") {
      combatActive = true;
      const victimPrev = prevById.get(ev.victim);
      const victimOwner = victimPrev?.owner ?? 0;
      const victimRelation = relationOf(victimOwner, localPlayer);
      const victimDef = typeDef(ev.victimKind);
      const { screenX, onScreen } = projector.projectTile(ev.x, ev.y);
      const tileVisible = projector.isTileVisible(ev.x, ev.y);

      if (victimDef.category === "building") {
        requests.push({
          request: {
            eventId: "building.die",
            entityId: ev.victim,
            ownerPlayer: victimOwner,
            relation: victimRelation,
            tileX: ev.x,
            tileY: ev.y,
            screenX,
            onScreen,
            tileVisible,
          },
        });
        if (victimRelation === "self") {
          evaEvents.push("buildingLost");
        }
      } else if (victimDef.category === "unit") {
        const loco = locomotorKindOf(ev.victimKind);
        const isInfantry = loco === "foot";
        requests.push({
          request: {
            eventId: isInfantry
              ? `voice.${victimDef.id}.die`
              : "explosion.medium",
            entityId: ev.victim,
            ownerPlayer: victimOwner,
            relation: victimRelation,
            tileX: ev.x,
            tileY: ev.y,
            screenX,
            onScreen,
            tileVisible,
            infantryScream: isInfantry,
          },
          fallbackCategory: isInfantry ? "foot" : "tracked",
        });
        if (victimRelation === "self") {
          evaEvents.push("unitLost");
        }
      }
    }
  }

  // 3. Entity state transitions and discrete movement-start sounds
  for (const entity of next.entities) {
    const def = typeDef(entity.kind);
    const prevEntity = prevById.get(entity.id);
    const rel = relationOf(entity.owner, localPlayer);
    const { screenX, onScreen } = projector.projectTile(entity.x, entity.y);
    const tileVisible = projector.isTileVisible(entity.x, entity.y);

    // A damaged building gets an impact sound. Crossing the half-health line
    // uses the heavier `BuildingDamagedStateLight` variant; a building that
    // dies on this tick plays its death sound instead.
    if (
      prevEntity &&
      def.category === "building" &&
      entity.hp < prevEntity.hp &&
      !killedIds.has(entity.id)
    ) {
      const before = def.hp > 0 ? prevEntity.hp / def.hp : 1;
      const after = def.hp > 0 ? entity.hp / def.hp : 1;
      // Zero Hour `SoundOnDamaged` fires when crossing the light-damage line
      // and `SoundOnReallyDamaged` at the heavy one. Other hits are impacts.
      const eventId =
        before > 0.25 && after <= 0.25
          ? "building.damage.critical"
          : before > 0.5 && after <= 0.5
            ? "building.damage.heavy"
            : "building.damage";
      requests.push({
        request: {
          eventId,
          entityId: entity.id,
          ownerPlayer: entity.owner,
          relation: rel,
          tileX: entity.x,
          tileY: entity.y,
          screenX,
          onScreen,
          tileVisible,
        },
      });
    }

    // Vehicles have their own `SoundOnDamaged` state sound (the same sample
    // family as the building state, at a different volume).
    if (
      prevEntity &&
      def.category === "unit" &&
      locomotorKindOf(entity.kind) !== "foot" &&
      prevEntity.hp > def.hp * 0.5 &&
      entity.hp <= def.hp * 0.5 &&
      entity.hp > 0 &&
      !killedIds.has(entity.id)
    ) {
      requests.push({
        request: {
          eventId: "vehicle.damage",
          entityId: entity.id,
          ownerPlayer: entity.owner,
          relation: rel,
          tileX: entity.x,
          tileY: entity.y,
          screenX,
          onScreen,
          tileVisible,
        },
      });
    }

    // Zero Hour runs `UnderConstructionLoop` while a structure is being built.
    if (
      def.category === "building" &&
      hasFlag(entity, ENTITY_FLAGS.underConstruction) &&
      !hasFlag(entity, ENTITY_FLAGS.ghost)
    ) {
      constructionLoops.push({
        entityId: entity.id,
        tileX: entity.x,
        tileY: entity.y,
        screenX,
        onScreen,
        tileVisible,
        relation: rel,
      });
    }

    // Our loops after Zero Hour's `GenericTankMoveLoop` / `TurretMoveLoop`:
    // tracks or wheels while a vehicle drives, servos while its turret or
    // launcher slews relative to the hull (owner, 2026-10-27).
    const loco = locomotorKindOf(entity.kind);
    if (def.category === "unit" && (loco === "tracks" || loco === "wheels")) {
      const base = {
        entityId: entity.id,
        tileX: entity.x,
        tileY: entity.y,
        screenX,
        onScreen,
        tileVisible,
        relation: rel,
      };
      if (hasFlag(entity, ENTITY_FLAGS.moving)) {
        unitLoops.push({
          ...base,
          eventId: loco === "tracks" ? "move.loop.tracks" : "move.loop.wheels",
        });
      }
      if (
        prevEntity &&
        Math.abs(
          wrapAngle(
            entity.turretAngle -
              entity.heading -
              (prevEntity.turretAngle - prevEntity.heading),
          ),
        ) > TURRET_SLEW_MIN
      ) {
        unitLoops.push({ ...base, eventId: "move.turret" });
      }
    }

    if (!isFirstSnapshot && !prevEntity) {
      // Newly spawned/placed entity
      if (rel === "self") {
        if (
          def.category === "unit" &&
          !hasFlag(entity, ENTITY_FLAGS.underConstruction)
        ) {
          requests.push({
            request: {
              eventId: `voice.${def.id}.created`,
              entityId: entity.id,
              ownerPlayer: entity.owner,
              relation: "self",
              tileX: entity.x,
              tileY: entity.y,
              screenX,
              onScreen: true,
              tileVisible: true,
            },
          });
          evaEvents.push("productionComplete");
        } else if (def.category === "building") {
          requests.push({
            request: {
              eventId: hasFlag(entity, ENTITY_FLAGS.underConstruction)
                ? "building.place"
                : "building.complete",
              entityId: entity.id,
              ownerPlayer: entity.owner,
              relation: "self",
              tileX: entity.x,
              tileY: entity.y,
              screenX,
              onScreen,
              tileVisible: true,
            },
          });
        }
      }
    } else if (prevEntity) {
      // Building finished construction
      if (
        def.category === "building" &&
        hasFlag(prevEntity, ENTITY_FLAGS.underConstruction) &&
        !hasFlag(entity, ENTITY_FLAGS.underConstruction) &&
        !hasFlag(entity, ENTITY_FLAGS.ghost) &&
        rel === "self"
      ) {
        requests.push({
          request: {
            eventId: "building.complete",
            entityId: entity.id,
            ownerPlayer: entity.owner,
            relation: "self",
            tileX: entity.x,
            tileY: entity.y,
            screenX,
            onScreen,
            tileVisible: true,
          },
        });
        evaEvents.push("constructionComplete");
      }

      // Vehicle / infantry started moving (Zero Hour `SoundMoveStart`)
      if (
        def.category === "unit" &&
        !hasFlag(prevEntity, ENTITY_FLAGS.moving) &&
        hasFlag(entity, ENTITY_FLAGS.moving)
      ) {
        const startEvent = catalog.events[`move.${def.id}.start`]
          ? `move.${def.id}.start`
          : locomotorKindOf(entity.kind) === "foot"
            ? "move.foot"
            : locomotorKindOf(entity.kind) === "wheels"
              ? "move.wheeled"
              : "move.tracked";
        requests.push({
          request: {
            eventId: startEvent,
            entityId: entity.id,
            ownerPlayer: entity.owner,
            relation: rel,
            tileX: entity.x,
            tileY: entity.y,
            screenX,
            onScreen,
            tileVisible,
          },
        });
      }

      // Engine shut-down when a vehicle stops (owner, 2026-10-27; Zero Hour has
      // no stop event, this is our own content).
      const stopLoco = locomotorKindOf(entity.kind);
      if (
        def.category === "unit" &&
        (stopLoco === "tracks" || stopLoco === "wheels") &&
        hasFlag(prevEntity, ENTITY_FLAGS.moving) &&
        !hasFlag(entity, ENTITY_FLAGS.moving)
      ) {
        requests.push({
          request: {
            eventId:
              stopLoco === "tracks" ? "move.stop.tracks" : "move.stop.wheels",
            entityId: entity.id,
            ownerPlayer: entity.owner,
            relation: rel,
            tileX: entity.x,
            tileY: entity.y,
            screenX,
            onScreen,
            tileVisible,
          },
        });
      }
    }
  }

  // 4. Economy / Power / Outcome EVA alerts
  if (!isFirstSnapshot && prev && localPlayer !== OBSERVER) {
    const wasLowPower = prev.powerConsumed > prev.powerProduced;
    const isLowPower = next.powerConsumed > next.powerProduced;
    if (!wasLowPower && isLowPower) {
      evaEvents.push("lowPower");
    }
    if (prev.outcome === "ongoing" && next.outcome !== "ongoing") {
      if (next.winner === localPlayer) {
        evaEvents.push("victory");
      } else {
        evaEvents.push("defeat");
      }
    }
  }

  return { requests, evaEvents, constructionLoops, unitLoops, combatActive };
}

/**
 * Picks the group leader from selected entity IDs and resolves the unit/building
 * selection or order voice event (`specs/25-audio.md` §6.2, §6.3).
 */
export function resolveCommandVoiceEvent(
  selectedIds: readonly number[],
  entities: readonly EntityState[],
  localPlayer: number,
  action: "select" | "move" | "attack",
): { eventId: string; entityId: number; fallbackCategory?: string } | null {
  if (selectedIds.length === 0) return null;
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const id of selectedIds) {
    const entity = byId.get(id);
    if (!entity || (localPlayer !== OBSERVER && entity.owner !== localPlayer))
      continue;
    const def = typeDef(entity.kind);
    if (def.category === "building") {
      if (action !== "select") continue;
      const faction = RULES.factions[def.faction]?.id ?? "ukraine";
      if (def.id.endsWith("-hq")) {
        return {
          eventId: `building.select.hq.${faction}`,
          entityId: entity.id,
        };
      }
      if (def.id.endsWith("-barracks")) {
        return {
          eventId: `building.select.barracks.${faction}`,
          entityId: entity.id,
        };
      }
      if (def.id.endsWith("-vehicle-factory")) {
        return {
          eventId: `building.select.factory.${faction}`,
          entityId: entity.id,
        };
      }
      return { eventId: "ui.click", entityId: entity.id };
    }
    if (def.category === "unit") {
      const loco = locomotorKindOf(entity.kind);
      const fallbackCategory =
        loco === "foot" ? "foot" : loco === "wheels" ? "wheeled" : "tracked";
      return {
        eventId: `voice.${def.id}.${action}`,
        entityId: entity.id,
        fallbackCategory,
      };
    }
  }
  return null;
}
