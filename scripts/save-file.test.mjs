// AC-19-10: the script mirror of client/src/saves/saveFile.ts parses the same
// fixtures the same way (spec 19 §6.2).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseSaveFile } from "./save-file.mjs";

const fixture = (name) => readFileSync(new URL(`../client/src/saves/fixtures/${name}`, import.meta.url), "utf8");
const cases = JSON.parse(fixture("cases.json"));

const caseText = (entry) => {
  if (entry.text !== undefined) return entry.text;
  const value = JSON.parse(fixture(entry.base));
  Object.assign(value, entry.set ?? {});
  for (const path of entry.delete ?? []) {
    const keys = path.split(".");
    const last = keys.pop();
    let target = value;
    for (const key of keys) target = target[key];
    delete target[last];
  }
  return JSON.stringify(value);
};

test("AC-19-10: save file", () => {
  for (const name of cases.valid) {
    assert.deepEqual(parseSaveFile(fixture(name)), { ok: true, save: JSON.parse(fixture(name)) }, name);
  }
  for (const entry of cases.invalid) {
    assert.deepEqual(parseSaveFile(caseText(entry)), { ok: false, error: entry.error }, entry.name);
  }
});
