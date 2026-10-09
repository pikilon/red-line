import type { MainToWorker, WorkerToMain } from "./protocol";

export interface SimLike {
  map_width(): number;
  map_height(): number;
  map_tiles(): Uint8Array;
  tick(): number;
  command_move(
    unitIds: Uint32Array,
    targetXRaw: number,
    targetYRaw: number,
  ): void;
  step(): void;
  snapshot(): Int32Array;
  state_hash_hex(): string;
}
export type SimFactory = (seed: number, unitCount: number) => SimLike;
export type Post = (message: WorkerToMain, transfer?: Transferable[]) => void;
export interface WorkerHandler {
  handle(message: MainToWorker): void;
  advance(nowMs: number): void;
}

export function createWorkerHandler(
  _factory: SimFactory,
  _apiVersion: number,
  _post: Post,
): WorkerHandler {
  return { handle: () => {}, advance: () => {} };
}
