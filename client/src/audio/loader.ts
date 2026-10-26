// Audio buffer loader & Zero Hour reference pack resolver (specs/25-audio.md §4.2, §7, §12).
// Resolution chain:
// 1. Shipped game audio in `/audio/...` (Phase 3)
// 2. Local Zero Hour reference pack at `/audio-ref/...` (dev server only, when present)
// 3. Procedural fallback recipe (`synth:<recipe>`) rendered into an `AudioBuffer`.

import {
  createRecipeAudioBuffer,
  encodeWavPcm16,
  synthesizePcm,
} from "./synth";
import type { AudioCatalog, SynthRecipeDef } from "./types";

const MAX_CACHE_BYTES = 64 * 1024 * 1024; // 64 MB LRU decoded budget (spec 25 §12)

export interface ZhRefEventInfo {
  sounds?: string[];
  filename?: string;
  volume?: number;
  volumeShift?: number;
  minVolume?: number;
  pitchShift?: [number, number];
  delay?: [number, number];
  limit?: number;
  priority?: string;
  type?: string[];
  control?: string[];
  minRange?: number;
  maxRange?: number;
  lowPassFreq?: number;
}

export interface ZhRefEvaInfo {
  priority?: number;
  timeBetweenChecksMS?: number;
  expirationTimeMS?: number;
  sideSounds?: Record<string, string>;
}

export interface ZhRefIndex {
  events?: Record<string, ZhRefEventInfo>;
  dialogs?: Record<string, ZhRefEventInfo>;
  music?: Record<string, ZhRefEventInfo>;
  eva?: Record<string, ZhRefEvaInfo>;
  files?: Record<string, string>;
}

interface CacheEntry {
  buffer: AudioBuffer;
  bytes: number;
}

const DEFAULT_RECIPE: SynthRecipeDef = {
  kind: "tone",
  durationMs: 120,
  freqStartHz: 440,
  freqEndHz: 330,
  filterType: "lowpass",
  filterHz: 1200,
  noiseMix: 0.2,
  attackMs: 5,
  decayMs: 110,
  gain: 0.5,
};

const CHUNK_RIFF = 0x46464952; // "RIFF" little-endian
const CHUNK_WAVE = 0x45564157; // "WAVE"
const CHUNK_FMT = 0x20746d66; // "fmt "
const CHUNK_FACT = 0x74636166; // "fact"
const CHUNK_DATA = 0x61746164; // "data"

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IMA_ADPCM = 0x0011;

const IMA_INDEX_TABLE = [
  -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
] as const;

const IMA_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
] as const;

export interface DecodedWav {
  channels: Float32Array[];
  sampleRate: number;
  frames: number;
}

interface WavFormat {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  blockAlign: number;
  bitsPerSample: number;
  samplesPerBlock: number;
}

interface WavLayout {
  format: WavFormat;
  dataOffset: number;
  dataSize: number;
  factFrames: number;
}

/** Parses a RIFF/WAVE header; returns `null` for anything that is not a well-formed WAV. */
function parseWavLayout(buffer: ArrayBuffer): WavLayout | null {
  if (buffer.byteLength < 12) return null;
  const view = new DataView(buffer);
  if (
    view.getUint32(0, true) !== CHUNK_RIFF ||
    view.getUint32(8, true) !== CHUNK_WAVE
  ) {
    return null;
  }

  let format: WavFormat | null = null;
  let factFrames = 0;
  let dataOffset = -1;
  let dataSize = 0;
  let offset = 12;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = view.getUint32(offset, true);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;
    const available = buffer.byteLength - body;

    if (chunkId === CHUNK_FMT) {
      if (chunkSize < 16 || available < 16) return null;
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      if (channels < 1 || sampleRate < 1) return null;
      const samplesPerBlock =
        chunkSize >= 20 && available >= 20
          ? view.getUint16(body + 18, true)
          : 0;
      format = {
        audioFormat: view.getUint16(body, true),
        channels,
        sampleRate,
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true),
        samplesPerBlock,
      };
    } else if (chunkId === CHUNK_FACT) {
      if (chunkSize >= 4 && available >= 4) {
        factFrames = view.getUint32(body, true);
      }
    } else if (chunkId === CHUNK_DATA) {
      // Truncated files: decode what is present instead of failing outright.
      dataOffset = body;
      dataSize = Math.min(chunkSize, available);
      break;
    }

    offset = body + chunkSize + (chunkSize & 1);
  }

  if (!format || dataOffset < 0 || dataSize <= 0) return null;
  return { format, dataOffset, dataSize, factFrames };
}

