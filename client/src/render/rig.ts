/** Client-only skeletal poses of rigid-limb infantry models (spec 20). The
 *  models are authored standing; every pose here is an offset from that
 *  neutral pose, driven by the eased `RigState` of the animator. Nothing here
 *  touches the simulation or the snapshot. */

import type { Vector3 } from "three";
import type { TypeModel } from "./models";

/** Eased animation state of one infantry unit. */
export interface RigState {
  /** 0 at rest .. 1 walking. */
  readonly walk: number;
  /** Walk cycle position, in turns (one turn = two steps). */
  readonly phase: number;
  /** 0 kneeling .. 1 standing; only kneeling teams ever leave 1. */
  readonly stance: number;
  /** 0 weapon lowered .. 1 raised on a target. */
  readonly aim: number;
  /** 0 launcher on the ground .. 1 carried. */
  readonly carry: number;
  /** Milliseconds since the last shot, Infinity without one. */
  readonly sinceShot: number;
  /** Milliseconds a visible reload takes, 0 for weapons that show none. */
  readonly reloadMs: number;
}

export const REST_RIG: RigState = {
  walk: 0,
  phase: 0,
  stance: 1,
  aim: 0,
  carry: 0,
  sinceShot: Number.POSITIVE_INFINITY,
  reloadMs: 0,
};

/** Offset of one limb from its neutral pose: tiles in the parent frame, then
 *  radians about the joint (X leans forward, Y turns) and a scale. */
export interface LimbPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  sx: number;
  sy: number;
  sz: number;
}

export function resetPose(pose: LimbPose): LimbPose {
  pose.x = pose.y = pose.z = pose.rx = pose.ry = 0;
  pose.sx = pose.sy = pose.sz = 1;
  return pose;
}

type Weapon = "rifle" | "rpg" | "console";

interface Man {
  readonly weapon: Weapon;
  /** Kneels while holding a position and stands up to walk. */
  readonly kneels: boolean;
  /** Figure height in tiles (the `place()` height of the model script). */
  readonly height: number;
}

/** Soldier prefixes of every rigged model (the `<man>_<part>` limb names). */
const RIGS: Readonly<Record<string, Readonly<Record<string, Man>>>> = {
  "ua-rifleman": { m: { weapon: "rifle", kneels: false, height: 0.54 } },
  "ru-rifleman": { m: { weapon: "rifle", kneels: false, height: 0.54 } },
  "ru-rpg-gunner": {
    g: { weapon: "rpg", kneels: true, height: 0.5 },
    a: { weapon: "rifle", kneels: true, height: 0.5 },
  },
  "ua-stugna-team": { o: { weapon: "console", kneels: true, height: 0.46 } },
};

/** Hips lowered to kneel, in figure heights. */
const KNEEL_DROP = 0.2;
/** Joint angles of the kneeling pose against the standing one, radians
 *  (right knee on the ground, left foot forward). */
const KNEEL = {
  thighL: -1.056,
  shinL: 1.03,
  thighR: -0.253,
  shinR: 1.571,
} as const;
/** Forward lean added by kneeling: the operator bends over his console. */
const KNEEL_LEAN: Readonly<Record<Weapon, number>> = {
  rifle: 0.04,
  rpg: 0.06,
  console: 0.24,
};
/** Thigh swing and knee flex of the walk, radians. */
const SWING = 0.6;
const FLEX = 0.85;
/** Hip height change of a step, in figure heights. */
const STEP_BOB = 0.012;
/** Launcher muzzle pitch while carried or reloaded, radians (down is +). */
const CARRY_PITCH = 0.55;
const RELOAD_PITCH = 1.15;
/** Recoil kick of a fired weapon, in ms. */
const KICK_MS = 140;

/** Fractions of the reload where each stage starts and ends. */
const RELOAD = {
  lowered: [0.08, 0.25],
  raised: [0.8, 0.96],
  newRoundIn: [0.28, 0.78],
} as const;

/** Carry offset, in tiles, of the Stugna launcher and its fold-up time. */
const CARRY_ARC = 0.07;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Reload progress in [0, 1]; 1 when idle or loaded. */
export function reloadProgress(state: RigState): number {
  if (state.reloadMs <= 0) return 1;
  return clamp01(state.sinceShot / state.reloadMs);
}

/** 1 while the launcher is lowered for the reload, eased in and out. */
function reloadLowered(f: number): number {
  return (
    smooth(RELOAD.lowered[0], RELOAD.lowered[1], f) *
    (1 - smooth(RELOAD.raised[0], RELOAD.raised[1], f))
  );
}

