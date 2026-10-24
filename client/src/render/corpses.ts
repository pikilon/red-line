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
  /** 0 standing .. 1 kneeling when he died; a kneeling soldier falls from the
   *  kneel instead of standing up. */
  readonly kneel?: number;
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
/** A hit within this of square across the facing tips the body on its side. */
const SIDE_HIT = 0.45;
/** Forward lean of a kneeling soldier, radians (the operator bends further). */
const KNEEL_LEAN = 0.06;
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

/** Style of a shot death, stable per soldier: stumble, jerk or crumple. */
export function variantOf(corpse: Corpse): number {
  return corpse.cause.kind === "shot" ? corpse.id % SHOT_VARIANTS : 0;
}

export type FallAxis = "forward" | "back" | "side";

/** Which way the hit tips the body, from where it was facing: pushed along
 *  its facing it falls on its face, against it on its back, across it on its
 *  side. The body never turns on its feet first (spec 22 §3). */
export function fallAxis(corpse: Corpse): { axis: FallAxis; right: 1 | -1 } {
  const push = corpse.cause.push;
  const along = Math.sin(corpse.yaw + push);
  const right = -Math.cos(corpse.yaw + push) > 0 ? 1 : -1;
  if (Math.abs(along) < SIDE_HIT) return { axis: "side", right };
  return { axis: along > 0 ? "forward" : "back", right };
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

/** Timing of the fall of each style, ms: when it starts and how long it takes. */
const FALL_START = [150, 80, 380] as const;
const FALL_DURATION = [650, 720, 460] as const;

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
  const { axis, right } = fallAxis(corpse);
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
    // Flips once in the air the way it is thrown and lands face down or on
    // its back (on its side after a side blast), keeping the way it faced.
    const spin = 1 - smooth(0, TOSS_SPIN_MS, t);
    const turn = QUARTER_TURN + 2 * HALF_TURN * spin;
    if (axis === "side") out.roll = right * turn;
    else out.pitch = (axis === "forward" ? 1 : -1) * turn;
    out.lift =
      height +
      BODY_THICKNESS *
        Math.max(Math.abs(Math.sin(out.pitch)), Math.abs(Math.sin(out.roll)));
    return out;
  }
  const style = variantOf(corpse);
  const fall = clamp01(
    (t - (FALL_START[style] ?? 0)) / (FALL_DURATION[style] ?? 1),
  );
  let tip = QUARTER_TURN * fall * fall;
  if (style === 1) {
    // Jerked by the hit before it goes.
    tip += 0.18 * Math.sin(Math.PI * clamp01(t / 220)) * (1 - fall);
  }
  if (axis === "side") out.roll = right * tip;
  else out.pitch = (axis === "forward" ? 1 : -1) * tip;
  out.lift =
    BODY_THICKNESS *
    Math.max(Math.abs(Math.sin(out.pitch)), Math.abs(Math.sin(out.roll)));
  return out;
}

/** Offsets of a limb of the falling soldier `t` ms after the death. The limb
 *  name is `<man>_<part>`. A soldier who died kneeling starts from the kneel. */
export function corpseLimb(
  corpse: Corpse,
  t: number,
  name: string,
  out: LimbPose,
): LimbPose {
  resetPose(out);
  const part = name.slice(name.indexOf("_") + 1);
  const kneel = corpse.kneel ?? 0;
  // The pose he died in: kneeling soldiers do not stand up to fall.
  switch (part) {
    case "hips":
      out.y = -KNEEL_DROP * FIGURE_HEIGHT * kneel;
      out.rx = KNEEL_LEAN * kneel;
      break;
    case "thigh_l":
      out.rx = KNEEL.thighL * kneel;
      break;
    case "shin_l":
      out.rx = KNEEL.shinL * kneel;
      break;
    case "thigh_r":
      out.rx = KNEEL.thighR * kneel;
      break;
    case "shin_r":
      out.rx = KNEEL.shinR * kneel;
      break;
    default:
      break;
  }
  const rest = 1 - kneel;
  if (corpse.cause.kind === "explosion") {
    // Thrown: arms flung up and back, legs kicking, then they go limp.
    const limp = 1 - smooth(500, 1300, t);
    const kick = Math.sin(t / 85) * limp;
    switch (part) {
      case "hips":
        out.rx += -0.35 * limp;
        break;
      case "arms":
        out.rx = -1 - 1.5 * limp;
        out.ry = 0.5 * kick;
        break;
      case "thigh_l":
        out.rx += (-0.5 - 0.5 * kick) * rest;
        break;
      case "thigh_r":
        out.rx += (0.4 + 0.5 * kick) * rest;
        break;
      case "shin_l":
        out.rx += (0.9 * limp + 0.3) * rest;
        break;
      case "shin_r":
        out.rx += (0.7 * limp + 0.3) * rest;
        break;
      default:
        break;
    }
    return out;
  }
  const style = variantOf(corpse);
  const { axis } = fallAxis(corpse);
  if (style === 2) {
    // Crumples: the knees give way first, then the body topples.
    const k = smooth(0, 380, t) * rest;
    switch (part) {
      case "hips":
        out.y -= KNEEL_DROP * FIGURE_HEIGHT * k;
        out.rx += 0.25 * k;
        break;
      case "arms":
        out.rx = 0.7 * smooth(0, 380, t);
        break;
      case "thigh_l":
        out.rx += KNEEL.thighL * k;
        break;
      case "shin_l":
        out.rx += KNEEL.shinL * k;
        break;
      case "thigh_r":
        out.rx += KNEEL.thighR * k;
        break;
      case "shin_r":
        out.rx += KNEEL.shinR * k;
        break;
      default:
        break;
    }
    return out;
  }
  // Stumble or jerk: arms flung out (up when falling back, reaching when
  // falling forward), legs going slack.
  const u = smooth(0, axis === "back" ? 500 : 700, t) * rest;
  switch (part) {
    case "arms":
      out.rx =
        axis === "back"
          ? -2.3 * smooth(0, 300, t) + 0.8 * smooth(400, 800, t)
          : -1.1 * smooth(0, 450, t) + 0.5 * smooth(0, 700, t);
      out.ry = (axis === "back" ? 0.4 : 0) * smooth(0, 500, t);
      break;
    case "thigh_l":
      out.rx += (axis === "back" ? -0.4 : -0.7) * u;
      break;
    case "thigh_r":
      out.rx += (axis === "back" ? 0.4 : 0.3) * u;
      break;
    case "shin_l":
      out.rx += (axis === "back" ? 0.5 : 0.9) * u;
      break;
    case "shin_r":
      out.rx += (axis === "back" ? 0.8 : 0.5) * u;
      break;
    default:
      break;
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
