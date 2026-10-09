import {
  type ErrorMessage,
  EXPECTED_API_VERSION,
  type HashMessage,
  type MainToWorker,
  type ReadyMessage,
  type SnapshotMessage,
  type WorkerToMain,
} from "./protocol";
import { decodeSnapshot, type Snapshot } from "./snapshot";

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

type SnapshotListener = (snapshot: Snapshot, receivedAtMs: number) => void;

export function createSimClient(
  worker: WorkerLike,
  options: { seed: number; unitCount: number },
  now: () => number = () => performance.now(),
): SimClient {
  let resolveReady: (message: ReadyMessage) => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<ReadyMessage>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const pendingHashes = new Map<number, (hash: string) => void>();
  const listeners = new Set<SnapshotListener>();
  let nextRequestId = 1;

  const handlers = {
    ready: (message: ReadyMessage): void => {
      if (message.apiVersion === EXPECTED_API_VERSION) {
        resolveReady(message);
        return;
      }
      rejectReady(
        new Error(
          `api version mismatch: expected ${EXPECTED_API_VERSION}, got ${message.apiVersion}`,
        ),
      );
    },
    error: (message: ErrorMessage): void => {
      rejectReady(new Error(message.detail));
    },
    hash: (message: HashMessage): void => {
      const resolve = pendingHashes.get(message.requestId);
      pendingHashes.delete(message.requestId);
      resolve?.(message.hash);
    },
    snapshot: (message: SnapshotMessage): void => {
      const snapshot = decodeSnapshot(message.data);
      const receivedAtMs = now();
      for (const listener of [...listeners]) {
        listener(snapshot, receivedAtMs);
      }
    },
  } as const;

  worker.onmessage = (event) => {
    const message = event.data;
    (handlers[message.type] as (m: WorkerToMain) => void)(message);
  };
  worker.postMessage({
    type: "init",
    seed: options.seed,
    unitCount: options.unitCount,
  });

  return {
    ready,
    move(unitIds, targetXRaw, targetYRaw) {
      worker.postMessage({
        type: "move",
        unitIds: [...unitIds],
        targetXRaw,
        targetYRaw,
      });
    },
    requestHash() {
      const requestId = nextRequestId++;
      return new Promise<string>((resolve) => {
        pendingHashes.set(requestId, resolve);
        worker.postMessage({ type: "hashRequest", requestId });
      });
    },
    onSnapshot(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
