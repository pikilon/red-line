import type { TypeDef } from "../rules";

/** Movement below this many tiles keeps the previous hull heading (spec 06 §5). */
export const MOVED_EPSILON = 0.01;

/** Turn at most this long a step, so a frame spike cannot overshoot (spec 06 §5.1). */
const MAX_TURN_DT_SECONDS = 0.25;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Heading {
  readonly yaw: number;
  readonly turretYaw: number;
}

/** Hull and turret turning speed in radians per second (spec 06 §5.1). */
export interface TurnRates {
  readonly hull: number;
  readonly turret: number;
}

interface HeadingEntry {
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
  /** Set once the id was updated with `rates`; marks a smoothed entry. */
  readonly turretYaw?: number;
  readonly nowMs?: number;
}

/** `angle` wrapped to (−π, π]. */
function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** `current` moved towards `desired` along the shorter arc by at most
 *  `maxStep` radians; the result is normalised to (−π, π]. */
export function turnTowards(
  current: number,
  desired: number,
  maxStep: number,
): number {
  const delta = normalizeAngle(desired - current);
  if (Math.abs(delta) <= maxStep) return normalizeAngle(current + delta);
  return normalizeAngle(current + Math.sign(delta) * maxStep);
}

/** Per-type turn rates from the faction data (spec 06 §5.1): the turret falls
 *  back to the hull rate when the type has none of its own. */
export function turnRatesOf(type: TypeDef): TurnRates {
  const turretDeg =
    type.turretTurnRateDeg === 0 ? type.turnRateDeg : type.turretTurnRateDeg;
  return {
    hull: (type.turnRateDeg * Math.PI) / 180,
    turret: (turretDeg * Math.PI) / 180,
  };
}

export interface HeadingTracker {
  /** Hull and turret yaw of `id`, from its movement since the previous call
   *  and its target position (null keeps the turret on the hull). Without
   *  `rates` both snap to their desired values (spec 06 §5); with them they
   *  turn by at most `rate × dt` (spec 06 §5.1). */
  update(
    id: number,
    x: number,
    y: number,
    target: Point | null,
    nowMs?: number,
    rates?: TurnRates,
  ): Heading;
  clear(): void;
}

export function createHeadingTracker(): HeadingTracker {
  const entries = new Map<number, HeadingEntry>();
  return {
    update(id, x, y, target, nowMs, rates) {
      const previous = entries.get(id);
      let desiredYaw = 0;
      if (previous !== undefined) {
        const dx = x - previous.x;
        const dz = y - previous.y;
        desiredYaw =
          Math.hypot(dx, dz) > MOVED_EPSILON
            ? Math.atan2(dx, dz)
            : previous.yaw;
      }
      const desiredTurretYaw =
        target === null ? desiredYaw : Math.atan2(target.x - x, target.y - y);

      if (rates === undefined) {
        // §5 behaviour: instant, so AC-06-05 is unchanged.
        entries.set(id, { x, y, yaw: desiredYaw });
        return { yaw: desiredYaw, turretYaw: desiredTurretYaw };
      }

      const t = nowMs ?? 0;
      if (
        previous === undefined ||
        previous.turretYaw === undefined ||
        previous.nowMs === undefined
      ) {
        // The first timed update of an id snaps both yaws to their desired
        // values (spec 06 §5.1).
        entries.set(id, {
          x,
          y,
          yaw: desiredYaw,
          turretYaw: desiredTurretYaw,
          nowMs: t,
        });
        return { yaw: desiredYaw, turretYaw: desiredTurretYaw };
      }

      const dt = Math.min(
        Math.max((t - previous.nowMs) / 1000, 0),
        MAX_TURN_DT_SECONDS,
      );
      const yaw = turnTowards(previous.yaw, desiredYaw, rates.hull * dt);
      const turretDesired =
        target === null ? yaw : Math.atan2(target.x - x, target.y - y);
      const turretYaw = turnTowards(
        previous.turretYaw,
        turretDesired,
        rates.turret * dt,
      );
      entries.set(id, { x, y, yaw, turretYaw, nowMs: t });
      return { yaw, turretYaw };
    },
    clear() {
      entries.clear();
    },
  };
}