function decodeImaNibble(
  code: number,
  state: { predicted: number; index: number },
): number {
  const step = IMA_STEP_TABLE[state.index] ?? 7;
  let diff = step >> 3;
  if (code & 1) diff += step >> 2;
  if (code & 2) diff += step >> 1;
  if (code & 4) diff += step;
  if (code & 8) state.predicted -= diff;
  else state.predicted += diff;
  if (state.predicted > 32767) state.predicted = 32767;
  if (state.predicted < -32768) state.predicted = -32768;
  state.index += IMA_INDEX_TABLE[code] ?? -1;
  if (state.index < 0) state.index = 0;
  if (state.index > 88) state.index = 88;
  return state.predicted / 32768;
}

/** Microsoft 4-bit IMA ADPCM (`WAVE_FORMAT_IMA_ADPCM`, `0x0011`) used by Zero Hour. */
function decodeImaAdpcm(
  buffer: ArrayBuffer,
  layout: WavLayout,
): DecodedWav | null {
  const { format, dataOffset, dataSize, factFrames } = layout;
  const { channels, sampleRate, blockAlign } = format;
  if (blockAlign < 4 * channels) return null;

  const samplesPerBlock =
    format.samplesPerBlock > 0
      ? format.samplesPerBlock
      : Math.floor(((blockAlign - 4 * channels) * 2) / channels) + 1;
  if (samplesPerBlock < 1) return null;

  const blockCount = Math.floor(dataSize / blockAlign);
  const capacity = blockCount * samplesPerBlock;
  const frames = factFrames > 0 ? Math.min(factFrames, capacity) : capacity;
  if (frames < 1) return null;

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const output = Array.from(
    { length: channels },
    () => new Float32Array(frames),
  );
  let write = 0;

  for (let block = 0; block < blockCount && write < frames; block += 1) {
    const blockStart = dataOffset + block * blockAlign;
    const blockEnd = blockStart + blockAlign;
    const states: { predicted: number; index: number }[] = [];

    for (let channel = 0; channel < channels; channel += 1) {
      const stateOffset = blockStart + channel * 4;
      const predicted = view.getInt16(stateOffset, true);
      const index = Math.max(0, Math.min(88, view.getInt8(stateOffset + 2)));
      states.push({ predicted, index });
      const channelOut = output[channel];
      if (channelOut) channelOut[write] = predicted / 32768;
    }
    write += 1;
    let cursor = blockStart + channels * 4;

    if (channels === 1) {
      const state = states[0];
      const channelOut = output[0];
      if (!state || !channelOut) continue;
      while (cursor < blockEnd && write < frames) {
        const byte = bytes[cursor] ?? 0;
        cursor += 1;
        channelOut[write] = decodeImaNibble(byte & 0x0f, state);
        write += 1;
        if (write >= frames) break;
        channelOut[write] = decodeImaNibble((byte >> 4) & 0x0f, state);
        write += 1;
      }
      continue;
    }

    // Stereo/multichannel blocks interleave four bytes per channel and decode
    // eight samples per channel per group (Microsoft IMA ADPCM layout).
    while (cursor + 4 * channels <= blockEnd && write < frames) {
      for (let channel = 0; channel < channels; channel += 1) {
        const state = states[channel];
        const channelOut = output[channel];
        if (!state || !channelOut) continue;
        for (let i = 0; i < 4; i += 1) {
          const byte = bytes[cursor + channel * 4 + i] ?? 0;
          const first = write + i * 2;
          if (first < frames) {
            channelOut[first] = decodeImaNibble(byte & 0x0f, state);
          }
          if (first + 1 < frames) {
            channelOut[first + 1] = decodeImaNibble((byte >> 4) & 0x0f, state);
          }
        }
      }
      cursor += 4 * channels;
      write += 8;
    }
  }

  const written = Math.min(write, frames);
  if (written < 1) return null;
  return {
    channels: output.map((channel) => channel.subarray(0, written)),
    sampleRate,
    frames: written,
  };
}

