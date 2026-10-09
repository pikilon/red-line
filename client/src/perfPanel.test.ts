import { describe, expect, it } from "vitest";
import { summarizeFrames } from "./perfPanel";

const repeat = (value: number, count: number): number[] =>
  Array.from({ length: count }, () => value);

describe("perfPanel", () => {
  it("AC-02-46: summarizes a rolling window of frame times", () => {
    expect(summarizeFrames([])).toEqual({ fps: 0, p95FrameMs: 0, bad: false });
    expect(summarizeFrames(repeat(16, 120))).toEqual({
      fps: 63,
      p95FrameMs: 16,
      bad: false,
    });
    expect(summarizeFrames([...repeat(16, 113), ...repeat(40, 7)])).toEqual({
      fps: 57,
      p95FrameMs: 40,
      bad: true,
    });
    const nearlyBad = summarizeFrames([...repeat(16, 114), ...repeat(40, 6)]);
    expect(nearlyBad.p95FrameMs).toBe(16);
    expect(nearlyBad.bad).toBe(false);
    expect(summarizeFrames(repeat(19, 120)).bad).toBe(false);
    expect(summarizeFrames(repeat(19.5, 120)).bad).toBe(true);
    expect(summarizeFrames([...repeat(100, 80), ...repeat(10, 120)])).toEqual({
      fps: 100,
      p95FrameMs: 10,
      bad: false,
    });
  });
});
