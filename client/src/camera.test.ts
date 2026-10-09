import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  createIsometricCamera,
  ISOMETRIC_ELEVATION,
  setCameraTarget,
} from "./camera";

describe("isometric camera", () => {
  it("is orthographic and looks at the origin from the isometric angle", () => {
    const camera = createIsometricCamera(16 / 9);
    expect(camera.isOrthographicCamera).toBe(true);
    expect(camera.position.y).toBeGreaterThan(0);
    const horizontal = Math.hypot(camera.position.x, camera.position.z);
    expect(Math.atan2(camera.position.y, horizontal)).toBeCloseTo(
      ISOMETRIC_ELEVATION,
      5,
    );
  });

  it("keeps the isometric offset when the target moves", () => {
    const camera = createIsometricCamera(16 / 9);
    const offset = camera.position.clone();
    const direction = camera.getWorldDirection(new Vector3());
    setCameraTarget(camera, 12, 30);
    expect(camera.position.x).toBeCloseTo(offset.x + 12, 6);
    expect(camera.position.y).toBeCloseTo(offset.y, 6);
    expect(camera.position.z).toBeCloseTo(offset.z + 30, 6);
    const moved = camera.getWorldDirection(new Vector3());
    expect(moved.distanceTo(direction)).toBeCloseTo(0, 6);
  });
});