function decodePcm(buffer: ArrayBuffer, layout: WavLayout): DecodedWav | null {
  const { format, dataOffset, dataSize } = layout;
  const { channels, sampleRate, bitsPerSample } = format;
  if (bitsPerSample !== 8 && bitsPerSample !== 16) return null;
  const bytesPerSample = bitsPerSample >> 3;
  const stride = channels * bytesPerSample;
  const frames = Math.floor(dataSize / stride);
  if (frames < 1) return null;

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const output = Array.from(
    { length: channels },
    () => new Float32Array(frames),
  );
  let cursor = dataOffset;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const channelOut = output[channel];
      if (channelOut) {
        channelOut[frame] =
          bitsPerSample === 16
            ? view.getInt16(cursor, true) / 32768
            : ((bytes[cursor] ?? 128) - 128) / 128;
      }
      cursor += bytesPerSample;
    }
  }
  return { channels: output, sampleRate, frames };
}

/**
 * Decodes RIFF/WAVE buffers without relying on the browser: Zero Hour's 4-bit IMA
 * ADPCM samples (`0x0011`) are rejected by `decodeAudioData` in Chromium and Safari.
 * Also handles 8/16-bit PCM. Returns `null` for unsupported or malformed data so the
 * caller can fall back to the native decoder.
 */
export function decodeWavPcmChannels(buffer: ArrayBuffer): DecodedWav | null {
  try {
    const layout = parseWavLayout(buffer);
    if (!layout) return null;
    if (layout.format.audioFormat === WAVE_FORMAT_IMA_ADPCM) {
      return decodeImaAdpcm(buffer, layout);
    }
    if (layout.format.audioFormat === WAVE_FORMAT_PCM) {
      return decodePcm(buffer, layout);
    }
    return null;
  } catch {
    return null;
  }
}

export class AudioLoader {
  private readonly catalog: AudioCatalog;
  private zhIndex: ZhRefIndex | null = null;
  private zhProbed = false;
  private zhProbePromise: Promise<boolean> | null = null;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>();
  private cachedBytes = 0;

  constructor(catalog: AudioCatalog) {
    this.catalog = catalog;
  }

