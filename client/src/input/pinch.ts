import { zoomAfterPinch } from "../camera";

/** The subset of a `PointerEvent` the pinch gesture reads. */
export interface PinchPointer {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

/** What the pinch gesture reads and writes (spec 08 §3.8). */
export interface PinchGestureOptions {
  /** Current camera zoom. */
  zoom(): number;
  /** Sets the camera zoom, already clamped to [ZOOM_MIN, ZOOM_MAX]. */
  setZoom(zoom: number): void;
  /** Two fingers just landed: cancels a drag selection or placement ghost. */
  begin(): void;
}

/**
 * Two-finger pinch over the map (spec 08 §3.8). Spreading the fingers scales
 * the camera zoom around the starting distance, so the view grows like a
 * wheel-up notch; the camera target stays put and the page itself never zooms.
 * Every method returns true while the pointer belongs to a pinch, which tells
 * the caller to skip the mouse behaviour (drag selection, clicks and orders).
 */
export interface PinchGesture {
  /** Tracks a touch `pointerdown`; true when the pointer starts/joins a pinch. */
  down(pointer: PinchPointer): boolean;
  /** Tracks a touch move and applies the zoom; true while pinching. */
  move(pointer: PinchPointer): boolean;
  /** Ends a touch; true when the release must not become a click. */
  up(pointer: PinchPointer): boolean;
  /** Drops every tracked pointer (`pointercancel`, window blur). */
  cancel(): void;
  /** Whether two fingers are zooming right now. */
  active(): boolean;
}

export function createPinchGesture(options: PinchGestureOptions): PinchGesture {
  const points = new Map<number, { x: number; y: number }>();
  let startDistance = 0;
  let startZoom = 1;
  let pinching = false;
  /** Stays true from the second finger until every finger is released, so a
   *  pinch never ends in a selection box or an order. */
  let suppress = false;

  function distance(): number {
    const [a, b] = [...points.values()];
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function startPinch(): void {
    startDistance = distance();
    startZoom = options.zoom();
    pinching = startDistance > 0;
    if (pinching) options.begin();
  }

  return {
    down(pointer) {
      if (pointer.pointerType !== "touch") return false;
      points.set(pointer.pointerId, {
        x: pointer.clientX,
        y: pointer.clientY,
      });
      if (points.size >= 2) suppress = true;
      if (points.size === 2) startPinch();
      return suppress;
    },
    move(pointer) {
      if (!points.has(pointer.pointerId)) return false;
      points.set(pointer.pointerId, {
        x: pointer.clientX,
        y: pointer.clientY,
      });
      if (!pinching || points.size !== 2) return suppress;
      const current = options.zoom();
      const next = zoomAfterPinch(startZoom, startDistance, distance());
      if (next !== current) options.setZoom(next);
      return true;
    },
    up(pointer) {
      if (!points.delete(pointer.pointerId)) return false;
      const swallow = suppress;
      pinching = false;
      // A third finger ended: the two left start a fresh pinch from here.
      if (points.size === 2) startPinch();
      if (points.size === 0) suppress = false;
      return swallow;
    },
    cancel() {
      points.clear();
      pinching = false;
      suppress = false;
    },
    active() {
      return pinching;
    },
  };
}
