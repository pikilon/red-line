/** Movement below this many tiles keeps the previous hull heading (spec 06 §5). */
export const MOVED_EPSILON = 0.01;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Heading {
  readonly yaw: number;
  readonly turretYaw: number;
}

interface HeadingEntry {
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
}

export interface HeadingTracker {
  /** Hull and turret yaw of `id`, from its movement since the previous call
   *  and its target position (null keeps the turret on the hull). */
  update(id: number, x: number, y: number, target: Point | null): Heading;
  clear(): void;
}

export function createHeadingTracker(): HeadingTracker {
  const entries = new Map<number, HeadingEntry>();
  return {
    update(id, x, y, target) {
      const previous = entries.get(id);
      let yaw = 0;
      if (previous !== undefined) {
        const dx = x - previous.x;
        const dz = y - previous.y;
        yaw =
          Math.hypot(dx, dz) > MOVED_EPSILON
            ? Math.atan2(dx, dz)
            : previous.yaw;
      }
      const turretYaw =
        target === null ? yaw : Math.atan2(target.x - x, target.y - y);
      entries.set(id, { x, y, yaw });
      return { yaw, turretYaw };
    },
    clear() {
      entries.clear();
    },
  };
}
