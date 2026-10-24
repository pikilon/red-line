import type { EffectKind } from "./render/effects";
import type { ProjectileModel } from "./render/projectiles";
import type { EntityState, Outcome } from "./sim/matchSnapshot";
import type { SimCommand } from "./sim/protocol";

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

/** `window.__redline` of the skirmish app (`?mode=skirmish&debug=1`, spec §6.7). */
export interface SkirmishDebug {
  isReady(): boolean;
  mode(): "skirmish";
  /** True once the model registry has been loaded and applied. */
  modelsReady(): boolean;
  /** Tick of the latest snapshot. */
  tick(): number;
  /** True while the skirmish is paused (spec 08 §3). */
  paused(): boolean;
  /** True while the Esc game menu is open (spec 08 §3.1). */
  menuOpen(): boolean;
  /** Whether the skirmish AI plays; null when none is attached (spec 08 §3.3). */
  aiActive(): boolean | null;
  controlledPlayer(): number;
  /** Controlled player, or `OBSERVER` (255) while revealed. */
  viewer(): number;
  /** Latest snapshot, not interpolated. */
  entities(): EntityState[];
  entity(id: number): EntityState | null;
  /** Type index of a type id, -1 if absent. */
  typeIndex(id: string): number;
  /** Fog cell of the latest fog: 0 unexplored, 1 explored, 2 visible. */
  fogAt(x: number, y: number): number;
  credits(): number;
  power(): { produced: number; consumed: number };
  outcome(): { outcome: Outcome; winner: number | null };
  /** Ascending. */
  selectedIds(): number[];
  /** Sim tiles -> page CSS px. */
  worldToScreen(x: number, y: number): { x: number; y: number };
  cameraTarget(): { x: number; y: number };
  /** Wheel zoom of the camera, 1 by default (spec 08 §3.4). */
  zoom(): number;
  /** The `?load` id once applied, or null (spec 19 §5.6). */
  loadedSave(): string | null;
  /** `Sim::save_state` JSON of the running match (spec 19 §5.6). */
  saveState(): Promise<string>;
  /** Tick and entity positions of the first snapshot (spec 19 §5.6). */
  initialSnapshot(): {
    tick: number;
    entities: { id: number; x: number; y: number }[];
  } | null;
  /** Pauses or resumes only the worker clock, without the game menu, so a
   *  test can hold production still between UI steps (#299). Commands sent
   *  while paused apply on the first step after resuming. */
  setSimPaused(paused: boolean): void;
  /** Target in tiles. */
  setCameraTarget(x: number, y: number): void;
  command(command: SimCommand): void;
  stateHash(): Promise<string>;
  /** Visible effect mesh counts of the last frame (spec 07 AC-07-06). */
  effectCounts(): Record<EffectKind, number>;
  /** Ground marks alive: tracks plus scorches (spec 22). */
  decalCount(): number;
  /** Drawn projectiles per model of the last frame (spec 17 §7.7). */
  projectileCounts(): Record<ProjectileModel, number>;
  /** One entry per drawn projectile of the last frame (spec 17 §7.7). */
  projectileSamples(): { model: ProjectileModel; z: number; t: number }[];
  /** Gore filter setting (spec 07 §5). */
  gore(): boolean;
  /** Command panel render calls so far (spec §6.7, #140). */
  uiRenders(): number;
  /** renderer.info.render.calls of the last frame. */
  drawCalls(): number;
  /** Shadows, sun and tone mapping of the skirmish renderer (spec 10 AC-10-03). */
  renderInfo(): {
    shadowMap: boolean;
    sunCastsShadow: boolean;
    toneMapping: string;
  };
  resetFrameStats(): void;
  /** rAF deltas since the last reset. */
  frameStats(): { frames: number; p95FrameMs: number };
  /** Replaces the perf panel window and ignores real rAF deltas until resumeFrameTimes(). */
  injectFrameTimes(frameTimesMs: number[]): void;
  /** Clears the perf panel window and resumes recording real rAF deltas. */
  resumeFrameTimes(): void;
}

export function installSkirmishDebugApi(
  target: { __redline?: SkirmishDebug },
  api: SkirmishDebug,
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
