/** Vehicle body motion while driving: the hull dips when braking, squats when
 *  accelerating, leans outward in turns and shakes with the engine. Derived
 *  from the rendered heading and position, so it needs nothing in the sim. */

/** Longest frame step used, so a stalled tab cannot fling the body. */
const MAX_DT_SECONDS = 0.1;
/** Smoothing time of the measured speed and turn rate, in seconds. */
const SMOOTH_SECONDS = 0.12;
/** Spring that eases the body back to level, per second. */
const SETTLE_RATE = 9;
/** Radians of pitch per tile/s² of acceleration (positive = nose down). */
const PITCH_PER_ACCEL = 0.012;
/** Radians of roll per (rad/s × tile/s) of lateral acceleration. */
const ROLL_PER_LATERAL = 0.05;
const MAX_PITCH = 0.06;
const MAX_ROLL = 0.07;
/** Engine shake: height in tiles and frequency in Hz at full speed. */
const SHAKE_HEIGHT = 0.012;
const SHAKE_HZ = 14;
/** Tile/s at which the shake reaches full strength. */
const SHAKE_FULL_SPEED = 2;

export interface BodyPose {
  /** Rotation about the hull's lateral axis, radians (positive = nose down). */
  readonly pitch: number;
  /** Rotation about the hull's long axis, radians. */
  readonly roll: number;
  /** Vertical shake in tiles. */
  readonly shake: number;
}

export const LEVEL_POSE: BodyPose = { pitch: 0, roll: 0, shake: 0 };

interface BodyEntry {
  x: number;
  y: number;
  yaw: number;
  nowMs: number;
  speed: number;
  turnRate: number;
  pitch: number;
  roll: number;
}

export interface Suspension {
  /** Pose of vehicle `id` at `nowMs`, from its position and hull yaw (radians).
   *  Call once per entity per frame. */
  update(
    id: number,
    x: number,
    y: number,
    yaw: number,
    nowMs: number,
  ): BodyPose;
  /** Forgets entities that no longer exist. */
  prune(alive: ReadonlySet<number>): void;
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

export function createSuspension(): Suspension {
  const entries = new Map<number, BodyEntry>();

  return {
    update(id, x, y, yaw, nowMs) {
      const previous = entries.get(id);
      if (previous === undefined || nowMs <= previous.nowMs) {
        if (previous === undefined) {
          entries.set(id, {
            x,
            y,
            yaw,
            nowMs,
            speed: 0,
            turnRate: 0,
            pitch: 0,
            roll: 0,
          });
        }
        return LEVEL_POSE;
      }
      const dt = Math.min(MAX_DT_SECONDS, (nowMs - previous.nowMs) / 1000);
      const blend = 1 - Math.exp(-dt / SMOOTH_SECONDS);
      // Signed speed along the hull so reversing dips the other way.
      const forwardX = Math.sin(yaw);
      const forwardY = Math.cos(yaw);
      const along =
        ((x - previous.x) * forwardX + (y - previous.y) * forwardY) / dt;
      const speed = previous.speed + (along - previous.speed) * blend;
      const turn = wrap(yaw - previous.yaw) / dt;
      const turnRate = previous.turnRate + (turn - previous.turnRate) * blend;
      const accel = (speed - previous.speed) / dt;

      const settle = Math.exp(-SETTLE_RATE * dt);
      const pitchTarget = clamp(accel * PITCH_PER_ACCEL, MAX_PITCH);
      const rollTarget = clamp(turnRate * speed * ROLL_PER_LATERAL, MAX_ROLL);
      // Braking (negative accel) pushes the nose down; the spring eases back.
      const pitch = previous.pitch * settle + -pitchTarget * (1 - settle);
      const roll = previous.roll * settle + rollTarget * (1 - settle);

      previous.x = x;
      previous.y = y;
      previous.yaw = yaw;
      previous.nowMs = nowMs;
      previous.speed = speed;
      previous.turnRate = turnRate;
      previous.pitch = pitch;
      previous.roll = roll;

      const strength = Math.min(1, Math.abs(speed) / SHAKE_FULL_SPEED);
      const shake =
        strength *
        SHAKE_HEIGHT *
        Math.sin(((nowMs / 1000) * SHAKE_HZ + id * 1.7) * 2 * Math.PI);
      return { pitch, roll, shake };
    },
    prune(alive) {
      for (const id of entries.keys()) {
        if (!alive.has(id)) entries.delete(id);
      }
    },
  };
}
