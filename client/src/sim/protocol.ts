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

export type SimCommand =
  | {
      kind: "move";
      player: number;
      units: number[];
      xRaw: number;
      yRaw: number;
    }
  | { kind: "attack"; player: number; units: number[]; target: number }
  | { kind: "harvest"; player: number; units: number[]; depot: number }
  | {
      kind: "construct";
      player: number;
      dozer: number;
      typeIndex: number;
      originX: number;
      originY: number;
    }
  | { kind: "resume"; player: number; units: number[]; building: number }
  | { kind: "produce"; player: number; building: number; typeIndex: number }
  | { kind: "cancel"; player: number; building: number }
  | {
      kind: "rally";
      player: number;
      building: number;
      xRaw: number;
      yRaw: number;
    }
  | { kind: "stop"; player: number; units: number[] }
  | {
      kind: "debugSpawn";
      player: number;
      typeIndex: number;
      xRaw: number;
      yRaw: number;
    }
  | { kind: "debugSetHp"; entity: number; hp: number };

export type InitSkirmishMessage = {
  type: "initSkirmish";
  seed: number;
  mapId: string;
  viewer: number;
  speed: number;
  debug: boolean;
};
export type CommandMessage = { type: "command"; command: SimCommand };
export type SetViewerMessage = { type: "setViewer"; viewer: number };
export type MainToWorker =
  | InitMessage
  | MoveMessage
  | HashRequestMessage
  | InitSkirmishMessage
  | CommandMessage
  | SetViewerMessage;

export type ReadyMessage = {
  type: "ready";
  apiVersion: number;
  mapWidth: number;
  mapHeight: number;
  tiles: Uint8Array;
};
export type SnapshotMessage = {
  type: "snapshot";
  data: Int32Array;
  fog?: Uint8Array;
};
export type HashMessage = { type: "hash"; requestId: number; hash: string };
export type ErrorMessage = { type: "error"; detail: string };
export type WorkerToMain =
  | ReadyMessage
  | SnapshotMessage
  | HashMessage
  | ErrorMessage;
