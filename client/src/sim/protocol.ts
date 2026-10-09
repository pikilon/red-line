export const EXPECTED_API_VERSION = 2;
export const TICK_RATE_HZ = 15;
export const TICK_MS = 1000 / TICK_RATE_HZ;
export const MAX_STEPS_PER_ADVANCE = 4;
export const SNAPSHOT_HEADER_LEN = 2;
export const UNIT_STRIDE = 4;
export const FLAG_MOVING = 1;

export type InitMessage = { type: "init"; seed: number; unitCount: number };
export type MoveMessage = {
  type: "move";
  unitIds: number[];
  targetXRaw: number;
  targetYRaw: number;
};
export type HashRequestMessage = { type: "hashRequest"; requestId: number };
export type MainToWorker = InitMessage | MoveMessage | HashRequestMessage;

export type ReadyMessage = {
  type: "ready";
  apiVersion: number;
  mapWidth: number;
  mapHeight: number;
  tiles: Uint8Array;
};
export type SnapshotMessage = { type: "snapshot"; data: Int32Array };
export type HashMessage = { type: "hash"; requestId: number; hash: string };
export type ErrorMessage = { type: "error"; detail: string };
export type WorkerToMain =
  | ReadyMessage
  | SnapshotMessage
  | HashMessage
  | ErrorMessage;
