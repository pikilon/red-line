// Save file rules shared by the saves scripts (spec 19 §6.2); mirrors
// client/src/saves/saveFile.ts and is tested against the same fixtures.

export const SAVE_FILE_FORMAT = "redline-save";
export const SAVE_FILE_VERSION = 1;
export const MAX_NAME_LENGTH = 40;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isInteger = (value) => Number.isInteger(value) && value >= 0;
const isBoolean = (value) => typeof value === "boolean";
const isString = (value) => typeof value === "string";
const isName = (value) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_NAME_LENGTH;
const isPoint = (value) => isObject(value) && isNumber(value.x) && isNumber(value.y);
const matches = (value, shape) => isObject(value) && Object.entries(shape).every(([key, check]) => check(value[key]));

const MATCH_SHAPE = { mapId: isString, seed: isString, debug: isBoolean, speed: isInteger };
const CLIENT_SHAPE = {
  controlled: isInteger,
  revealed: isBoolean,
  gore: isBoolean,
  generatedTextures: isBoolean,
  fpsPanel: isBoolean,
  camera: (value) => isPoint(value) && isNumber(value.zoom),
  cameraMemory: (value) => isObject(value) && Object.values(value).every(isPoint),
  selected: (value) => Array.isArray(value) && value.every(isInteger),
};
const SAVE_SHAPE = {
  name: isName,
  savedAt: isString,
  tick: isInteger,
  match: (value) => matches(value, MATCH_SHAPE),
  client: (value) => matches(value, CLIENT_SHAPE),
};

/** Parses and validates a save file; never throws. Error codes: json, format, version, shape. */
export function parseSaveFile(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "json" };
  }
  if (!isObject(value) || value.format !== SAVE_FILE_FORMAT) return { ok: false, error: "format" };
  if (value.version !== SAVE_FILE_VERSION) return { ok: false, error: "version" };
  const forms = [value.world, value.setup].filter(isObject).length;
  const absent = [value.world, value.setup].filter((v) => v === undefined).length;
  if (!matches(value, SAVE_SHAPE) || forms !== 1 || absent !== 1) return { ok: false, error: "shape" };
  return { ok: true, save: value };
}
