/**
 * Decoder for the combat snapshot (`Sim::combat_for`, spec 17 §4.7): flying
 * projectiles plus the combat events (detonations and deaths) of every step
 * since the previous snapshot.
 */

/** One projectile record: `id, owner, weapon, shooter, target, origin.x,
 * origin.y, impact.x, impact.y, launchTick, impactTick`. */
export const PROJECTILE_STRIDE = 11;
/** One event record: `kind`, five payload fields and `pos.x, pos.y`. */
export const EVENT_STRIDE = 7;

export interface ProjectileState {
  id: number;
  owner: number;
  weapon: number;
  shooter: number;
  target: number;
  /** Tiles. */
  originX: number;
  originY: number;
  /** Tiles. */
  impactX: number;
  impactY: number;
  launchTick: number;
  impactTick: number;
}

export const COMBAT_EVENT_KINDS = ["detonate", "death"] as const;
export type CombatEventKind = (typeof COMBAT_EVENT_KINDS)[number];

export type CombatEventState =
  | {
      kind: "detonate";
      projectile: number;
      owner: number;
      weapon: number;
      hit: number | null;
      /** Tiles. */
      x: number;
      y: number;
    }
  | {
      kind: "death";
      victim: number;
      victimKind: number;
      killer: number | null;
      weapon: number | null;
      /** Tiles. */
      x: number;
      y: number;
    };

export interface CombatSnapshot {
  projectiles: ProjectileState[];
  events: CombatEventState[];
}

/** Raw fixed-point units per tile. */
const TILE = 65536;
/** The `-1` sentinel of an absent entity or weapon. */
const nullId = (value: number): number | null => (value < 0 ? null : value);

/** Decodes a `combat_for` `Int32Array`; raw fixed-point positions become tiles. */
export function decodeCombat(data: Int32Array): CombatSnapshot {
  const projectiles: ProjectileState[] = [];
  const projectileCount = data[0] ?? 0;
  let offset = 1;
  for (let i = 0; i < projectileCount; i++) {
    const base = offset + i * PROJECTILE_STRIDE;
    projectiles.push({
      id: data[base] ?? 0,
      owner: data[base + 1] ?? 0,
      weapon: data[base + 2] ?? 0,
      shooter: data[base + 3] ?? 0,
      target: data[base + 4] ?? 0,
      originX: (data[base + 5] ?? 0) / TILE,
      originY: (data[base + 6] ?? 0) / TILE,
      impactX: (data[base + 7] ?? 0) / TILE,
      impactY: (data[base + 8] ?? 0) / TILE,
      launchTick: data[base + 9] ?? 0,
      impactTick: data[base + 10] ?? 0,
    });
  }
  offset += projectileCount * PROJECTILE_STRIDE;

  const events: CombatEventState[] = [];
  const eventCount = data[offset] ?? 0;
  offset += 1;
  for (let i = 0; i < eventCount; i++) {
    const base = offset + i * EVENT_STRIDE;
    // The event kind is an index into `COMBAT_EVENT_KINDS`; only `detonate` is
    // split so far, so any other kind is a death.
    const detonate = data[base] === COMBAT_EVENT_KINDS.indexOf("detonate");
    if (detonate) {
      events.push({
        kind: "detonate",
        projectile: data[base + 1] ?? 0,
        owner: data[base + 2] ?? 0,
        weapon: data[base + 3] ?? 0,
        hit: nullId(data[base + 4] ?? -1),
        x: (data[base + 5] ?? 0) / TILE,
        y: (data[base + 6] ?? 0) / TILE,
      });
      continue;
    }
    events.push({
      kind: "death",
      victim: data[base + 1] ?? 0,
      victimKind: data[base + 2] ?? 0,
      killer: nullId(data[base + 3] ?? -1),
      weapon: nullId(data[base + 4] ?? -1),
      x: (data[base + 5] ?? 0) / TILE,
      y: (data[base + 6] ?? 0) / TILE,
    });
  }
  return { projectiles, events };
}
