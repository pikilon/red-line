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

/** Wheel zoom bounds (spec 08 §3.4): 1 is the default view. */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 3;
/** Zoom factor of one wheel notch (`deltaY` = WHEEL_NOTCH pixels). */
export const ZOOM_STEP = 1.15;
export const WHEEL_NOTCH = 100;
/** Lines (`deltaMode` 1, Firefox) to pixels. */
export const WHEEL_LINE_PIXELS = 33;

/** Clamps a camera zoom to the wheel limits (spec 08 §3.4). */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** `zoom × ZOOM_STEP^(−pixels / WHEEL_NOTCH)` clamped to [ZOOM_MIN, ZOOM_MAX]
 *  (spec 08 §3.4): wheel up (negative `deltaY`) zooms in; trackpads send
 *  fractional notches. */
export function zoomAfterWheel(
  zoom: number,
  deltaY: number,
  deltaMode: number,
): number {
  const pixels = deltaMode === 1 ? deltaY * WHEEL_LINE_PIXELS : deltaY;
  const next = zoom * ZOOM_STEP ** (-pixels / WHEEL_NOTCH);
  return clampZoom(next);
}

/** Pinch zoom (spec 08 §3.8): scales `zoom` by the ratio of the two finger
 *  distances and clamps it to the wheel's [ZOOM_MIN, ZOOM_MAX]. Spreading the
 *  fingers zooms in, exactly like a wheel-up notch. A degenerate distance
 *  leaves `zoom` unchanged. */
export function zoomAfterPinch(
  zoom: number,
  fromDistance: number,
  toDistance: number,
): number {
  if (!(fromDistance > 0) || !(toDistance > 0)) return clampZoom(zoom);
  return clampZoom(zoom * (toDistance / fromDistance));
}
