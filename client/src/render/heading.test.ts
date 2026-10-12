import { describe, expect, it } from "vitest";
import { typeDef, typeIndex } from "../rules";
import { createHeadingTracker, turnRatesOf, turnTowards } from "./heading";

describe("heading", () => {
  it("AC-06-05: heading and turret aim", () => {
    const tracker = createHeadingTracker();

    expect(tracker.update(0, 0, 0, null).yaw).toBe(0);
    const moved = tracker.update(0, 1, 0, null);
    expect(moved.yaw).toBeCloseTo(Math.PI / 2, 6);

    const stationary = tracker.update(0, 1, 0, null);
    expect(stationary.yaw).toBeCloseTo(Math.PI / 2, 6);

    const aimed = tracker.update(1, 4, 6, { x: 4, y: 7 });
    expect(aimed.turretYaw).toBeCloseTo(0, 6);

    const hullOnly = tracker.update(2, 0, 0, null);
    expect(hullOnly.turretYaw).toBe(hullOnly.yaw);
  });

  it("AC-06-08: gradual turning", () => {
    const rates = { hull: Math.PI, turret: 1.5 * Math.PI };

    // turnTowards moves by at most maxStep and normalises to (−π, π].
    expect(turnTowards(0, Math.PI / 2, 0.1)).toBeCloseTo(0.1, 6);

    // The short arc from 3 to −3 crosses ±π instead of passing through 0.
    expect(turnTowards(3, -3, 1)).toBeCloseTo(-3, 6);
    const first = turnTowards(3, -3, 0.14);
    const second = turnTowards(first, -3, 0.14);
    expect(first).toBeCloseTo(Math.PI, 2);
    expect(second).toBeCloseTo(-3, 2);

    // A unit first seen moving along +x snaps to π/2 ...
    const tracker = createHeadingTracker();
    tracker.update(0, 0, 0, null);
    const snapped = tracker.update(0, 1, 0, null, 0, rates);
    expect(snapped.yaw).toBeCloseTo(Math.PI / 2, 6);

    // ... then reversing to −x turns by at most π × 0.1 rad over 100 ms ...
    let x = 1;
    let heading = snapped;
    for (let step = 1; step <= 10; step++) {
      x -= 1;
      heading = tracker.update(0, x, 0, null, step * 100, rates);
      if (step === 1) {
        expect(Math.abs(heading.yaw - snapped.yaw)).toBeLessThanOrEqual(
          Math.PI * 0.1 + 1e-9,
        );
        expect(heading.yaw).toBeGreaterThan(-Math.PI / 2);
      }
    }

    // ... and reaches −π/2 after one second.
    expect(heading.yaw).toBeCloseTo(-Math.PI / 2, 6);

    // A turret whose target jumps behind it turns at 1.5π × dt.
    const turret = createHeadingTracker();
    turret.update(0, 0, 0, { x: 0, y: 1 }, 0, rates);
    const jumped = turret.update(0, 0, 0, { x: 0, y: -1 }, 100, rates);
    expect(jumped.turretYaw).toBeCloseTo(1.5 * Math.PI * 0.1, 6);

    // A dt over 250 ms is clamped before applying the rate.
    const clamped = createHeadingTracker();
    clamped.update(0, 0, 0, null, 0, rates);
    const slow = clamped.update(0, 1, 0, null, 5000, rates);
    expect(slow.yaw).toBeCloseTo(Math.PI * 0.25, 6);

    // Without rates the results equal AC-06-05 (instant).
    const plain = createHeadingTracker();
    plain.update(0, 0, 0, null);
    expect(plain.update(0, 1, 0, null).yaw).toBeCloseTo(Math.PI / 2, 6);
  });

  it("AC-06-09: turn rates from data", () => {
    const leopard = turnRatesOf(typeDef(typeIndex("ua-leopard-2a4")));
    expect(leopard.hull).toBeCloseTo(Math.PI, 6);
    expect(leopard.turret).toBeCloseTo(0.75 * Math.PI, 6);

    const rifleman = turnRatesOf(typeDef(typeIndex("ua-rifleman")));
    expect(rifleman.hull).toBeCloseTo(4 * Math.PI, 6);
    expect(rifleman.turret).toBeCloseTo(rifleman.hull, 6);
  });
});
