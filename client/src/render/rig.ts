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
  /** Pick-up progress of a carried launcher: 0 on the ground .. 1 on the
   *  shoulder; it plays forwards when the team sets off, backwards when it stops. */
  readonly carry: number;
  /** Milliseconds since the last shot, Infinity without one. */
  readonly sinceShot: number;
  /** Milliseconds a visible reload takes, 0 for weapons that show none. */
  readonly reloadMs: number;
  /** Tilt, radians, the body is knocked over its feet by a hit that did not
   *  kill (already shaped in time: jolt, then recovery), and the tile-plane
   *  direction it is pushed. Spec 22 §6. */
  readonly flinch: number;
  readonly flinchPush: number;
}

export const REST_RIG: RigState = {
  walk: 0,
  phase: 0,
  stance: 1,
  aim: 0,
  carry: 0,
  sinceShot: Number.POSITIVE_INFINITY,
  reloadMs: 0,
  flinch: 0,
  flinchPush: 0,
};

/** Offset of one limb from its neutral pose: tiles in the parent frame, then
 *  radians about the joint (X leans forward, Y turns) and a scale. */
export interface LimbPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  /** Roll about the facing: positive swings a hanging limb to the left. */
  rz: number;
  sx: number;
  sy: number;
  sz: number;
}

export function resetPose(pose: LimbPose): LimbPose {
  pose.x = pose.y = pose.z = pose.rx = pose.ry = pose.rz = 0;
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
  /** Walk cycle offset against the other man of the team, in turns, so two
   *  soldiers never step in unison. */
  readonly phase: number;
  /** Hands the next round to the gunner during the reload. */
  readonly feeds?: boolean;
  /** Bends down to pick the launcher up (and kneels only once it is down). */
  readonly pickup?: boolean;
}

/** Soldier prefixes of every rigged model (the `<man>_<part>` limb names). */
const RIGS: Readonly<Record<string, Readonly<Record<string, Man>>>> = {
  "ua-rifleman": {
    m: { weapon: "rifle", kneels: false, height: 0.54, phase: 0 },
  },
  "ru-rifleman": {
    m: { weapon: "rifle", kneels: false, height: 0.54, phase: 0 },
  },
  "ru-rpg-gunner": {
    g: { weapon: "rpg", kneels: true, height: 0.5, phase: 0 },
    a: { weapon: "rifle", kneels: true, height: 0.5, phase: 0.37, feeds: true },
  },
  "ua-stugna-team": {
    o: {
      weapon: "console",
      kneels: true,
      height: 0.46,
      phase: 0,
      pickup: true,
    },
  },
};

/** Whether the team of `typeId` bends down to pick something up before it
 *  walks off: the animator holds the legs until the pick-up is done. */
export function picksUp(typeId: string): boolean {
  return Object.values(RIGS[typeId] ?? {}).some((man) => man.pickup === true);
}

/** Hips lowered to kneel, in figure heights. */
export const KNEEL_DROP = 0.2;
/** Joint angles of the kneeling pose against the standing one, radians
 *  (right knee on the ground, left foot forward). */
