export const PERF_WINDOW_FRAMES = 120;
export const PERF_BAD_P95_MS = 19;
export const PERF_PANEL_UPDATE_MS = 250;

export interface PerfSummary {
  fps: number;
  p95FrameMs: number;
  bad: boolean;
}

export function summarizeFrames(_frameTimesMs: readonly number[]): PerfSummary {
  return { fps: 0, p95FrameMs: 0, bad: false };
}
