/** Player settings persisted in `localStorage` (spec 07 §5, spec 25 §10). */

export const SETTINGS_KEY = "redline.settings.v1";

/**
 * Master volume 0..100. Starts muted (owner, 2026-10-26): the shipped sounds
 * are procedural placeholders, so the public build must stay silent until
 * generated assets replace them (spec 25 §10). Players opt in with the menu
 * slider; restore 100 when phase 3 lands.
 */
export const DEFAULT_AUDIO_MASTER = 0;
export const DEFAULT_AUDIO_SFX = 80;
export const DEFAULT_AUDIO_AMBIENT = 50;
export const DEFAULT_AUDIO_VOICE = 70;
export const DEFAULT_AUDIO_MUSIC = 55;

export interface Settings {
  gore: boolean;
  /** Absent means true: generated textures are the default (spec 12 §2). */
  generatedTextures?: boolean;
  /** Absent means true: snow shows on snow maps (spec 22 §4). */
  weather?: boolean;
  /** Master volume 0..100 (default 0 = muted, spec 25 §10). */
  audioMaster?: number;
  /** Effects/UI volume 0..100 (default 80, spec 25 §10). */
  audioSfx?: number;
  /** Ambient beds volume 0..100 (default 50, spec 25 §10). */
  audioAmbient?: number;
  /** Voices/EVA volume 0..100 (default 70, spec 25 §10). */
  audioVoice?: number;
  /** Music volume 0..100 (default 55, spec 25 §10). */
  audioMusic?: number;
  /** Absent means true: strong language enabled by default (spec 25 §5.3). */
  strongLanguage?: boolean;
}

export const DEFAULT_SETTINGS: Settings = { gore: true };

/** The mixer's starting volumes: saved slider values, with defaults for the
 *  channels the player never touched (spec 25 §10). */
export function resolveAudioVolumes(settings: Settings): {
  audioMaster: number;
  audioSfx: number;
  audioAmbient: number;
  audioVoice: number;
  audioMusic: number;
} {
  return {
    audioMaster: settings.audioMaster ?? DEFAULT_AUDIO_MASTER,
    audioSfx: settings.audioSfx ?? DEFAULT_AUDIO_SFX,
    audioAmbient: settings.audioAmbient ?? DEFAULT_AUDIO_AMBIENT,
    audioVoice: settings.audioVoice ?? DEFAULT_AUDIO_VOICE,
    audioMusic: settings.audioMusic ?? DEFAULT_AUDIO_MUSIC,
  };
}

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

function parseVolume(val: unknown): number | undefined {
  if (typeof val !== "number" || !Number.isFinite(val)) return undefined;
  return Math.max(0, Math.min(100, Math.round(val)));
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
    const obj = parsed as Record<string, unknown>;
    const gore = obj.gore;
    if (typeof gore !== "boolean") return { ...DEFAULT_SETTINGS };
    const generatedTextures = obj.generatedTextures;
    const weather = obj.weather;
    const audioMaster = parseVolume(obj.audioMaster);
    const audioSfx = parseVolume(obj.audioSfx);
    const audioAmbient = parseVolume(obj.audioAmbient);
    const audioVoice = parseVolume(obj.audioVoice);
    const audioMusic = parseVolume(obj.audioMusic);
    const strongLanguage = obj.strongLanguage;
    return {
      gore,
      ...(generatedTextures === false ? { generatedTextures } : {}),
      ...(weather === false ? { weather } : {}),
      ...(audioMaster !== undefined ? { audioMaster } : {}),
      ...(audioSfx !== undefined ? { audioSfx } : {}),
      ...(audioAmbient !== undefined ? { audioAmbient } : {}),
      ...(audioVoice !== undefined ? { audioVoice } : {}),
      ...(audioMusic !== undefined ? { audioMusic } : {}),
      ...(strongLanguage === false ? { strongLanguage } : {}),
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
        ...(settings.audioMaster !== undefined
          ? { audioMaster: parseVolume(settings.audioMaster) }
          : {}),
        ...(settings.audioSfx !== undefined
          ? { audioSfx: parseVolume(settings.audioSfx) }
          : {}),
        ...(settings.audioAmbient !== undefined
          ? { audioAmbient: parseVolume(settings.audioAmbient) }
          : {}),
        ...(settings.audioVoice !== undefined
          ? { audioVoice: parseVolume(settings.audioVoice) }
          : {}),
        ...(settings.audioMusic !== undefined
          ? { audioMusic: parseVolume(settings.audioMusic) }
          : {}),
        ...(settings.strongLanguage === false ? { strongLanguage: false } : {}),
      }),
    );
  } catch {
    // A full or locked storage must not break the game.
  }
}
