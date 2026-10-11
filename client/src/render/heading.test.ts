import { describe, expect, it } from "vitest";
import { createHeadingTracker } from "./heading";

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
});
