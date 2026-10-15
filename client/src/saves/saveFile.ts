/** Save files (spec 19 §5.1). */

export const SAVE_FILE_FORMAT = "redline-save";
export const SAVE_FILE_VERSION = 1;
/** Player slots `slot-1` .. `slot-10`. */
export const SLOT_COUNT = 10;
export type SlotId = `slot-${number}`;

export interface MatchOptions {
  mapId: string;
  seed: string;
  debug: boolean;
  speed: number;
}

export interface ClientState {
  controlled: number;
  revealed: boolean;
  gore: boolean;
  generatedTextures: boolean;
  fpsPanel: boolean;
  camera: { x: number; y: number; zoom: number };
  cameraMemory: Record<string, { x: number; y: number }>;
  selected: number[];
}

export interface SaveFile {
  format: typeof SAVE_FILE_FORMAT;
  version: typeof SAVE_FILE_VERSION;
  name: string;
  savedAt: string;
  tick: number;
  match: MatchOptions;
  client: ClientState;
  world?: unknown;
  setup?: unknown;
}

export function buildSaveFile(_args: {
  name: string;
  savedAt: Date;
  tick: number;
  match: MatchOptions;
  client: ClientState;
  worldJson: string;
}): SaveFile {
  throw new Error("not implemented");
}

export function parseSaveFile(
  _text: string,
): { ok: true; save: SaveFile } | { ok: false; error: string } {
  return { ok: false, error: "not implemented" };
}

export function gameTime(_tick: number): string {
  return "";
}

export function defaultSaveName(_mapName: string, _tick: number): string {
  return "";
}
