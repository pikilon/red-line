import type { MainToWorker, ReadyMessage, WorkerToMain } from "./protocol";
import type { Snapshot } from "./snapshot";

export interface WorkerLike {
  postMessage(message: MainToWorker): void;
  onmessage: ((event: MessageEvent<WorkerToMain>) => void) | null;
}
export interface SimClient {
  readonly ready: Promise<ReadyMessage>;
  move(
    unitIds: readonly number[],
    targetXRaw: number,
    targetYRaw: number,
  ): void;
  requestHash(): Promise<string>;
  /** Returns an unsubscribe function. */
  onSnapshot(
    listener: (snapshot: Snapshot, receivedAtMs: number) => void,
  ): () => void;
}

export function createSimClient(
  _worker: WorkerLike,
  _options: { seed: number; unitCount: number },
  _now: () => number = () => performance.now(),
): SimClient {
  return {
    ready: Promise.reject(new Error("not implemented")),
    move: () => {},
    requestHash: () => Promise.reject(new Error("not implemented")),
    onSnapshot: () => () => {},
  };
}
