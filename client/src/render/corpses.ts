/** Falling soldiers (spec 22): when an infantry unit dies the snapshot drops
 *  it, so the renderer replays its death with the same rigid limbs it walked
 *  with. Each man is a small ragdoll: the body is a rod that tips over (or is
 *  thrown) under gravity with a ground contact, and the thighs, shins and arms
 *  are damped pendulums with joint limits that start in the pose he died in.
 *  The simulation is deterministic (seeded by the soldier id, fixed step) and
 *  client-only; nothing here touches the game simulation. */

import { KNEEL, KNEEL_DROP, type LimbPose, resetPose } from "./rig";

/** `crush`: run over by tracks; `shove`: knocked down by a wheeled vehicle
 *  (spec 28), which falls like a shot. */
export type DeathKind = "shot" | "explosion" | "crush" | "shove";

export interface DeathCause {
  readonly kind: DeathKind;
  /** Direction the body is pushed, in the tile plane (atan2(dy, dx)). */
  readonly push: number;
}

export type JointName = "thigh_l" | "thigh_r" | "shin_l" | "shin_r" | "arms";
export const JOINTS: readonly JointName[] = [
  "thigh_l",
  "thigh_r",
  "shin_l",
  "shin_r",
  "arms",
];
export type ManJoints = Readonly<Record<JointName, number>>;

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
  /** Blood on his clothes, 0 clean .. 1 soaked: the wounds that killed him. */
  readonly blood?: number;
  /** Joint angles of each man (by prefix) when he died: the legs of a walker
   *  start mid-stride, those of a kneeler bent. */
  readonly joints?: Readonly<
    Record<string, Readonly<Partial<Record<JointName, number>>>>
  >;
  readonly startMs: number;
}

/** A body lies this long, and shrinks away over the last `CORPSE_FADE_MS`. */
export const CORPSE_MS = 20_000;
export const CORPSE_FADE_MS = 3000;

/** The shot death styles: stumble, jerked by the hit, crumple. */
export const SHOT_VARIANTS = 3;

// Physics, in tiles and seconds. A soldier is 0.5 tiles tall.
const STEP = 1 / 120;
const GRAVITY = 4;
const LENGTH = 0.5;
/** Half thickness of a lying body, tiles. */
const RADIUS = 0.03;
/** Inertia of the body about its centre (mass 1). */
const INERTIA = (LENGTH * LENGTH) / 10;
/** Inertia of the body about its feet while it tips over them. */
const FEET_INERTIA = INERTIA + (LENGTH / 2) ** 2;
/** Tip angle at which the feet leave the ground and the body falls free. */
const RELEASE_ANGLE = 1;
const FRICTION = 0.8;
const MAX_SIM_SECONDS = 6;