  /**
   * Probes `/audio-ref/zh-events.json` on the dev server once. Every caller that arrives
   * while the probe is in flight shares the same promise, so a sound played before the
   * probe finishes can wait instead of silently falling back to a synthesised recipe.
   */
  async initReferencePack(): Promise<boolean> {
    if (this.zhProbed) return this.zhIndex !== null;
    if (this.zhProbePromise) return this.zhProbePromise;
    this.zhProbePromise = (async () => {
      try {
        if (typeof fetch === "undefined") return false;
        const res = await fetch("/audio-ref/zh-events.json", {
          cache: "no-store",
        });
        if (!res.ok) return false;
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) return false;
        this.zhIndex = (await res.json()) as ZhRefIndex;
        return true;
      } catch {
        return false;
      } finally {
        this.zhProbed = true;
      }
    })();
    return this.zhProbePromise;
  }

  isProbeDone(): boolean {
    return this.zhProbed;
  }

  hasReferencePack(): boolean {
    return this.zhIndex !== null;
  }

  getZhIndex(): ZhRefIndex | null {
    return this.zhIndex;
  }

  getCachedBytes(): number {
    return this.cachedBytes;
  }

  /**
   * Resolves a Zero Hour event name (from `reference.yaml` or `eva.yaml`) to a list of
   * `/audio-ref/...` URLs if the local reference pack is present.
   */
  resolveZhUrls(zhEventName: string | undefined): string[] {
    if (!zhEventName || !this.zhIndex) return [];
    const files = this.zhIndex.files ?? {};
    const lookupFile = (token: string): string | null => {
      const lower = token.toLowerCase();
      const base = lower.replace(/^.*[\\/]/, "");
      const stem = base.replace(/\.(wav|mp3)$/i, "");
      const rel = files[lower] ?? files[base] ?? files[stem];
      return rel ? `/audio-ref/${rel}` : null;
    };

    const ev = this.zhIndex.events?.[zhEventName];
    if (ev?.sounds?.length) {
      const urls = ev.sounds
        .map(lookupFile)
        .filter((u): u is string => u !== null);
      if (urls.length > 0) return urls;
    }
    const dlg = this.zhIndex.dialogs?.[zhEventName];
    if (dlg?.filename) {
      const url = lookupFile(dlg.filename);
      if (url) return [url];
    }
    const mus = this.zhIndex.music?.[zhEventName];
    if (mus?.filename) {
      const url = lookupFile(mus.filename);
      if (url) return [url];
    }
    const direct = lookupFile(zhEventName);
    return direct ? [direct] : [];
  }

  /**
   * Resolves an event's sound variants: if the reference pack has samples for `eventId`,
   * returns the `/audio-ref/...` URLs; otherwise returns the `synth:<recipe>` IDs from `events.yaml`.
   */
  resolveEventSounds(
    eventId: string,
    configuredSounds: readonly string[],
    forceSynth = false,
  ): string[] {
    if (!forceSynth && this.zhIndex) {
      const zhName = this.catalog.reference.events[eventId];
      // A referenced `NoSound` is a deliberate Zero Hour silence, not a reason to
      // invent an oscillator or a synth recipe.
      if (zhName === "NoSound") return [];
      const zhUrls = this.resolveZhUrls(zhName);
      if (zhUrls.length > 0) return zhUrls;
    }
    return [...configuredSounds];
  }

  /** Loads or synthesizes an `AudioBuffer` for `soundId` (`synth:<recipe>` or URL). */
  async getBuffer(
    ctx: BaseAudioContext,
    soundId: string,
  ): Promise<AudioBuffer | null> {
    const hit = this.cache.get(soundId);
    if (hit) {
      // Refresh LRU order
      this.cache.delete(soundId);
      this.cache.set(soundId, hit);
      return hit.buffer;
    }

    if (soundId.startsWith("synth:")) {
      const recipeName = soundId.slice("synth:".length);
      const recipe = this.catalog.recipes[recipeName] ?? DEFAULT_RECIPE;
      const buffer = createRecipeAudioBuffer(ctx, recipe);
      this.storeInCache(soundId, buffer);
      return buffer;
    }

    const inflight = this.pending.get(soundId);
    if (inflight) return inflight;

    const task = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(soundId);
        if (!res.ok) return this.fallbackBuffer(ctx);
        const arrayBuf = await res.arrayBuffer();
        const decoded = decodeWavPcmChannels(arrayBuf);
        if (decoded) {
          try {
            const buffer = ctx.createBuffer(
              decoded.channels.length,
              decoded.frames,
              decoded.sampleRate,
            );
            decoded.channels.forEach((channel, index) => {
              buffer.getChannelData(index).set(channel);
            });
            this.storeInCache(soundId, buffer);
            return buffer;
          } catch {
            // Invalid rate/length for this context: let the browser try below.
          }
        }
        const native = await ctx.decodeAudioData(arrayBuf);
        this.storeInCache(soundId, native);
        return native;
      } catch {
        return this.fallbackBuffer(ctx);
      } finally {
        this.pending.delete(soundId);
      }
    })();

    this.pending.set(soundId, task);
    return task;
  }

  /** Exports the procedural recipe for `soundId` (or default recipe) as a `.wav` byte array. */
  exportSynthWav(soundId: string): Uint8Array {
    const recipeName = soundId.startsWith("synth:")
      ? soundId.slice("synth:".length)
      : soundId;
    const recipe = this.catalog.recipes[recipeName] ?? DEFAULT_RECIPE;
    return encodeWavPcm16(synthesizePcm(recipe));
  }

  private fallbackBuffer(ctx: BaseAudioContext): AudioBuffer {
    const key = "synth:click";
    const cached = this.cache.get(key);
    if (cached) return cached.buffer;
    const buf = createRecipeAudioBuffer(
      ctx,
      this.catalog.recipes.click ?? DEFAULT_RECIPE,
    );
    this.storeInCache(key, buf);
    return buf;
  }

  private storeInCache(key: string, buffer: AudioBuffer): void {
    const bytes = buffer.length * buffer.numberOfChannels * 4;
    while (this.cachedBytes + bytes > MAX_CACHE_BYTES && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.cache.get(oldestKey);
      if (oldest) this.cachedBytes -= oldest.bytes;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { buffer, bytes });
    this.cachedBytes += bytes;
  }
}
