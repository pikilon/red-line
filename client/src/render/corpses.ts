/** Falling soldiers (spec 22): when an infantry unit dies the snapshot drops
 *  it, so the renderer replays its death with the same rigid limbs it walked
 *  with, posed by time since the death. Client-only; nothing here touches the
 *  simulation. */

import { KNEEL, KNEEL_DROP, type LimbPose, resetPose } from "./rig";

export type DeathKind = "shot" | "explosion";

export interface DeathCause {
  readonly kind: DeathKind;
  /** Direction the body is pushed, in the tile plane (atan2(dy, dx)). */
  readonly push: number;
}

export interface Corpse {
  readonly id: number;
  /** Type index of the soldier. */
  readonly kind: number;
  readonly owner: number;
  /** Tiles. */
  readonly x: number;
  readonly y: number;
  /** Hull yaw at the moment of death. */
  readonly yaw: number;
  readonly cause: DeathCause;
  readonly startMs: number;
}

/** A body lies this long, and shrinks away over the last `CORPSE_FADE_MS`. */
export const CORPSE_MS = 20_000;
export const CORPSE_FADE_MS = 3000;

/** Placement of the whole body: tiles, radians. The model's origin is at its
 *  feet, so pitch and roll tip it over its soles. */
export interface BodyPose {
  x: number;
  y: number;
  /** Height of the feet above the ground. */
  lift: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** 1, shrinking to 0 while the body fades away. */
  scale: number;
}

/** The shot death variants: stumble forward, thrown back, crumple sideways. */
export const SHOT_VARIANTS = 3;
const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;
/** Half the thickness of a lying body, tiles. */
const BODY_THICKNESS = 0.05;
/** Figure height of the soldiers, for the kneel-drop of a crumpling body. */
const FIGURE_HEIGHT = 0.5;

/** Explosion toss: distance (tiles), flight and landing times (ms). */
const TOSS_DISTANCE = 1;
const TOSS_SPREAD = 0.25;
const TOSS_FLIGHT_MS = 650;
const TOSS_SLIDE_MS = 900;
const TOSS_HEIGHT = 0.6;
const TOSS_BOUNCE_MS = 300;
const TOSS_BOUNCE_HEIGHT = 0.14;
const TOSS_SPIN_MS = 900;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** `a` to `b` along the shorter arc. */
function turnTowards(a: number, b: number, t: number): number {
  const delta = ((b - a + HALF_TURN * 3) % (HALF_TURN * 2)) - HALF_TURN;
  return a + delta * t;
}

/** Variant of a death, stable per soldier. */
export function variantOf(corpse: Corpse): number {
  return corpse.cause.kind === "shot" ? corpse.id % SHOT_VARIANTS : 0;
}

/** Yaw that faces the push direction. */
function pushYaw(corpse: Corpse): number {
  return Math.atan2(Math.cos(corpse.cause.push), Math.sin(corpse.cause.push));
}

/** Milliseconds a death animation takes before the body lies still. */
export function settleMs(corpse: Corpse): number {
  return corpse.cause.kind === "explosion"
    ? TOSS_SLIDE_MS + TOSS_BOUNCE_MS
    : 900;
}

/** Tiles an explosion carries the body from where it stood. */
export function tossReach(corpse: Corpse): number {
  return TOSS_DISTANCE + (corpse.id % 3) * TOSS_SPREAD;
}

/** Fade factor of a body `t` ms after its death. */
export function corpseFade(t: number): number {
  return t < CORPSE_MS - CORPSE_FADE_MS
    ? 1
    : clamp01((CORPSE_MS - t) / CORPSE_FADE_MS);
}

