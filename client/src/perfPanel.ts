import { t } from "./i18n";

export const PERF_WINDOW_FRAMES = 120;
export const PERF_BAD_P95_MS = 19;
export const PERF_PANEL_UPDATE_MS = 250;

export interface PerfSummary {
  fps: number;
  p95FrameMs: number;
  bad: boolean;
}

/** Pure summary of the last PERF_WINDOW_FRAMES frame times. */
export function summarizeFrames(frameTimesMs: readonly number[]): PerfSummary {
  const window = frameTimesMs.slice(-PERF_WINDOW_FRAMES);
  if (window.length === 0) return { fps: 0, p95FrameMs: 0, bad: false };
  const mean = window.reduce((sum, ms) => sum + ms, 0) / window.length;
  const sorted = [...window].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const p95FrameMs = sorted[index] ?? 0;
  return {
    fps: mean === 0 ? 0 : Math.round(1000 / mean),
    p95FrameMs,
    bad: p95FrameMs > PERF_BAD_P95_MS,
  };
}

export interface PerfPanel {
  record(frameMs: number, nowMs: number): void;
  inject(frameTimesMs: readonly number[]): void;
  resume(): void;
}

function appendDiv(root: HTMLElement, id: string): HTMLDivElement {
  const element = document.createElement("div");
  element.id = id;
  root.appendChild(element);
  return element;
}

export function createPerfPanel(parent: HTMLElement): PerfPanel {
  const panel = appendDiv(parent, "perf-panel");
  const fpsLine = appendDiv(panel, "perf-fps");
  const p95Line = appendDiv(panel, "perf-p95");
  let window: number[] = [];
  let injected = false;
  let lastRenderMs = Number.NEGATIVE_INFINITY;

  function render(): void {
    const { fps, p95FrameMs, bad } = summarizeFrames(window);
    fpsLine.textContent = t("perf.fps", { fps });
    p95Line.textContent = t("perf.p95", { ms: p95FrameMs.toFixed(1) });
    panel.classList.toggle("perf-bad", bad);
  }
  render();

  return {
    record(frameMs, nowMs) {
      if (!injected) window = [...window, frameMs].slice(-PERF_WINDOW_FRAMES);
      if (nowMs - lastRenderMs >= PERF_PANEL_UPDATE_MS) {
        render();
        lastRenderMs = nowMs;
      }
    },
    inject(frameTimesMs) {
      injected = true;
      window = frameTimesMs.slice(-PERF_WINDOW_FRAMES);
      render();
    },
    resume() {
      injected = false;
      window = [];
      render();
    },
  };
}
