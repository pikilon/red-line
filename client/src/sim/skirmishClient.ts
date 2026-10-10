import { decodeMatchSnapshot, type MatchSnapshot } from "./matchSnapshot";
import {
  type CommandMessage,
  type ErrorMessage,
  EXPECTED_API_VERSION,
  type HashMessage,
  type InitSkirmishMessage,
  type ReadyMessage,
  type SetViewerMessage,
  type SimCommand,
  type SnapshotMessage,
  type WorkerToMain,
} from "./protocol";
import type { WorkerLike } from "./simClient";

export interface SkirmishClient {
  readonly ready: Promise<ReadyMessage>;
  command(command: SimCommand): void;
  setViewer(viewer: number): void;
  requestHash(): Promise<string>;
  /** Returns an unsubscribe function. */
  onSnapshot(
    listener: (
      snapshot: MatchSnapshot,
      fog: Uint8Array,
      receivedAtMs: number,
    ) => void,
  ): () => void;
}

type SnapshotListener = (
  snapshot: MatchSnapshot,
  fog: Uint8Array,
  receivedAtMs: number,
) => void;

export function createSkirmishClient(
  worker: WorkerLike,
  options: {
    seed: number;
    mapId: string;
    viewer: number;
    speed: number;
    debug: boolean;
  },
  now: () => number = () => performance.now(),
): SkirmishClient {
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
      const snapshot = decodeMatchSnapshot(message.data);
      const fog = message.fog ?? new Uint8Array(0);
      const receivedAtMs = now();
      for (const listener of [...listeners]) {
        listener(snapshot, fog, receivedAtMs);
      }
    },
  } as const;

  worker.onmessage = (event) => {
    const message = event.data;
    (handlers[message.type] as (m: WorkerToMain) => void)(message);
  };
  const init: InitSkirmishMessage = {
    type: "initSkirmish",
    seed: options.seed,
    mapId: options.mapId,
    viewer: options.viewer,
    speed: options.speed,
    debug: options.debug,
  };
  worker.postMessage(init);

  return {
    ready,
    command(command: SimCommand) {
      const message: CommandMessage = { type: "command", command };
      worker.postMessage(message);
    },
    setViewer(viewer: number) {
      const message: SetViewerMessage = { type: "setViewer", viewer };
      worker.postMessage(message);
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
