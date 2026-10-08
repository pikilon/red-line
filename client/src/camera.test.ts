import { describe, expect, it } from "vitest";
import { createIsometricCamera, ISOMETRIC_ELEVATION } from "./camera";

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
});
