// Pure mathematical curves for Zero Hour positional audio, zoom bonus, and random shifts
// (specs/25-audio.md §2, §6, §9; MilesAudioManager.cpp:2710, GameAudio.cpp:366, AudioEventRTS.cpp:380).

const MAX_PAN = 0.85;
const DEFAULT_LOWPASS_MAX_HZ = 18000;
const DEFAULT_LOWPASS_MIN_HZ = 900;

/**
 * Zero Hour inverse distance attenuation (`MilesAudioManager::getEffectiveVolume`,
 * `MilesAudioManager.cpp:2710`):
 * - `dist <= minDistance`: 1.0
 * - `minDistance < dist < maxDistance`: `minDistance / dist`
 * - `dist >= maxDistance`: 0.0
 */
export function distanceAttenuation(
  dist: number,
  minDistance: number,
  maxDistance: number,
): number {
  if (maxDistance <= 0 || dist >= maxDistance) return 0;
  const min = Math.max(0.001, minDistance);
  if (dist <= min) return 1;
  return min / dist;
}

/**
 * Low-pass cutoff frequency in Hz as a function of distance and the event's `lowPass` factor (0..100).
 * Closer than `minDistance` stays fully open (`18000 Hz`); toward `maxDistance` closes down.
 */
export function distanceLowPassHz(
  dist: number,
  minDistance: number,
  maxDistance: number,
  lowPassPercent = 0,
): number {
  if (lowPassPercent <= 0 || maxDistance <= minDistance || dist <= minDistance)
    return DEFAULT_LOWPASS_MAX_HZ;
  const t = Math.min(
    1,
    Math.max(0, (dist - minDistance) / (maxDistance - minDistance)),
  );
  const strength = Math.max(0.25, Math.min(1, lowPassPercent / 100));
  const minHz =
    DEFAULT_LOWPASS_MAX_HZ -
    (DEFAULT_LOWPASS_MAX_HZ - DEFAULT_LOWPASS_MIN_HZ) * strength;
  return DEFAULT_LOWPASS_MAX_HZ + (minHz - DEFAULT_LOWPASS_MAX_HZ) * t;
}

/**
 * Screen-space stereo pan from normalized screen X (`-1` left edge .. `+1` right edge),
 * clamped to `[-0.85, +0.85]` so off-screen sounds remain audible in both ears (spec 25 §9).
 */
export function screenStereoPan(screenX: number): number {
  if (!Number.isFinite(screenX)) return 0;
  return Math.max(-MAX_PAN, Math.min(MAX_PAN, screenX * MAX_PAN));
}

/**
 * Zero Hour camera zoom volume multiplier (`AudioManager::updateMicrophonePosition`,
 * `GameAudio.cpp:366`):
 * When zoomed out (`zoom <= minZoom`), world sounds play at `1.0 - bonus` (80% for a 20% bonus).
 * When zoomed in (`zoom >= maxZoom`), world sounds receive the full +20% boost (`1.0`).
 * Interpolates linearly in between.
 */
export function zoomVolumeMultiplier(
  zoom: number,
  minZoom: number,
  maxZoom: number,
  bonus = 0.2,
): number {
  const clampedBonus = Math.max(0, Math.min(0.5, bonus));
  if (maxZoom <= minZoom) return 1;
  const t = Math.min(1, Math.max(0, (zoom - minZoom) / (maxZoom - minZoom)));
  return 1 - clampedBonus + clampedBonus * t;
}

/**
 * Zero Hour 2D relative volume (`OptionsMenu.cpp:1224`, `AudioSettings.ini` `Relative2DVolume = -10%`).
 * Negative values reduce 2D volume relative to 3D (`1 + relative2dVolume`).
 */
export function relative2dMultiplier(relative2dVolume: number): number {
  const clamped = Math.max(-1, Math.min(1, relative2dVolume));
  return clamped < 0 ? 1 + clamped : 1;
}

/**
 * Samples a playback rate multiplier from `pitchShift: [minPercent, maxPercent]`
 * (`INIAudioEventInfo.cpp:176`, `AudioEventRTS.cpp:380`).
 */
export function samplePitchRate(
  pitchShift: readonly [number, number] | undefined,
  rng: () => number = Math.random,
): number {
  if (!pitchShift) return 1;
  const [minPct, maxPct] = pitchShift;
  if (minPct === 0 && maxPct === 0) return 1;
  const pct = minPct + (maxPct - minPct) * rng();
  return Math.max(0.25, 1 + pct / 100);
}

/**
 * Samples a volume shift multiplier from `volumeShift` (percent, e.g. `-10` -> uniform in `[0.9, 1.0]`)
 * (`AudioEventRTS.cpp:388`).
 */
export function sampleVolumeShift(
  volumeShiftPercent = 0,
  rng: () => number = Math.random,
): number {
  if (volumeShiftPercent === 0) return 1;
  const delta = volumeShiftPercent / 100;
  const low = Math.min(1, 1 + delta);
  const high = Math.max(1, 1 + delta);
  return Math.max(0, low + (high - low) * rng());
}

/**
 * Samples a start delay in milliseconds from `delayMs: [minMs, maxMs]` (`AudioEventRTS.cpp:340`).
 */
export function sampleDelayMs(
  delayRange: readonly [number, number] | undefined,
  rng: () => number = Math.random,
): number {
  if (!delayRange) return 0;
  const [minMs, maxMs] = delayRange;
  if (maxMs <= 0) return 0;
  return Math.max(0, Math.round(minMs + (maxMs - minMs) * rng()));
}

/**
 * Picks a sound variant index:
 * - When `random` is set, picks uniformly at random, avoiding `lastIndex` when `count > 1`
 *   (`AudioEventRTS.cpp:477` non-repeating variant selection).
 * - Otherwise cycles sequentially `(lastIndex + 1) % count`.
 */
export function pickVariantIndex(
  count: number,
  isRandom: boolean,
  lastIndex: number | undefined,
  rng: () => number = Math.random,
): number {
  if (count <= 1) return 0;
  if (!isRandom) {
    return lastIndex === undefined ? 0 : (lastIndex + 1) % count;
  }
  const raw = Math.min(count - 1, Math.floor(rng() * count));
  if (lastIndex !== undefined && raw === lastIndex) {
    return (raw + 1 + Math.floor(rng() * (count - 1))) % count;
  }
  return raw;
}

/** Converts decibels (e.g. `-9`) to a linear gain multiplier (`10^(dB/20)`). */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
