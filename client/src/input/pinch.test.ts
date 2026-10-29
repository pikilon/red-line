import { describe, expect, it } from "vitest";
import { createPinchGesture, type PinchPointer } from "./pinch";

function touch(id: number, x: number, y: number): PinchPointer {
  return { pointerId: id, pointerType: "touch", clientX: x, clientY: y };
}

function mouse(id: number, x: number, y: number): PinchPointer {
  return { pointerId: id, pointerType: "mouse", clientX: x, clientY: y };
}

function setup(startZoom = 1) {
  let zoom = startZoom;
  let begins = 0;
  const pinch = createPinchGesture({
    zoom: () => zoom,
    setZoom: (value) => {
      zoom = value;
    },
    begin: () => {
      begins += 1;
    },
  });
  return {
    pinch,
    begins: () => begins,
    zoom: () => zoom,
  };
}

describe("pinch gesture", () => {
  it("AC-08-22: two fingers scale the zoom and clamp to the wheel limits", () => {
    const { pinch, begins, zoom } = setup();
    const first = touch(1, 100, 200);
    const second = touch(2, 200, 200);

    expect(pinch.down(first)).toBe(false);
    expect(pinch.down(second)).toBe(true);
    expect(pinch.active()).toBe(true);
    expect(begins()).toBe(1);

    // Distance 100 -> 200 zooms in exactly like two wheel notches' worth.
    expect(pinch.move(touch(2, 300, 200))).toBe(true);
    expect(zoom()).toBe(2);

    expect(pinch.move(touch(2, 1000, 200))).toBe(true);
    expect(zoom()).toBe(3);

    expect(pinch.move(touch(2, 90, 200))).toBe(true);
    expect(zoom()).toBe(0.6);
  });

  it("AC-08-22: a single finger or a mouse never zooms or clicks like a pinch", () => {
    const { pinch, begins, zoom } = setup();
    expect(pinch.down(touch(1, 100, 100))).toBe(false);
    expect(pinch.move(touch(1, 300, 300))).toBe(false);
    expect(pinch.up(touch(1, 300, 300))).toBe(false);
    expect(pinch.down(mouse(2, 100, 100))).toBe(false);
    expect(pinch.move(mouse(2, 500, 500))).toBe(false);
    expect(pinch.up(mouse(2, 500, 500))).toBe(false);
    expect(begins()).toBe(0);
    expect(zoom()).toBe(1);
  });

  it("AC-08-22: the pinch owns every release until all fingers are up", () => {
    const { pinch, zoom } = setup();
    pinch.down(touch(1, 100, 100));
    pinch.down(touch(2, 200, 100));
    pinch.move(touch(2, 300, 100));
    expect(zoom()).toBe(2);
    // Both releases are swallowed, so the pinch cannot select or order.
    expect(pinch.up(touch(2, 300, 100))).toBe(true);
    expect(pinch.up(touch(1, 100, 100))).toBe(true);
    expect(pinch.active()).toBe(false);
    // The next single tap behaves like a normal click again.
    expect(pinch.down(touch(1, 10, 10))).toBe(false);
    expect(pinch.up(touch(1, 10, 10))).toBe(false);
  });

  it("AC-08-22: cancel drops the pinch and its pointers", () => {
    const { pinch, zoom } = setup();
    pinch.down(touch(1, 100, 100));
    pinch.down(touch(2, 200, 100));
    pinch.move(touch(2, 300, 100));
    expect(zoom()).toBe(2);
    pinch.cancel();
    expect(pinch.active()).toBe(false);
    expect(pinch.up(touch(2, 300, 100))).toBe(false);
    expect(pinch.up(touch(1, 100, 100))).toBe(false);
    expect(zoom()).toBe(2);
  });

  it("two fingers sliding together pan; a small pinch drift does not", () => {
    const moves: Array<[number, number]> = [];
    const pinch = createPinchGesture({
      zoom: () => 1,
      setZoom: () => {},
      begin: () => {},
      pan: (from, to) => moves.push([to.x - from.x, to.y - from.y]),
    });
    pinch.down(touch(1, 100, 200));
    pinch.down(touch(2, 200, 200));
    pinch.move(touch(1, 96, 200));
    pinch.move(touch(2, 204, 200));
    expect(moves).toEqual([]);
    pinch.move(touch(1, 140, 230));
    pinch.move(touch(2, 240, 230));
    expect(moves.length).toBe(1);
    expect(moves.at(-1)).toEqual([18, 15]);
  });
});
