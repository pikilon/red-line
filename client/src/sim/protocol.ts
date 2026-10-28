export const EXPECTED_API_VERSION = 4;
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
  | {
      kind: "attackGround";
      player: number;
      units: number[];
      xRaw: number;
      yRaw: number;
    }
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
  /** Spec 31 block 2: infantry walk to feature `feature` (map row index) and garrison it. */
  | { kind: "garrison"; player: number; units: number[]; feature: number }
  /** Spec 31 block 2: evacuate the garrisoned feature `feature`. */
  | { kind: "unload"; player: number; feature: number }
  /** Spec 34: infantry walk to the own vehicle `carrier` and board it. */
  | { kind: "board"; player: number; units: number[]; carrier: number }
  /** Spec 34: the riders of vehicle `carrier` leave it, one at a time. */
  | { kind: "disembark"; player: number; carrier: number }
  /** Spec 35: infantry and dozers walk to feature `feature` and repair it. */
  | { kind: "repair"; player: number; units: number[]; feature: number }
  /** Spec 35: workers dig a trench with its top-left cell at (x, y). */
  | {
      kind: "dig";
      player: number;
      units: number[];
      x: number;
      y: number;
      rot: number;
    }
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
  /** Personality attached to player 1, `null` for none (§7). */
  ai?: string | null;
};
/** Builds the skirmish from a save (spec 19 §5.4); AIs come from the state. */
export type InitFromSaveMessage = {
  type: "initFromSave";
  /** JSON of the save's `world` or `setup` member. */
  form: "world" | "setup";
  json: string;
  viewer: number;
  speed: number;
};
/** Asks for `Sim::save_state` (spec 19 §5.4). */
export type SaveRequestMessage = { type: "saveRequest"; requestId: number };
export type CommandMessage = { type: "command"; command: SimCommand };
export type SetViewerMessage = { type: "setViewer"; viewer: number };
export type SetPausedMessage = { type: "setPaused"; paused: boolean };
/** Pauses or resumes the skirmish AI (spec 08 §3.3). */
export type SetAiActiveMessage = { type: "setAiActive"; active: boolean };
export type MainToWorker =
  | InitMessage
  | MoveMessage
  | HashRequestMessage
  | InitSkirmishMessage
  | InitFromSaveMessage
  | SaveRequestMessage
  | CommandMessage
  | SetViewerMessage
  | SetPausedMessage
  | SetAiActiveMessage;

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
  /** Combat snapshot when the sim exposes `combat_for` (spec 17 §5). */
  combat?: Int32Array;
  /** Feature table when it changed since the last snapshot (spec 31). */
  features?: Int32Array;
};
export type HashMessage = { type: "hash"; requestId: number; hash: string };
export type ErrorMessage = { type: "error"; detail: string };
/** `Sim::save_state` JSON, or null with `error` when it failed (spec 19 §5.4). */
export type SaveStateMessage = {
  type: "saveState";
  requestId: number;
  world: string | null;
  error?: string;
};
export type WorkerToMain =
  | ReadyMessage
  | SnapshotMessage
  | HashMessage
  | ErrorMessage
  | SaveStateMessage;
