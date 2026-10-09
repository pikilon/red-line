export interface RedlineDebug {
  isReady(): boolean;
  /** Tick of the latest snapshot. */
  tick(): number;
  unitCount(): number;
  /** Latest snapshot, in tiles. */
  unitPosition(id: number): { x: number; y: number } | null;
  isMoving(id: number): boolean;
  /** Ascending. */
  selectedIds(): number[];
  /** Sim tiles -> page CSS px. */
  worldToScreen(x: number, y: number): { x: number; y: number };
  cameraTarget(): { x: number; y: number };
  /** Target in tiles; sent through SimClient.move. */
  commandMove(ids: number[], x: number, y: number): void;
  stateHash(): Promise<string>;
  /** renderer.info.render.calls of the last frame. */
  drawCalls(): number;
  resetFrameStats(): void;
  /** rAF deltas since the last reset. */
  frameStats(): { frames: number; p95FrameMs: number };
  /** Replaces the perf panel window and ignores real rAF deltas until resumeFrameTimes(). */
  injectFrameTimes(frameTimesMs: number[]): void;
  /** Clears the perf panel window and resumes recording real rAF deltas. */
  resumeFrameTimes(): void;
}

export function installDebugApi(
  target: { __redline?: RedlineDebug },
  api: RedlineDebug,
): void {
  target.__redline = api;
}

export interface FrameStats {
  record(frameMs: number): void;
  reset(): void;
  read(): { frames: number; p95FrameMs: number };
}

export function createFrameStats(): FrameStats {
  let deltas: number[] = [];
  return {
    record(frameMs) {
      deltas.push(frameMs);
    },
    reset() {
      deltas = [];
    },
    read() {
      const sorted = [...deltas].sort((a, b) => a - b);
      const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
      return { frames: sorted.length, p95FrameMs: sorted[index] ?? 0 };
    },
  };
}
