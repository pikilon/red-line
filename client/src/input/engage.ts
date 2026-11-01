/**
 * Which of the player's units can hit a target by height (spec 43 §4.1). The
 * simulation refuses an order its weapon can never carry out; the UI mirrors
 * the rule so it never offers one: an airborne enemy is a target only for
 * units whose weapon reaches its class, and an anti-air-only weapon never
 * fires at the ground.
 */
import { airInfo, isAirborne } from "../render/flyers";
import { typeDef, WEAPONS, type WeaponDef } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";

/** The weapon `entity` fights with: its gun, or the warhead of a one-way
 *  unit; null for an unarmed one. */
export function weaponOf(entity: EntityState): WeaponDef | null {
  const type = typeDef(entity.kind);
  if (type.weapon >= 0) return WEAPONS[type.weapon] ?? null;
  if (type.oneWay !== undefined) return WEAPONS[type.oneWay.warhead] ?? null;
  return null;
}

/** True when `entity` has a weapon or a warhead to attack with. */
export function isArmed(entity: EntityState): boolean {
  const type = typeDef(entity.kind);
  return type.weapon >= 0 || type.oneWay !== undefined;
}

/** True when the weapon of `attacker` can engage `target`, by height only. */
export function canEngage(attacker: EntityState, target: EntityState): boolean {
  const weapon = weaponOf(attacker);
  if (weapon === null) return false;
  const air = airInfo(typeDef(target.kind));
  if (air !== null && isAirborne(target)) {
    const reach = weapon.antiAir ?? "none";
    if (reach === "all") return true;
    return reach === "low" && air.airClass === "low";
  }
  return weapon.antiGround !== false;
}

/** True when `attacker` can attack a point on the ground: any armed unit
 *  except an anti-air-only one. A one-way unit goes to any point and detonates. */
export function canAttackGround(attacker: EntityState): boolean {
  const weapon = weaponOf(attacker);
  return weapon !== null && weapon.antiGround !== false;
}
