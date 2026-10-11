import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPerfPanel,
  PERF_PANEL_UPDATE_MS,
  summarizeFrames,
} from "./perfPanel";

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

  it("refreshes every PERF_PANEL_UPDATE_MS while frames keep arriving", () => {
    interface FakeElement {
      id: string;
      textContent: string;
      children: FakeElement[];
      classList: { toggle(): void };
      appendChild(child: FakeElement): FakeElement;
    }
    const element = (): FakeElement => ({
      id: "",
      textContent: "",
      children: [],
      classList: { toggle: () => undefined },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    });
    vi.stubGlobal("document", { createElement: element });
    const root = element();
    const panel = createPerfPanel(root as unknown as HTMLElement);
    const fps = root.children[0]?.children[0];

    panel.record(500, 0);
    for (let now = 16; now <= PERF_PANEL_UPDATE_MS * 4; now += 16) {
      panel.record(16, now);
    }
    expect(fps?.textContent).not.toContain(String(summarizeFrames([500]).fps));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
