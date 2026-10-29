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
  /** Two fingers slid together: the ground under `from` follows to `to`
   *  (screen px). Only the midpoint is used, never the angle between the
   *  fingers, so a twist can never rotate the view. */
  pan?(from: { x: number; y: number }, to: { x: number; y: number }): void;
}

/** The midpoint must travel this far (px) before it counts as a pan, so the
 *  small drift of an ordinary pinch never moves the map. */
export const PAN_THRESHOLD_PX = 12;
/** A pan needs the finger distance to change by less than this share of the
 *  midpoint's travel, so a pinch (distance changes, midpoint stays) never pans. */
export const PAN_SPREAD_RATIO = 0.6;

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
  let startMid = { x: 0, y: 0 };
  let lastMid = { x: 0, y: 0 };

  function midpoint(): { x: number; y: number } {
    const [a, b] = [...points.values()];
    if (a === undefined || b === undefined) return lastMid;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function distance(): number {
    const [a, b] = [...points.values()];
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function startPinch(): void {
    startDistance = distance();
    startZoom = options.zoom();
    pinching = startDistance > 0;
    startMid = midpoint();
    lastMid = startMid;
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
      const mid = midpoint();
      // Two fingers rarely report in the same event: a pinch looks like a
      // sliding midpoint for one event. A pan keeps the finger distance, so
      // the map only follows while the distance has stayed near its start
      // relative to how far the midpoint has travelled.
      const travel = Math.hypot(mid.x - startMid.x, mid.y - startMid.y);
      const spread = Math.abs(distance() - startDistance);
      if (travel >= PAN_THRESHOLD_PX && spread <= PAN_SPREAD_RATIO * travel) {
        options.pan?.(lastMid, mid);
      }
      lastMid = mid;
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
