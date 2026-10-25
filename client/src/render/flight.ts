/**
 * Projectile flight profiles (spec 17 §6): pure functions from the flight
 * fraction to the ground fraction covered and the height. The simulation only
 * knows origin, impact and ticks; the arc is presentation.
 */
import type { ProjectileState } from "../sim/combatSnapshot";
import { groundY as groundAt } from "./elevation";

export const FLIGHT_PROFILES = [
  "straight",
  "boost",
  "loft",
  "ballistic",
  "topAttack",
] as const;
export type FlightProfile = (typeof FLIGHT_PROFILES)[number];

/** Tiles; ballistic and topAttack end at 0. */
export const IMPACT_HEIGHT = 0.2;
/** Flight fraction topAttack spends climbing. */
export const TOP_ATTACK_CLIMB = 0.3;
/** Flight fraction between the two samples of the direction. */
const DIRECTION_STEP = 0.02;
/** Share of the ground distance a `ballistic` arc rises at least. */
const BALLISTIC_RISE = 0.25;

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
/** Parabola that is 0 at both ends and 1 in the middle. */
const hump = (t: number): number => 4 * t * (1 - t);

type Sample = { s: number; z: number };

const SAMPLES: Record<
  FlightProfile,
  (t: number, h0: number, apex: number) => Sample
> = {
  straight: (t, h0) => ({ s: t, z: lerp(h0, IMPACT_HEIGHT, t) }),
  boost: (t, h0) => {
    const s = 0.3 * t + 0.7 * t * t;
    return { s, z: lerp(h0, IMPACT_HEIGHT, s) };
  },
  loft: (t, h0, apex) => ({
    s: t,
    z: lerp(h0, IMPACT_HEIGHT, t) + apex * hump(t),
  }),
  // `apex` is already `A = max(apex, 0.25 × ground distance)`; see flightPoint.
  ballistic: (t, h0, apex) => ({ s: t, z: lerp(h0, 0, t) + apex * hump(t) }),
  topAttack: (t, h0, apex) => {
    if (t < TOP_ATTACK_CLIMB) {
      const u = t / TOP_ATTACK_CLIMB;
      return { s: 0.1 * u, z: h0 + (apex - h0) * (1 - (1 - u) ** 2) };
    }
    const u = (t - TOP_ATTACK_CLIMB) / (1 - TOP_ATTACK_CLIMB);
    return { s: 0.1 + 0.9 * u * u, z: apex * (1 - u * u) };
  },
};

/** Horizontal fraction s and height z (tiles) at flight fraction t in [0, 1]. */
export function flightSample(
  profile: FlightProfile,
  t: number,
  h0: number,
  apex: number,
): Sample {
  return SAMPLES[profile](t, h0, apex);
}

/** World position at a fractional tick, plus a unit direction for orientation. */
export function flightPoint(
  p: ProjectileState,
  tick: number,
  profile: FlightProfile,
  h0: number,
  apexTiles: number,
): {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  t: number;
} {
  const span = p.impactTick - p.launchTick;
  const t = span > 0 ? clamp01((tick - p.launchTick) / span) : 1;
  const groundX = p.impactX - p.originX;
  const groundY = p.impactY - p.originY;
  const apex =
    profile === "ballistic"
      ? Math.max(apexTiles, BALLISTIC_RISE * Math.hypot(groundX, groundY))
      : apexTiles;
  // Heights are above the ground line from muzzle to impact, so shots climb
  // to and fall from high ground (spec 30 §4).
  const fromGround = groundAt(p.originX, p.originY);
  const toGround = groundAt(p.impactX, p.impactY);
  const at = (u: number): { x: number; y: number; z: number } => {
    const { s, z } = flightSample(profile, u, h0, apex);
    return {
      x: p.originX + groundX * s,
      y: p.originY + groundY * s,
      z: z + fromGround + (toGround - fromGround) * s,
    };
  };
  const here = at(t);
  const [from, to] =
    t === 0
      ? [here, at(DIRECTION_STEP)]
      : [at(Math.max(0, t - DIRECTION_STEP)), here];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  return length > 0
    ? { ...here, dx: dx / length, dy: dy / length, dz: dz / length, t }
    : { ...here, dx: 0, dy: 0, dz: 1, t };
}
