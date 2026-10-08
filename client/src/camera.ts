import { OrthographicCamera } from "three";

/** Elevation of the fixed isometric camera: atan(1 / sqrt(2)) ≈ 35.264°. */
export const ISOMETRIC_ELEVATION = Math.atan(1 / Math.SQRT2);

const VIEW_HEIGHT = 20;
const DISTANCE = 50;

export function createIsometricCamera(aspect: number): OrthographicCamera {
  const halfHeight = VIEW_HEIGHT / 2;
  const camera = new OrthographicCamera(
    -halfHeight * aspect,
    halfHeight * aspect,
    halfHeight,
    -halfHeight,
    0.1,
    200,
  );
  const horizontal = Math.cos(ISOMETRIC_ELEVATION) * DISTANCE;
  const diagonal = horizontal / Math.SQRT2;
  camera.position.set(
    diagonal,
    Math.sin(ISOMETRIC_ELEVATION) * DISTANCE,
    diagonal,
  );
  camera.lookAt(0, 0, 0);
  return camera;
}
