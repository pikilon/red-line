/** Player settings persisted in `localStorage` (spec 07 §5). */

export const SETTINGS_KEY = "redline.settings.v1";

export interface Settings {
  gore: boolean;
  /** Absent means true: generated textures are the default (spec 12 §2). */
  generatedTextures?: boolean;
  /** Absent means true: snow shows on snow maps (spec 22 §4). */
  weather?: boolean;
}

export const DEFAULT_SETTINGS: Settings = { gore: true };

/** The requested storage, the browser's `localStorage`, or null when neither is
 *  reachable (private mode may throw on the property access itself). */
function resolveStorage(storage?: Storage): Storage | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored settings, or the defaults when the storage is missing, the value
 *  is absent or invalid, or reading throws. */
export function loadSettings(storage?: Storage): Settings {
  const target = resolveStorage(storage);
  if (target === null) return { ...DEFAULT_SETTINGS };
  try {
    const raw = target.getItem(SETTINGS_KEY);
    if (raw === null) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_SETTINGS };
    }
    const gore = (parsed as { gore?: unknown }).gore;
    if (typeof gore !== "boolean") return { ...DEFAULT_SETTINGS };
    const generatedTextures = (parsed as { generatedTextures?: unknown })
      .generatedTextures;
    const weather = (parsed as { weather?: unknown }).weather;
    return {
      gore,
      ...(generatedTextures === false ? { generatedTextures } : {}),
      ...(weather === false ? { weather } : {}),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persists the settings; never throws. */
export function saveSettings(settings: Settings, storage?: Storage): void {
  const target = resolveStorage(storage);
  if (target === null) return;
  try {
    target.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        gore: settings.gore,
        ...(settings.generatedTextures === false
          ? { generatedTextures: false }
          : {}),
        ...(settings.weather === false ? { weather: false } : {}),
      }),
    );
  } catch {
    // A full or locked storage must not break the game.
  }
}
