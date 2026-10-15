import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSaveFile,
  defaultSaveName,
  gameTime,
  parseSaveFile,
  type SaveFile,
} from "./saveFile";

interface Case {
  name: string;
  text?: string;
  base?: string;
  set?: Record<string, unknown>;
  delete?: string[];
  error: string;
}

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const cases = JSON.parse(fixture("cases.json")) as {
  valid: string[];
  invalid: Case[];
};

/** The text of an invalid case: its own text, or its base fixture edited. */
function caseText(entry: Case): string {
  if (entry.text !== undefined) return entry.text;
  const value = JSON.parse(fixture(entry.base ?? "")) as Record<
    string,
    unknown
  >;
  Object.assign(value, entry.set ?? {});
  for (const path of entry.delete ?? []) {
    const keys = path.split(".");
    const last = keys.pop() ?? "";
    let target = value;
    for (const key of keys) target = target[key] as Record<string, unknown>;
    delete target[last];
  }
  return JSON.stringify(value);
}

describe("save file", () => {
  it("AC-19-10: save file", () => {
    for (const name of cases.valid) {
      const result = parseSaveFile(fixture(name));
      expect(result, name).toEqual({
        ok: true,
        save: JSON.parse(fixture(name)),
      });
    }
    for (const entry of cases.invalid) {
      expect(parseSaveFile(caseText(entry)), entry.name).toEqual({
        ok: false,
        error: entry.error,
      });
    }

    const world = JSON.parse(fixture("world.json")) as SaveFile;
    const built = buildSaveFile({
      name: "  Before the river ",
      savedAt: new Date(Date.UTC(2026, 9, 15, 10)),
      tick: world.tick,
      match: world.match,
      client: world.client,
      worldJson: JSON.stringify(world.world),
    });
    expect(built).toEqual(world);
    expect(parseSaveFile(JSON.stringify(built))).toEqual({
      ok: true,
      save: built,
    });

    expect(gameTime(0)).toBe("0:00");
    expect(gameTime(15 * 75)).toBe("1:15");
    expect(gameTime(15 * 3661)).toBe("1:01:01");
    expect(defaultSaveName("First Line", 15 * 75)).toBe("First Line 1:15");
  });
});