export const KNEEL = {
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
const RELOAD_PITCH = -1.1;
/** Recoil kick of a fired weapon, in ms. */
const KICK_MS = 140;

/** Fractions of the reload where each stage starts and ends. */
const RELOAD = {
  lowered: [0.08, 0.25],
  raised: [0.8, 0.96],
  /** The assistant takes the round from his pack and carries it over. */
  handOver: [0.14, 0.5],
  /** The gunner slides it in at the muzzle. */
  slideIn: [0.5, 0.78],
} as const;

/** Pick-up stages by `carry`: stand up, bend to the launcher, lift it. */
const PICKUP = {
  standUp: [0, 0.3],
  bend: [0.25, 0.5],
  straighten: [0.68, 1],
  lift: [0.4, 1],
  fold: [0.4, 0.75],
} as const;

/** The round waits in front of the muzzle before it is pushed in, and rises
 *  over this arc on its way there (tiles, arms frame). */
const ROUND_FRONT = { y: 0.04, z: 0.22 } as const;
const ROUND_ARC = 0.1;
/** Height of the launcher's arc while it is lifted, in tiles. */
const CARRY_ARC = 0.07;
/** Tilt of the launcher slung on the back, radians (muzzle up). */
const LAUNCHER_SLING = 1.15;

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

/** 1 while the assistant reaches out to hand the round over. */
function handing(f: number): number {
  return (
    smooth(RELOAD.handOver[0], RELOAD.handOver[0] + 0.1, f) *
    (1 - smooth(RELOAD.slideIn[0], RELOAD.slideIn[0] + 0.1, f))
  );
}

/** 1 while the operator is bent over the launcher on the ground. */
function bending(carry: number): number {
  return (
    smooth(PICKUP.bend[0], PICKUP.bend[1], carry) *
    (1 - smooth(PICKUP.straighten[0], PICKUP.straighten[1], carry))
  );
}

/** Kneeling factor of a man: 1 kneeling .. 0 standing. */
function kneelOf(man: Man, s: RigState): number {
  if (!man.kneels) return 0;
  // A launcher team stands up first thing, then picks the launcher up.
  if (man.pickup === true) {
    return 1 - smooth(PICKUP.standUp[0], PICKUP.standUp[1], s.carry);
  }
  return 1 - s.stance;
}

/** Muzzle pitch of the RPG gunner's arms: carried low, raised on a target,
 *  hanging down while the reload goes on. */
function rpgPitch(s: RigState): number {
  const f = reloadProgress(s);
  const lowered = reloadLowered(f);
  const carried = Math.max(s.walk, 1 - s.aim) * CARRY_PITCH;
  const kick = clamp01(1 - s.sinceShot / KICK_MS);
  return (
    carried + (RELOAD_PITCH - carried) * lowered - 0.12 * kick * (1 - lowered)
  );
}

/** Joints of a model that the poses depend on, in the hull frame. */
interface Geometry {
  /** Shoulders of the RPG gunner and the round at his muzzle (arms frame). */
  readonly gunnerArms: Vector3 | null;
  readonly roundLocal: Vector3 | null;
  /** The spare round in the assistant's rocket carrier. */
  readonly spare: Vector3 | null;
  /** Heading, about Y, from the operator towards the grounded launcher. */
  readonly launcherTurn: number;
  /** Where the Stugna launcher rides, relative to its resting joint. */
  readonly carry: Vector3 | null;
}

const geometries = new WeakMap<TypeModel, Geometry>();

function geometryOf(model: TypeModel): Geometry {
  const cached = geometries.get(model);
  if (cached !== undefined) return cached;
  const find = (name: string) =>
    model.limbs?.find((limb) => limb.name === name);
  const anchor = model.anchors?.get("anchor_carry");
  const launcher = find("x_launcher");
  const operator = find("o_hips");
  const arms = find("g_arms");
  const round = find("g_round");
  const turn =
    launcher !== undefined && operator !== undefined
      ? Math.atan2(
          launcher.world.x - operator.world.x,
          launcher.world.z - operator.world.z,
        )
      : 0;
  const geometry: Geometry = {
    gunnerArms: arms?.world ?? null,
    roundLocal: round?.local ?? null,
    spare: find("a_spare")?.world ?? null,
    launcherTurn: turn,
    carry:
      anchor !== undefined && launcher !== undefined
        ? anchor.clone().sub(launcher.world)
        : null,
  };
  geometries.set(model, geometry);
  return geometry;
}

/** The round at the gunner's muzzle: gone at the shot, then pushed in from the
 *  front of the muzzle once the assistant has brought it (arms frame). */
function roundPose(s: RigState, out: LimbPose): void {
  const f = reloadProgress(s);
  if (f < RELOAD.slideIn[0]) {
    out.sx = out.sy = out.sz = 0;
    return;
  }
  const slide = smooth(RELOAD.slideIn[0], RELOAD.slideIn[1], f);
  out.y = ROUND_FRONT.y * (1 - slide);
  out.z = ROUND_FRONT.z * (1 - slide);
}

/** The spare round of the assistant, flying in the hull frame from his rocket
 *  carrier to the front of the lowered muzzle, nose first. */
function spareRoundPose(
  s: RigState,
  g: Geometry,
  assistant: Man,
  out: LimbPose,
): void {
  const f = reloadProgress(s);
  const [from, to] = RELOAD.handOver;
  const { spare, gunnerArms: arms, roundLocal: local } = g;
  if (
    f < from ||
    f >= RELOAD.slideIn[0] ||
    spare === null ||
    arms === null ||
    local === null
  ) {
    out.sx = out.sy = out.sz = 0;
    return;
  }
  const travel = smooth(from, to, f);
  const drop = KNEEL_DROP * assistant.height * kneelOf(assistant, s);
  // The muzzle front while the launcher hangs lowered, from the shoulder.
  const fy = ROUND_FRONT.y + local.y;
  const fz = ROUND_FRONT.z + local.z;
  const sin = Math.sin(RELOAD_PITCH);
  const cos = Math.cos(RELOAD_PITCH);
  const endX = arms.x + local.x;
  const endY = arms.y - drop + fy * cos - fz * sin;
  const endZ = arms.z + fy * sin + fz * cos;
  out.x = (endX - spare.x) * travel;
  out.y =
    (endY - spare.y) * travel -
    drop * (1 - travel) +
    ROUND_ARC * Math.sin(Math.PI * travel);
  out.z = (endZ - spare.z) * travel;
  // Upright in the rack, lying along the lowered launcher at the end.
  out.rx = (RELOAD_PITCH + Math.PI / 2) * travel;
}

function pose(
  man: Man,
  part: string,
  s: RigState,
  out: LimbPose,
  g: Geometry,
): void {
  const k = kneelOf(man, s);
  const turn = 2 * Math.PI * (s.phase + man.phase);
  const f = reloadProgress(s);
  const kick = clamp01(1 - s.sinceShot / KICK_MS);
  const bend = man.pickup === true ? bending(s.carry) : 0;
  const hand = man.feeds === true ? handing(f) : 0;
  // A hit that did not kill: arms jerk, knees give for a moment.
  const jolt = Math.min(1, Math.abs(s.flinch) / 0.4);
  switch (part) {
    case "hips":
      out.y =
        (-KNEEL_DROP * k + STEP_BOB * s.walk * Math.cos(2 * turn)) * man.height;
      out.rx = 0.06 * s.walk + KNEEL_LEAN[man.weapon] * k + 0.55 * bend;
      out.ry =
        0.1 * s.walk * Math.sin(turn) + g.launcherTurn * bend - 0.8 * hand;
      break;
    case "thigh_l":
      out.rx = -SWING * s.walk * Math.sin(turn) + KNEEL.thighL * k;
      break;
    case "thigh_r":
      out.rx = SWING * s.walk * Math.sin(turn) + KNEEL.thighR * k;
      break;
    case "shin_l":
      out.rx =
        FLEX * s.walk * Math.max(0, Math.cos(turn)) +
        KNEEL.shinL * k +
        0.35 * jolt;
      break;
    case "shin_r":
      out.rx =
        FLEX * s.walk * Math.max(0, -Math.cos(turn)) +
        KNEEL.shinR * k +
        0.35 * jolt;
      break;
    case "arms": {
      if (man.weapon === "rifle") {
        // Low ready, raised on a target; the walk swings it a little. The
        // assistant lifts his arms out to the gunner while he hands a round over.
        out.rx =
          -0.55 * s.aim + 0.1 * s.walk - 0.05 * kick - 0.7 * hand - 0.9 * jolt;
        out.ry = -0.06 * s.walk * Math.sin(turn);
        out.z = -0.012 * kick;
      } else if (man.weapon === "rpg") {
        out.rx = rpgPitch(s) - 0.5 * jolt;
        out.z = -0.02 * kick;
      } else {
        out.rx = 0.08 * s.walk + 0.9 * bend;
      }
      break;
    }
    case "round":
      roundPose(s, out);
      break;
    case "spare":
      spareRoundPose(s, g, man, out);
      break;
    case "launcher": {
      const c = smooth(PICKUP.lift[0], PICKUP.lift[1], s.carry);
      if (g.carry !== null) {
        out.x = g.carry.x * c;
        out.y = g.carry.y * c + CARRY_ARC * Math.sin(Math.PI * c);
        out.z = g.carry.z * c;
        // Slung on the back, muzzle up.
        out.rx = -LAUNCHER_SLING * c;
      }
      break;
    }
    case "tripod": {
      // Folds its legs together and swings them back along the tube.
      const fold = smooth(PICKUP.fold[0], PICKUP.fold[1], s.carry);
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
      out.sx = out.sy = out.sz = 1 - smooth(0, 0.1, s.carry);
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

const PROP: Man = {
  weapon: "console",
  kneels: false,
  height: 1,
  phase: 0,
};

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
  const geometry = geometryOf(model);
  // Props of the team (`x_*`) follow the team's state.
  pose(men[prefix] ?? PROP, part, s, out, geometry);
  return out;
}

/** Whether `typeId` has a rig, i.e. infantry that animate through limbs. */
export function isRigged(typeId: string): boolean {
  return RIGS[typeId] !== undefined;
}

const NO_GEOMETRY: Geometry = {
  gunnerArms: null,
  roundLocal: null,
  spare: null,
  launcherTurn: 0,
  carry: null,
};

/** Joint angles (rx of each limb) and kneel factor of each man of `typeId` in
 *  state `s`: the pose a soldier dies in, which his ragdoll starts from. */
export function poseOnDeath(
  typeId: string,
  s: RigState,
): { kneel: number; joints: Record<string, Record<string, number>> } {
  const joints: Record<string, Record<string, number>> = {};
  let kneel = 0;
  let first = true;
  const probe = resetPose({} as LimbPose);
  for (const [prefix, man] of Object.entries(RIGS[typeId] ?? {})) {
    const angles: Record<string, number> = {};
    for (const part of ["thigh_l", "thigh_r", "shin_l", "shin_r", "arms"]) {
      pose(man, part, s, resetPose(probe), NO_GEOMETRY);
      angles[part] = probe.rx;
    }
    joints[prefix] = angles;
    if (first) kneel = kneelOf(man, s);
    first = false;
  }
  return { kneel, joints };
}
