import { describe, expect, it } from "vitest";
import {
  acceptsRiders,
  markerKey,
  pipRows,
  showsMarker,
} from "./garrisonMarkers";

const building = { index: 0, x: 0, y: 0, width: 2, height: 2, slots: 4 };

describe("garrison markers", () => {
  it("wraps pips onto rows of five", () => {
    expect(pipRows(4)).toEqual([4]);
    expect(pipRows(10)).toEqual([5, 5]);
    expect(pipRows(7)).toEqual([5, 2]);
  });

  it("keys the look by capacity, occupancy and holder only when occupied", () => {
    expect(markerKey(4, 0, 255)).toBe(markerKey(4, 0, 1));
    expect(markerKey(4, 2, 0)).not.toBe(markerKey(4, 2, 1));
    expect(markerKey(4, 9, 0)).toBe(markerKey(4, 4, 0));
  });

  it("hides on wrecked buildings and trench pieces", () => {
    expect(showsMarker(building)).toBe(true);
    expect(showsMarker({ ...building, closed: true })).toBe(false);
    expect(showsMarker({ ...building, trench: true })).toBe(false);
  });

  it("is ready only for a building with room and no foreign holder", () => {
    expect(acceptsRiders({ ...building, owner: 255, occupants: 0 }, 0)).toBe(
      true,
    );
    expect(acceptsRiders({ ...building, owner: 0, occupants: 4 }, 0)).toBe(
      false,
    );
    expect(acceptsRiders({ ...building, owner: 1, occupants: 1 }, 0)).toBe(
      false,
    );
    expect(acceptsRiders({ ...building, owner: 0, occupants: 1 }, 0)).toBe(
      true,
    );
  });
});
