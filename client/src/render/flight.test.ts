import { describe, expect, it } from "vitest";
import type { ProjectileState } from "../sim/combatSnapshot";
import { FLIGHT_PROFILES, flightPoint, flightSample } from "./flight";

const H0 = 0.5;
const APEX = 6;

function projectile(extra: Partial<ProjectileState> = {}): ProjectileState {
  return {
    id: 0,
    owner: 0,
    weapon: 0,
    shooter: 1,
    target: 2,
    originX: 0,
    originY: 0,
    impactX: 10,
    impactY: 0,
    launchTick: 0,
    impactTick: 10,
    ...extra,
  };
}

describe("AC-17-12: flight profiles", () => {
  it("straight at t = 0.5 is halfway at the mean height", () => {
    const sample = flightSample("straight", 0.5, H0, APEX);
    expect(sample.s).toBeCloseTo(0.5, 9);
    expect(sample.z).toBeCloseTo(0.35, 9);
  });

  it("boost covers 0.325 at t = 0.5 and ends over 5x faster than it starts", () => {
    expect(flightSample("boost", 0.5, H0, APEX).s).toBeCloseTo(0.325, 9);
    const dt = 1e-4;
    const start = flightSample("boost", dt, H0, APEX).s / dt;
    const end =
      (flightSample("boost", 1, H0, APEX).s -
        flightSample("boost", 1 - dt, H0, APEX).s) /
      dt;
    expect(end).toBeGreaterThan(5 * start);
  });

  it("topAttack climbs to the apex over 10 % of the ground, then dives", () => {
    const top = flightSample("topAttack", 0.3, H0, APEX);
    expect(top.s).toBeCloseTo(0.1, 9);
    expect(top.z).toBeCloseTo(6, 9);
    const end = flightSample("topAttack", 1, H0, APEX);
    expect(end.s).toBeCloseTo(1, 9);
    expect(end.z).toBeCloseTo(0, 9);
    expect(flightSample("topAttack", 0.15, H0, APEX).z).toBeGreaterThan(4);
  });

  it("ballistic over 10 tiles with apex 0 peaks at 2.75 tiles", () => {
    const point = flightPoint(projectile(), 5, "ballistic", H0, 0);
    expect(point.t).toBeCloseTo(0.5, 9);
    expect(point.x).toBeCloseTo(5, 9);
    expect(point.z).toBeCloseTo(2.75, 9);
  });

  it("every profile starts at s = 0 and ends at s = 1", () => {
    for (const profile of FLIGHT_PROFILES) {
      expect(flightSample(profile, 0, H0, APEX).s).toBeCloseTo(0, 9);
      expect(flightSample(profile, 1, H0, APEX).s).toBeCloseTo(1, 9);
    }
  });

  it("flightPoint clamps t and points along the flight", () => {
    const before = flightPoint(projectile(), -3, "straight", H0, 0);
    expect(before.t).toBe(0);
    expect(before.x).toBeCloseTo(0, 9);
    expect(before.dx).toBeGreaterThan(0.9);
    const after = flightPoint(projectile(), 30, "straight", H0, 0);
    expect(after.t).toBe(1);
    expect(after.x).toBeCloseTo(10, 9);
    const dive = flightPoint(projectile(), 9, "topAttack", H0, APEX);
    expect(dive.dz).toBeLessThan(0);
    expect(Math.hypot(dive.dx, dive.dy, dive.dz)).toBeCloseTo(1, 9);
  });
});