function pose(
  man: Man,
  part: string,
  s: RigState,
  out: LimbPose,
  carryMotion: Vector3 | null,
): void {
  const k = man.kneels ? 1 - s.stance : 0;
  const turn = 2 * Math.PI * s.phase;
  const f = reloadProgress(s);
  const kick = clamp01(1 - s.sinceShot / KICK_MS);
  switch (part) {
    case "hips":
      out.y =
        (-KNEEL_DROP * k + STEP_BOB * s.walk * Math.cos(2 * turn)) * man.height;
      out.rx = 0.06 * s.walk + KNEEL_LEAN[man.weapon] * k;
      out.ry = 0.1 * s.walk * Math.sin(turn);
      break;
    case "thigh_l":
      out.rx = -SWING * s.walk * Math.sin(turn) + KNEEL.thighL * k;
      break;
    case "thigh_r":
      out.rx = SWING * s.walk * Math.sin(turn) + KNEEL.thighR * k;
      break;
    case "shin_l":
      out.rx = FLEX * s.walk * Math.max(0, Math.cos(turn)) + KNEEL.shinL * k;
      break;
    case "shin_r":
      out.rx = FLEX * s.walk * Math.max(0, -Math.cos(turn)) + KNEEL.shinR * k;
      break;
    case "arms": {
      if (man.weapon === "rifle") {
        // Low ready, raised on a target; the walk swings it a little.
        out.rx = -0.55 * s.aim + 0.1 * s.walk - 0.05 * kick;
        out.ry = -0.06 * s.walk * Math.sin(turn);
        out.z = -0.012 * kick;
      } else if (man.weapon === "rpg") {
        // On the shoulder aimed; lowered in hand to walk, idle and reload.
        const lowered = reloadLowered(f);
        const carried = Math.max(s.walk, 1 - s.aim) * CARRY_PITCH;
        out.rx =
          carried +
          (RELOAD_PITCH - carried) * lowered -
          0.12 * kick * (1 - lowered);
        out.z = -0.02 * kick;
      } else {
        out.rx = 0.08 * s.walk;
      }
      break;
    }
    case "round": {
      // Spent on firing, then carried from the pack over the shoulder and
      // pushed in at the muzzle while the launcher hangs lowered.
      const [from, to] = RELOAD.newRoundIn;
      if (f < from) {
        out.sx = out.sy = out.sz = 0;
        break;
      }
      const u = clamp01((f - from) / (to - from));
      const first = smooth(0, 0.5, u);
      const second = smooth(0.5, 1, u);
      // From behind the shoulder, over it, out in front and back in.
      out.y = 0.14 * (1 - second) * Math.sin(Math.PI * Math.min(1, u * 2));
      out.z = -0.3 * (1 - first) + 0.22 * first * (1 - second);
      break;
    }
    case "launcher": {
      const c = smooth(0, 1, s.carry);
      if (carryMotion !== null) {
        out.x = carryMotion.x * c;
        out.y = carryMotion.y * c + CARRY_ARC * Math.sin(Math.PI * c);
        out.z = carryMotion.z * c;
      }
      break;
    }
    case "tripod": {
      // Folds its legs together and swings them back along the tube.
      const fold = smooth(0, 0.55, s.carry);
      out.sx = out.sz = 1 - 0.85 * fold;
      out.rx = 1.45 * fold;
      break;
    }
    case "canister": {
      // The spent container falls away, a fresh one drops in from above.
      if (f < 0.1) break;
      const fall = smooth(0.1, 0.3, f);
      if (f < 0.3) {
        out.y = -0.1 * fall;
        out.z = -0.04 * fall;
        out.rx = 0.5 * fall;
        out.sx = out.sy = out.sz = 1 - fall;
        break;
      }
      const drop = smooth(0.3, 0.78, f);
      out.y = 0.28 * (1 - drop);
      out.rx = -0.5 * (1 - drop);
      break;
    }
    case "cable":
      out.sx = out.sy = out.sz = 1 - smooth(0, 0.15, s.carry);
      break;
    default:
      break;
  }
}

/** Splits a limb name `<man>_<part>` at its first underscore. */
function splitLimb(name: string): [string, string] {
  const at = name.indexOf("_");
  return at < 0 ? [name, ""] : [name.slice(0, at), name.slice(at + 1)];
}

/** Where the Stugna launcher rides, relative to its resting joint. */
function carryMotion(model: TypeModel): Vector3 | null {
  const anchor = model.anchors?.get("anchor_carry");
  const launcher = model.limbs?.find((limb) => limb.name === "x_launcher");
  if (anchor === undefined || launcher === undefined) return null;
  return anchor.clone().sub(launcher.world);
}

const carryMotions = new WeakMap<TypeModel, Vector3 | null>();

/** Writes into `out` the pose of limb `name` of `typeId` for state `s`; limbs
 *  without a pose rule (or of unrigged types) stay neutral. */
export function limbPose(
  typeId: string,
  model: TypeModel,
  name: string,
  s: RigState,
  out: LimbPose,
): LimbPose {
  resetPose(out);
  const men = RIGS[typeId];
  if (men === undefined) return out;
  const [prefix, part] = splitLimb(name);
  const man = men[prefix];
  if (man !== undefined) {
    pose(man, part, s, out, null);
    return out;
  }
  let motion = carryMotions.get(model);
  if (motion === undefined) {
    motion = carryMotion(model);
    carryMotions.set(model, motion);
  }
  // Props of the team (`x_*`) follow the first soldier's state.
  pose({ weapon: "console", kneels: false, height: 1 }, part, s, out, motion);
  return out;
}

/** Whether `typeId` has a rig, i.e. infantry that animate through limbs. */
export function isRigged(typeId: string): boolean {
  return RIGS[typeId] !== undefined;
}
