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

/** Longest save name after trimming (spec 19 §5.1). */
export const MAX_NAME_LENGTH = 40;
/** Simulation tick rate, for game time. */
const TICKS_PER_SECOND = 15;

/** Client defaults when an example omits `client` fields (spec 19 §5.1). */
export const DEFAULT_CLIENT_STATE: Omit<ClientState, "camera" | "fpsPanel"> = {
  controlled: 0,
  revealed: false,
  gore: true,
  generatedTextures: true,
  cameraMemory: {},
  selected: [],
};

/** A world-form save of the current match. */
export function buildSaveFile(args: {
  name: string;
  savedAt: Date;
  tick: number;
  match: MatchOptions;
  client: ClientState;
  worldJson: string;
}): SaveFile {
  return {
    format: SAVE_FILE_FORMAT,
    version: SAVE_FILE_VERSION,
    name: args.name.trim(),
    savedAt: args.savedAt.toISOString(),
    tick: args.tick,
    match: { ...args.match },
    client: structuredClone(args.client),
    world: JSON.parse(args.worldJson) as unknown,
  };
}

type Check = (value: unknown) => boolean;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber: Check = (value) =>
  typeof value === "number" && Number.isFinite(value);
const isInteger: Check = (value) =>
  Number.isInteger(value) && (value as number) >= 0;
const isBoolean: Check = (value) => typeof value === "boolean";
const isString: Check = (value) => typeof value === "string";
const isName: Check = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.trim().length <= MAX_NAME_LENGTH;
const isPoint: Check = (value) =>
  isObject(value) && isNumber(value.x) && isNumber(value.y);

/** Every key of `shape` present in `value` and passing its check. */
const matches = (value: unknown, shape: Record<string, Check>): boolean =>
  isObject(value) &&
  Object.entries(shape).every(([key, check]) => check(value[key]));

const MATCH_SHAPE: Record<string, Check> = {
  mapId: isString,
  seed: isString,
  debug: isBoolean,
  speed: isInteger,
};

const CLIENT_SHAPE: Record<string, Check> = {
  controlled: isInteger,
  revealed: isBoolean,
  gore: isBoolean,
  generatedTextures: isBoolean,
  fpsPanel: isBoolean,
  camera: (value) =>
    isPoint(value) && isNumber((value as { zoom: unknown }).zoom),
  cameraMemory: (value) =>
    isObject(value) && Object.values(value).every(isPoint),
  selected: (value) => Array.isArray(value) && value.every(isInteger),
};

const SAVE_SHAPE: Record<string, Check> = {
  name: isName,
  savedAt: isString,
  tick: isInteger,
  match: (value) => matches(value, MATCH_SHAPE),
  client: (value) => matches(value, CLIENT_SHAPE),
};

/** Parses and validates a save file; never throws (spec 19 §5.1). */
export function parseSaveFile(
  text: string,
): { ok: true; save: SaveFile } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "json" };
  }
  if (!isObject(value) || value.format !== SAVE_FILE_FORMAT) {
    return { ok: false, error: "format" };
  }
  if (value.version !== SAVE_FILE_VERSION)
    return { ok: false, error: "version" };
  const forms = [value.world, value.setup].filter(isObject).length;
  const absent = [value.world, value.setup].filter(
    (v) => v === undefined,
  ).length;
  if (!matches(value, SAVE_SHAPE) || forms !== 1 || absent !== 1) {
    return { ok: false, error: "shape" };
  }
  return { ok: true, save: value as unknown as SaveFile };
}

/** Game time of `tick` at 15 Hz: "m:ss", or "h:mm:ss" from one hour. */
export function gameTime(tick: number): string {
  const total = Math.floor(tick / TICKS_PER_SECOND);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Default name of a new save: "<map name> <game time>". */
export function defaultSaveName(mapName: string, tick: number): string {
  return `${mapName} ${gameTime(tick)}`;
}
