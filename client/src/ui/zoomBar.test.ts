import { describe, expect, it } from "vitest";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../camera";
import {
  SLIDER_MAX,
  sliderToZoom,
  zoomStepIn,
  zoomStepOut,
  zoomToSlider,
} from "./zoomBar";

describe("zoom bar stepping", () => {
  it("steps by the wheel step", () => {
    expect(zoomStepIn(1)).toBeCloseTo(ZOOM_STEP, 6);
    expect(zoomStepOut(1)).toBeCloseTo(1 / ZOOM_STEP, 6);
  });

  it("keeps the wheel clamps", () => {
    expect(zoomStepIn(ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(zoomStepOut(ZOOM_MIN)).toBe(ZOOM_MIN);
  });

  it("maps the slider to the full wheel range", () => {
    expect(sliderToZoom(0)).toBeCloseTo(ZOOM_MIN, 6);
    expect(sliderToZoom(SLIDER_MAX)).toBeCloseTo(ZOOM_MAX, 6);
    expect(sliderToZoom(-50)).toBeCloseTo(ZOOM_MIN, 6);
    expect(sliderToZoom(SLIDER_MAX * 2)).toBeCloseTo(ZOOM_MAX, 6);
    expect(zoomToSlider(sliderToZoom(437))).toBeCloseTo(437, 0);
  });
});
