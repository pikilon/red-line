// Save file rules shared by the saves scripts (spec 19 §6.2); mirrors
// client/src/saves/saveFile.ts and is tested against the same fixtures.

/** @returns {{ ok: true, save: object } | { ok: false, error: string }} */
export function parseSaveFile(_text) {
  return { ok: false, error: "not implemented" };
}