const LEG = 0.12;
const PENDULUM = { legs: 30, arms: 24 } as const;
const JOINT_DAMPING = 2.2;
const JOINT_SPRING = 1;
/** How much of the body's angular acceleration the limbs lag behind. */
const INERTIAL_COUPLING = 0.8;
const LIMITS: Readonly<Record<JointName, readonly [number, number]>> = {
  thigh_l: [-1.8, 1.4],
  thigh_r: [-1.8, 1.4],
  shin_l: [0, 2.6],
  shin_r: [0, 2.6],
  arms: [-3, 1.6],
};
const CRUMPLE_MS = 380;
const CRUMPLE_SPRING = 40;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Small stable pseudo-random number in [0, 1) from two integers. */
function hash(a: number, b: number): number {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** Style of a shot death, stable per soldier. */
export function variantOf(corpse: Corpse): number {
  const { kind } = corpse.cause;
  return kind === "shot" || kind === "shove" ? corpse.id % SHOT_VARIANTS : 0;
}

type Joints = Record<JointName, number>;

interface ManSim {
  /** Seconds simulated so far. */
  clock: number;
  /** Seconds before the man reacts (the second of a team lags a little). */
  delay: number;
  pinned: boolean;
  /** Tip angle from upright towards the push, and its rate. */
  theta: number;
  w: number;
  /** Centre of mass in the vertical plane along the push (u) and up (z). */
  cu: number;
  cz: number;
  vu: number;
  vz: number;
  /** Seconds spent at rest on the ground. */
  rest: number;
  settled: boolean;
  settledAt: number;
  grounded: boolean;
  a: Joints;
  aw: Joints;
  /** Joint angles of a crumple's collapse, pulled to while it lasts. */
  target: Joints;
  crumple: boolean;
  /** Spring towards the death pose that eases off, for a stiff first moment. */
  start: Joints;
}

function zeroJoints(): Joints {
  return { thigh_l: 0, thigh_r: 0, shin_l: 0, shin_r: 0, arms: 0 };
}

function newSim(corpse: Corpse, prefix: string, index: number): ManSim {
  const a = { ...zeroJoints(), ...(corpse.joints?.[prefix] ?? {}) };
  const aw = zeroJoints();
  const r = (k: number) => hash(corpse.id * 7 + index, k);
  const sim: ManSim = {
    clock: 0,
    delay: index * 0.12,
    pinned: true,
    theta: 0.05,
    w: 0,
    cu: 0,
    cz: LENGTH / 2,
    vu: 0,
    vz: 0,
    rest: 0,
    settled: false,
    settledAt: 0,
    grounded: true,
    a,
    aw,
    target: zeroJoints(),
    crumple: false,
    start: { ...a },
  };
  if (corpse.cause.kind === "explosion") {
    // Thrown: up and away, tumbling, limbs flailing.
    sim.pinned = false;
    sim.grounded = false;
    sim.theta = 0;
    sim.cu = 0.02;
    sim.vu = 0.9 + r(1) * 0.5;
    sim.vz = 1.9 + r(2) * 0.4;
    sim.w = (r(3) < 0.5 ? -1 : 1) * (6 + r(4) * 3);
    for (const joint of JOINTS) {
      sim.aw[joint] = (r(5 + JOINTS.indexOf(joint)) - 0.5) * 16;
    }
    sim.aw.arms = -9 - r(11) * 3;
    return sim;
  }
  if (corpse.cause.kind === "crush") {
    // Run over (spec 28): slammed flat at once along the hull's way, the feet
    // swept from under him and the limbs thrown about.
    sim.pinned = false;
    sim.theta = 0.3;
    sim.vu = 1.3 + r(1) * 0.3;
    sim.w = 7 + r(2) * 2;
    for (const joint of JOINTS) {
      sim.aw[joint] = (r(5 + JOINTS.indexOf(joint)) - 0.5) * 10;
    }
    sim.aw.arms = -8 - r(11) * 3;
    return sim;
  }
  const style = corpse.id % SHOT_VARIANTS;
  if (style === 0) {
    // Stumbles: a push of the chest and the arms reaching.
    sim.w = 0.55 + r(1) * 0.2;
    sim.aw.arms = -4;
  } else if (style === 1) {
    // Jerked by the hit: a hard kick, the arms flung up.
    sim.w = 1.4 + r(1) * 0.3;
    sim.aw.arms = -10;
  } else {
    // Crumples: the knees give way as in the kneel pose, a weak push.
    sim.w = 0.15 + r(1) * 0.1;
    sim.crumple = true;
    sim.target = {
      thigh_l: KNEEL.thighL,
      shin_l: KNEEL.shinL,
      thigh_r: KNEEL.thighR,
      shin_r: KNEEL.shinR,
      arms: 0.7,
    };
  }
  for (const joint of ["thigh_l", "thigh_r"] as const) {
    sim.aw[joint] += (r(6) - 0.5) * 3;
  }
  return sim;
}

/** Applies a ground contact impulse at one end of the body (rod). */
function contact(sim: ManSim, sign: 1 | -1, restitution: number): boolean {
  const s = Math.sin(sim.theta);
  const c = Math.cos(sim.theta);
  const rx = (sign * LENGTH * s) / 2;
  const rz = (sign * LENGTH * c) / 2;
  const height = sim.cz + rz;
  if (height >= RADIUS) return false;
  sim.cz += RADIUS - height;
  const normalSpeed = sim.vz - sim.w * rx;
  if (normalSpeed < 0) {
    const e = normalSpeed < -0.3 ? restitution : 0;
    const jn = (-(1 + e) * normalSpeed) / (1 + (rx * rx) / INERTIA);
    sim.vz += jn;
    sim.w += (-rx * jn) / INERTIA;
    const slip = sim.vu + sim.w * rz;
    const limit = FRICTION * jn;
    const jt = Math.max(
      -limit,
      Math.min(limit, -slip / (1 + (rz * rz) / INERTIA)),
    );
    sim.vu += jt;
    sim.w += (rz * jt) / INERTIA;
  }
  return true;
}

/** Pulls `angle` inside the cone where a limb of `length` hanging from a joint
 *  at `top` height would dip below the ground. `base` is the angle of the part
 *  it hangs from; returns the new joint angle. */
function keepAboveGround(
  joint: number,
  base: number,
  top: number,
  length: number,
): number {
  const total = base + joint;
  const limit = (top - RADIUS) / length;
  if (Math.cos(total) <= limit || limit < -1) return joint;
  const wrapped = Math.atan2(Math.sin(total), Math.cos(total));
  const bound = Math.acos(Math.max(-1, Math.min(1, limit)));
  return Math.sign(wrapped || 1) * bound - base;
}

function stepJoints(sim: ManSim, accel: number): void {
  const gravity = sim.grounded ? 1 : 0.3;
  const crumple = sim.crumple && sim.clock - sim.delay < CRUMPLE_MS / 1000;
  const spring = crumple ? CRUMPLE_SPRING : JOINT_SPRING;
  const limit = (joint: JointName, value: number): number => {
    const [lo, hi] = LIMITS[joint];
    return Math.max(lo, Math.min(hi, value));
  };
  const hip = sim.cz;
  for (const side of ["l", "r"] as const) {
    const thigh = `thigh_${side}` as const;
    const shin = `shin_${side}` as const;
    const aim = (joint: JointName) => (crumple ? sim.target[joint] : 0);
    // Thigh: a pendulum hanging from the hip.
    const alphaT = sim.theta + sim.a[thigh];
    sim.aw[thigh] +=
      (-PENDULUM.legs * gravity * Math.sin(alphaT) -
        JOINT_DAMPING * sim.aw[thigh] -
        spring * (sim.a[thigh] - aim(thigh)) -
        INERTIAL_COUPLING * accel) *
      STEP;
    sim.a[thigh] = limit(thigh, sim.a[thigh] + sim.aw[thigh] * STEP);
    if (
      sim.a[thigh] === LIMITS[thigh][0] ||
      sim.a[thigh] === LIMITS[thigh][1]
    ) {
      sim.aw[thigh] *= -0.2;
    }
    sim.a[thigh] = limit(
      thigh,
      keepAboveGround(sim.a[thigh], sim.theta, hip, LEG),
    );
    // Shin: a pendulum hanging from the knee, bending one way only.
    const alphaS = sim.theta + sim.a[thigh] + sim.a[shin];
    sim.aw[shin] +=
      (-PENDULUM.legs * gravity * Math.sin(alphaS) -
        JOINT_DAMPING * sim.aw[shin] -
        spring * (sim.a[shin] - aim(shin)) -
        INERTIAL_COUPLING * accel) *
      STEP;
    sim.a[shin] = limit(shin, sim.a[shin] + sim.aw[shin] * STEP);
    if (sim.a[shin] === LIMITS[shin][0] || sim.a[shin] === LIMITS[shin][1]) {
      sim.aw[shin] *= -0.2;
    }
    const kneeHeight = hip - LEG * Math.cos(sim.theta + sim.a[thigh]);
    sim.a[shin] = limit(
      shin,
      keepAboveGround(sim.a[shin], sim.theta + sim.a[thigh], kneeHeight, LEG),
    );
  }
  sim.aw.arms +=
    (-PENDULUM.arms * gravity * Math.sin(sim.theta + sim.a.arms) -
      JOINT_DAMPING * sim.aw.arms -
      spring * 0.5 * (sim.a.arms - (crumple ? sim.target.arms : 0)) -
      INERTIAL_COUPLING * accel) *
    STEP;
  sim.a.arms = limit("arms", sim.a.arms + sim.aw.arms * STEP);
}

function stepBody(sim: ManSim, restitution: number): number {
  const before = sim.w;
  if (sim.pinned) {
    sim.w +=
      (((LENGTH / 2) * GRAVITY * Math.sin(sim.theta)) / FEET_INERTIA) * STEP;
    sim.w *= 1 - 0.6 * STEP;
    sim.theta += sim.w * STEP;
    if (sim.theta > RELEASE_ANGLE) {
      sim.pinned = false;
      sim.cu = (LENGTH / 2) * Math.sin(sim.theta);
      sim.cz = (LENGTH / 2) * Math.cos(sim.theta);
      sim.vu = sim.w * (LENGTH / 2) * Math.cos(sim.theta);
      sim.vz = -sim.w * (LENGTH / 2) * Math.sin(sim.theta);
    }
    return (sim.w - before) / STEP;
  }
  sim.vz -= GRAVITY * STEP;
  sim.cu += sim.vu * STEP;
  sim.cz += sim.vz * STEP;
  sim.theta += sim.w * STEP;
  let touching = false;
  for (let pass = 0; pass < 2; pass++) {
    touching = contact(sim, -1, restitution) || touching;
    touching = contact(sim, 1, restitution) || touching;
  }
  sim.grounded = touching;
  if (touching) {
    sim.w *= 1 - 4 * STEP;
    sim.vu *= 1 - 3.5 * STEP;
  } else {
    sim.w *= 1 - 0.3 * STEP;
  }
  const slow =
    Math.abs(sim.vu) < 0.05 && Math.abs(sim.vz) < 0.12 && Math.abs(sim.w) < 0.2;
  sim.rest = touching && slow ? sim.rest + STEP : 0;
  if (sim.rest > 0.2) {
    // Lying still: lay it flat on its side of the rod.
    sim.settled = true;
    sim.settledAt = sim.clock;
    const turns = Math.round((sim.theta - Math.PI / 2) / Math.PI);
    sim.theta = Math.PI / 2 + turns * Math.PI;
    sim.cz = RADIUS;
    sim.vu = sim.vz = sim.w = 0;
  }
  return (sim.w - before) / STEP;
}

function advance(sim: ManSim, corpse: Corpse, seconds: number): void {
  const restitution = corpse.cause.kind === "explosion" ? 0.4 : 0.25;
  const target = Math.min(seconds, MAX_SIM_SECONDS);
  while (sim.clock < target && !sim.settled) {
    sim.clock += STEP;
    if (sim.clock < sim.delay) continue;
    const accel = stepBody(sim, restitution);
    stepJoints(sim, accel);
    if (sim.settled) {
      // The joints stop with the body.
      for (const joint of JOINTS) sim.aw[joint] = 0;
    }
  }
}

const sims = new WeakMap<Corpse, Map<string, ManSim>>();

function simOf(corpse: Corpse, prefix: string, index: number): ManSim {
  let bySim = sims.get(corpse);
  if (bySim === undefined) {
    bySim = new Map();
    sims.set(corpse, bySim);
  }
  let sim = bySim.get(prefix);
  if (sim === undefined) {
    sim = newSim(corpse, prefix, index);
    bySim.set(prefix, sim);
  }
  return sim;
}

/** Placement of one man of a falling body. */
export interface ManBody {
  /** Tiles from where he stood along the push, and height of his feet. */
  u: number;
  lift: number;
  /** Tip angle over his feet towards the push, radians. */
  tilt: number;
  /** Joint angles, radians (see `corpseLimb`). */
  joints: Joints;
  /** 0 .. 1 how far the crumple's collapse got, for the hips. */
  drop: number;
  /** Radians the legs spread sideways once the body lies. */
  splay: number;
  /** 1, shrinking to 0 while the body fades away. */
  scale: number;
}

/** Fade factor of a body `t` ms after its death. */
export function corpseFade(t: number): number {
  return t < CORPSE_MS - CORPSE_FADE_MS
    ? 1
    : clamp01((CORPSE_MS - t) / CORPSE_FADE_MS);
}

/** The state of man `prefix` (the `index`-th of his team) `t` ms after the
 *  death, advancing his simulation; `out` is filled and returned. */
export function manBody(
  corpse: Corpse,
  prefix: string,
  index: number,
  t: number,
  out: ManBody,
): ManBody {
  const sim = simOf(corpse, prefix, index);
  advance(sim, corpse, t / 1000);
  const feetU = sim.pinned ? 0 : sim.cu - (LENGTH / 2) * Math.sin(sim.theta);
  const feetZ = sim.pinned ? 0 : sim.cz - (LENGTH / 2) * Math.cos(sim.theta);
  out.u = feetU;
  out.lift = Math.max(0, feetZ);
  out.tilt = sim.theta;
  // A body at rest is never a ruler: each leg lies a little differently, one
  // knee bent more than the other, the feet apart.
  const lying =
    smooth(0.4, 0.97, Math.abs(Math.sin(sim.theta))) * (sim.settled ? 1 : 0.6);
  const r = (k: number) => hash(corpse.id * 13 + index, 50 + k) - 0.5;
  out.joints = { ...sim.a };
  out.joints.thigh_l += r(0) * 0.5 * lying;
  out.joints.thigh_r += r(1) * 0.5 * lying;
  out.joints.shin_l = Math.max(0, sim.a.shin_l + (0.25 + r(2) * 0.5) * lying);
  out.joints.shin_r = Math.max(0, sim.a.shin_r + (0.25 + r(3) * 0.5) * lying);
  out.splay = (0.14 + 0.1 * (r(4) + 0.5)) * lying;
  const kneel = corpse.kneel ?? 0;
  out.drop = Math.max(
    kneel,
    sim.crumple ? smooth(0, CRUMPLE_MS, Math.max(0, t - sim.delay * 1000)) : 0,
  );
  out.scale = corpseFade(t);
  return out;
}

/** Metrics of where and when the first man comes to rest: the blood pool goes
 *  there. */
export function landing(corpse: Corpse): { u: number; ms: number } {
  const sim = newSim(corpse, "", 0);
  advance(sim, corpse, MAX_SIM_SECONDS);
  const feetU = sim.pinned ? 0 : sim.cu - (LENGTH / 2) * Math.sin(sim.theta);
  return { u: feetU, ms: (sim.settled ? sim.settledAt : 1.2) * 1000 };
}

/** Milliseconds until the first man lies still (the blood pool timing). */
export function settleMs(corpse: Corpse): number {
  return landing(corpse).ms;
}

/** Tiles the first man ends up from where he stood, along the push. */
export function tossReach(corpse: Corpse): number {
  return landing(corpse).u;
}

/** Offsets of the limb `part` of a man from his joint angles, in the plane of
 *  the fall: `along` is the component of the push along his facing (1 when he
 *  falls forward, -1 backward) and `across` the one to his right. */
export function corpseLimb(
  body: ManBody,
  part: string,
  along: number,
  across: number,
  out: LimbPose,
): LimbPose {
  resetPose(out);
  let angle = 0;
  switch (part) {
    case "hips":
      out.y = -KNEEL_DROP * 0.5 * body.drop;
      return out;
    case "thigh_l":
    case "thigh_r":
    case "shin_l":
    case "shin_r":
    case "arms":
      angle = body.joints[part];
      break;
    default:
      return out;
  }
  // The joint turns in the plane of the fall: forwards/backwards for the
  // sagittal part, to the side for the lateral part.
  out.rx = along * angle;
  out.rz = across * angle;
  // The legs fall apart a little sideways (left leg to the left).
  if (part.startsWith("thigh")) {
    out.rz += (part.endsWith("_l") ? 1 : -1) * body.splay;
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
