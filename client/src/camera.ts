import { OrthographicCamera } from "three";

/** Elevation of the fixed isometric camera: atan(1 / sqrt(2)) ≈ 35.264°. */
export const ISOMETRIC_ELEVATION = Math.atan(1 / Math.SQRT2);

const VIEW_HEIGHT = 20;
const DISTANCE = 50;
const HORIZONTAL_DIAGONAL =
  (Math.cos(ISOMETRIC_ELEVATION) * DISTANCE) / Math.SQRT2;
/** Camera position relative to the point it looks at. */
const OFFSET = {
  x: HORIZONTAL_DIAGONAL,
  y: Math.sin(ISOMETRIC_ELEVATION) * DISTANCE,
  z: HORIZONTAL_DIAGONAL,
} as const;

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
  setCameraTarget(camera, 0, 0);
  return camera;
}

/** Keeps the isometric offset of createIsometricCamera, looks at (x, 0, z). */
export function setCameraTarget(
  camera: OrthographicCamera,
  x: number,
  z: number,
): void {
  camera.position.set(x + OFFSET.x, OFFSET.y, z + OFFSET.z);
  camera.lookAt(x, 0, z);
}
