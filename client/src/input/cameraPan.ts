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

/** Sum of pressed PAN_KEYS vectors, normalised and scaled by speed * dt. */
export function panDelta(
  pressed: ReadonlySet<string>,
  dtSeconds: number,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const code of pressed) {
    const vector = Object.hasOwn(PAN_KEYS, code)
      ? (PAN_KEYS as Record<string, readonly [number, number]>)[code]
      : undefined;
    if (vector === undefined) continue;
    x += vector[0];
    y += vector[1];
  }
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  const scale = (PAN_SPEED_TILES_PER_SECOND * dtSeconds) / length;
  return { x: x * scale, y: y * scale };
}
