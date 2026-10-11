/** Player settings persisted in `localStorage` (spec 07 §5). */

export const SETTINGS_KEY = "redline.settings.v1";

export interface Settings {
  gore: boolean;
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
    return { gore };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persists the settings; never throws. */
export function saveSettings(settings: Settings, storage?: Storage): void {
  const target = resolveStorage(storage);
  if (target === null) return;
  try {
    target.setItem(SETTINGS_KEY, JSON.stringify({ gore: settings.gore }));
  } catch {
    // A full or locked storage must not break the game.
  }
}
