import type { EntityState, MatchSnapshot } from "../sim/matchSnapshot";
import { TICK_MS } from "../sim/protocol";
import { runOverOf, touches } from "./deaths";

/** Spec 28 §5a: the sim throws a shoved soldier clear in one tick; the client
 *  eases him there instead, so he reads as struck and knocked aside. */

/** Slide time of a shoved soldier, ms. */
export const KNOCK_MS = 380;
/** A soldier that moves more than this in one tick (tiles) was thrown. */
export const KNOCK_JUMP = 0.2;

interface Knock {
  readonly dx: number;
  readonly dy: number;
  readonly atMs: number;
}

export interface Knockback {
  /** Notes the soldiers thrown between two snapshots. */
  record(prev: MatchSnapshot, next: MatchSnapshot, atMs: number): void;
  /** Moves the drawn soldiers along their slide, in place. */
  apply(drawn: EntityState[], nowMs: number): void;
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function createKnockback(): Knockback {
  const knocks = new Map<number, Knock>();
  return {
    record(prev, next, atMs) {
      if (next.tick <= prev.tick) return;
      const before = new Map<number, EntityState>();
      for (const entity of prev.entities) before.set(entity.id, entity);
      for (const [id, knock] of knocks) {
        if (atMs - knock.atMs >= KNOCK_MS) knocks.delete(id);
      }
      const shovers = next.entities.filter(
        (entity) => runOverOf(entity.kind) === "shove",
      );
      if (shovers.length === 0) return;
      for (const entity of next.entities) {
        const old = before.get(entity.id);
        if (old === undefined) continue;
        const dx = old.x - entity.x;
        const dy = old.y - entity.y;
        if (Math.hypot(dx, dy) < KNOCK_JUMP) continue;
        if (!shovers.some((vehicle) => touches(vehicle, entity))) continue;
        knocks.set(entity.id, { dx, dy, atMs });
      }
    },
    apply(drawn, nowMs) {
      if (knocks.size === 0) return;
      for (const entity of drawn) {
        const knock = knocks.get(entity.id);
        if (knock === undefined) continue;
        const elapsed = Math.max(0, nowMs - knock.atMs);
        if (elapsed >= KNOCK_MS) continue;
        // Interpolation has already covered `lerped` of the jump; replace it
        // with the eased slide.
        const lerped = Math.min(1, elapsed / TICK_MS);
        const left = 1 - easeOut(elapsed / KNOCK_MS);
        entity.x += knock.dx * (left - (1 - lerped));
        entity.y += knock.dy * (left - (1 - lerped));
      }
    },
  };
}
