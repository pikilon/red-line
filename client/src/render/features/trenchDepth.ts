/** Spec 35: how far infantry standing in a finished trench sink below the
 *  ground, so only head and shoulders show above the parapet (the terrain and
 *  the trench floor hide the rest, as a garrisoned soldier is hidden by its
 *  building). The earthwork renderer publishes the finished trenches here. */

/** Tiles a soldier sinks into a finished trench. */
export const TRENCH_SINK = 0.2;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

let finished: readonly Rect[] = [];

/** Replaces the finished trenches (tile rectangles). */
export function setFinishedTrenches(rects: readonly Rect[]): void {
  finished = rects;
}

/** Tiles to sink a soldier at tile (x, y): `TRENCH_SINK` in a finished trench. */
export function trenchSink(x: number, y: number): number {
  for (const rect of finished) {
    if (
      x >= rect.x &&
      x < rect.x + rect.width &&
      y >= rect.y &&
      y < rect.y + rect.height
    ) {
      return TRENCH_SINK;
    }
  }
  return 0;
}