/** Where, and how tipped over, the body is `t` ms after the death. */
export function bodyPose(corpse: Corpse, t: number, out: BodyPose): BodyPose {
  out.x = corpse.x;
  out.y = corpse.y;
  out.lift = 0;
  out.yaw = corpse.yaw;
  out.pitch = 0;
  out.roll = 0;
  out.scale = corpseFade(t);
  const push = corpse.cause.push;
  if (corpse.cause.kind === "explosion") {
    const reach = tossReach(corpse);
    const slide = clamp01(t / TOSS_SLIDE_MS);
    const distance = reach * (1 - (1 - slide) * (1 - slide));
    out.x += Math.cos(push) * distance;
    out.y += Math.sin(push) * distance;
    const air = clamp01(t / TOSS_FLIGHT_MS);
    let height = TOSS_HEIGHT * 4 * air * (1 - air);
    if (t > TOSS_FLIGHT_MS) {
      const bounce = clamp01((t - TOSS_FLIGHT_MS) / TOSS_BOUNCE_MS);
      height = TOSS_BOUNCE_HEIGHT * 4 * bounce * (1 - bounce);
    }
    // Faces the blast, flips once in the air and lands on its face or back.
    const side = corpse.id % 2 === 0 ? 1 : -1;
    const spin = 1 - smooth(0, TOSS_SPIN_MS, t);
    out.pitch = side * (QUARTER_TURN + 2 * HALF_TURN * spin);
    out.yaw =
      turnTowards(corpse.yaw, pushYaw(corpse) + HALF_TURN, smooth(0, 300, t)) +
      0.6 * smooth(0, TOSS_SPIN_MS, t) * side;
    out.lift = height + BODY_THICKNESS * Math.abs(Math.sin(out.pitch));
    return out;
  }
  const variant = variantOf(corpse);
  const faceYaw = pushYaw(corpse);
  if (variant === 0) {
    // Stumbles forward and falls on its face.
    const fall = clamp01((t - 150) / 650);
    out.pitch = QUARTER_TURN * fall * fall;
    out.yaw = turnTowards(corpse.yaw, faceYaw, smooth(0, 0.4, fall));
  } else if (variant === 1) {
    // Jerked back by the hit, then falls on its back.
    const fall = clamp01((t - 80) / 720);
    const jerk = Math.sin(Math.PI * clamp01(t / 220));
    out.pitch = -QUARTER_TURN * fall * fall - 0.18 * jerk * (1 - fall);
    out.yaw = turnTowards(
      corpse.yaw,
      faceYaw + HALF_TURN,
      smooth(0, 0.4, fall),
    );
  } else {
    // Knees give way, then it topples on its side towards the hit.
    const fall = clamp01((t - 380) / 460);
    const right = -Math.cos(corpse.yaw + push) > 0 ? 1 : -1;
    out.roll = right * QUARTER_TURN * fall * fall;
  }
  out.lift =
    BODY_THICKNESS *
    Math.max(Math.abs(Math.sin(out.pitch)), Math.abs(Math.sin(out.roll)));
  return out;
}

/** Offsets of a limb of the falling soldier `t` ms after the death. The limb
 *  name is `<man>_<part>`. */
export function corpseLimb(
  corpse: Corpse,
  t: number,
  name: string,
  out: LimbPose,
): LimbPose {
  resetPose(out);
  const part = name.slice(name.indexOf("_") + 1);
  if (corpse.cause.kind === "explosion") {
    // Thrown: arms flung up and back, legs kicking, then they go limp.
    const limp = 1 - smooth(500, 1300, t);
    const kick = Math.sin(t / 85) * limp;
    switch (part) {
      case "hips":
        out.rx = -0.35 * limp;
        break;
      case "arms":
        out.rx = -1 - 1.5 * limp;
        out.ry = 0.5 * kick;
        break;
      case "thigh_l":
        out.rx = -0.5 - 0.5 * kick;
        break;
      case "thigh_r":
        out.rx = 0.4 + 0.5 * kick;
        break;
      case "shin_l":
        out.rx = 0.9 * limp + 0.3;
        break;
      case "shin_r":
        out.rx = 0.7 * limp + 0.3;
        break;
      default:
        break;
    }
    return out;
  }
  const variant = variantOf(corpse);
  if (variant === 0) {
    const u = smooth(0, 700, t);
    switch (part) {
      case "arms":
        out.rx = -1.1 * smooth(0, 450, t) + 0.5 * u;
        break;
      case "thigh_l":
        out.rx = -0.7 * u;
        break;
      case "shin_l":
        out.rx = 0.9 * u;
        break;
      case "thigh_r":
        out.rx = 0.3 * u;
        break;
      case "shin_r":
        out.rx = 0.5 * u;
        break;
      default:
        break;
    }
  } else if (variant === 1) {
    const u = smooth(0, 500, t);
    switch (part) {
      case "arms":
        out.rx = -2.3 * smooth(0, 300, t) + 0.8 * smooth(400, 800, t);
        out.ry = 0.4 * u;
        break;
      case "thigh_l":
        out.rx = -0.4 * u;
        break;
      case "thigh_r":
        out.rx = 0.4 * u;
        break;
      case "shin_l":
        out.rx = 0.5 * u;
        break;
      case "shin_r":
        out.rx = 0.8 * u;
        break;
      default:
        break;
    }
  } else {
    const k = smooth(0, 380, t);
    switch (part) {
      case "hips":
        out.y = -KNEEL_DROP * FIGURE_HEIGHT * k;
        out.rx = 0.25 * k;
        break;
      case "arms":
        out.rx = 0.7 * k;
        break;
      case "thigh_l":
        out.rx = KNEEL.thighL * k;
        break;
      case "shin_l":
        out.rx = KNEEL.shinL * k;
        break;
      case "thigh_r":
        out.rx = KNEEL.thighR * k;
        break;
      case "shin_r":
        out.rx = KNEEL.shinR * k;
        break;
      default:
        break;
    }
  }
  return out;
}

export interface Corpses {
  add(corpse: Corpse): void;
  /** Bodies still lying or falling at `nowMs`; expired ones are dropped. */
  live(nowMs: number): readonly Corpse[];
  clear(): void;
}

/** Bodies of dead infantry, drawn by the entity renderer (spec 22). */
export function createCorpses(): Corpses {
  let bodies: Corpse[] = [];
  return {
    add(corpse) {
      bodies.push(corpse);
    },
    live(nowMs) {
      bodies = bodies.filter((body) => nowMs - body.startMs < CORPSE_MS);
      return bodies;
    },
    clear() {
      bodies = [];
    },
  };
}
