export const PAN_SPEED_TILES_PER_SECOND = 20;
/** Screen-relative directions mapped to world (x, z) for the fixed camera. */
export const PAN_KEYS = {
  ArrowUp: [-1, -1],
  KeyW: [-1, -1],
  ArrowDown: [1, 1],
  KeyS: [1, 1],
  ArrowLeft: [-1, 1],
  KeyA: [-1, 1],
  ArrowRight: [1, -1],
  KeyD: [1, -1],
} as const;

export function panDelta(
  _pressed: ReadonlySet<string>,
  _dtSeconds: number,
): { x: number; y: number } {
  return { x: 0, y: 0 };
}
