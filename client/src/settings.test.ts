import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  SETTINGS_KEY,
  saveSettings,
} from "./settings";

/** In-memory `Storage` seeded with `initial`. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    key(index: number) {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  };
}

/** A storage whose every access throws, as a locked-down browser storage would. */
const throwingStorage = {
  get length(): number {
    throw new Error("denied");
  },
  clear() {
    throw new Error("denied");
  },
  getItem() {
    throw new Error("denied");
  },
  key() {
    throw new Error("denied");
  },
  removeItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("denied");
  },
} as unknown as Storage;

describe("settings", () => {
  it("AC-07-05: settings", () => {
    // Default on missing, invalid JSON and non-boolean gore.
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(
      loadSettings(memoryStorage({ [SETTINGS_KEY]: "{not json" })),
    ).toEqual(DEFAULT_SETTINGS);
    expect(
      loadSettings(
        memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ gore: "yes" }) }),
      ),
    ).toEqual(DEFAULT_SETTINGS);
    // Default on a throwing storage, and never throwing.
    expect(loadSettings(throwingStorage)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings({ gore: false }, throwingStorage)).not.toThrow();

    // Round-trip.
    const storage = memoryStorage();
    saveSettings({ gore: false }, storage);
    expect(loadSettings(storage)).toEqual({ gore: false });
    saveSettings({ gore: true }, storage);
    expect(loadSettings(storage)).toEqual({ gore: true });
  });
});
