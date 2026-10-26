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

function decodeImaNibble(
  code: number,
  state: { pred: number; index: number },
): number {
  const step = IMA_STEP_TABLE[state.index] ?? 7;
  let diff = step >> 3;
  if (code & 1) diff += step >> 2;
  if (code & 2) diff += step >> 1;
  if (code & 4) diff += step;
  if (code & 8) state.pred -= diff;
  else state.pred += diff;
  if (state.pred > 32767) state.pred = 32767;
  if (state.pred < -32768) state.pred = -32768;
  state.index += IMA_INDEX_TABLE[code] ?? -1;
  if (state.index < 0) state.index = 0;
  if (state.index > 88) state.index = 88;
  return state.pred / 32768;
}

/**
 * Decodes RIFF/WAVE buffers directly (including Zero Hour's `0x0011` 4-bit IMA ADPCM
 * weapon/explosion/impact samples that browser `decodeAudioData` rejects, as well as
 * `0x0001` 8/16-bit PCM). Returns `null` if the buffer is not a supported RIFF/WAVE.
 */
export function decodeWavPcmChannels(arrayBuf: ArrayBuffer): {
  channels: Float32Array[];
  sampleRate: number;
  frames: number;
} | null {
  if (arrayBuf.byteLength < 44) return null;
  const view = new DataView(arrayBuf);
  const bytes = new Uint8Array(arrayBuf);
  const riff =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;
  const wave =
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45;
  if (!riff || !wave) return null;

  let offset = 12;
  let fmtTag = 0;
  let numChannels = 1;
  let sampleRate = 22050;
  let blockAlign = 0;
  let bitsPerSample = 16;
  let samplesPerBlock = 0;
  let factSamples = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= arrayBuf.byteLength) {
    const c0 = bytes[offset];
    const c1 = bytes[offset + 1];
    const c2 = bytes[offset + 2];
    const c3 = bytes[offset + 3];
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (
      c0 === 0x66 &&
      c1 === 0x6d &&
      c2 === 0x74 &&
      c3 === 0x20 &&
      body + 16 <= arrayBuf.byteLength
    ) {
      // "fmt "
      fmtTag = view.getUint16(body, true);
      numChannels = Math.max(1, view.getUint16(body + 2, true));
      sampleRate = view.getUint32(body + 4, true);
      blockAlign = view.getUint16(body + 12, true);
      bitsPerSample = view.getUint16(body + 14, true);
      if (chunkSize >= 20 && body + 20 <= arrayBuf.byteLength) {
        samplesPerBlock = view.getUint16(body + 18, true);
      }
    } else if (
      c0 === 0x66 &&
      c1 === 0x61 &&
      c2 === 0x63 &&
      c3 === 0x74 &&
      chunkSize >= 4 &&
      body + 4 <= arrayBuf.byteLength
    ) {
      // "fact"
      factSamples = view.getUint32(body, true);
    } else if (c0 === 0x64 && c1 === 0x61 && c2 === 0x74 && c3 === 0x61) {
      // "data"
      dataOffset = body;
      dataSize = Math.min(chunkSize, arrayBuf.byteLength - body);
      break;
    }

    offset = body + chunkSize + (chunkSize & 1);
  }

  if (dataOffset === 0 || dataSize <= 0) return null;

  if (fmtTag === 0x0011 && blockAlign >= 4 * numChannels) {
    // Microsoft IMA ADPCM 4-bit
    const computedSpb =
      samplesPerBlock > 0
        ? samplesPerBlock
        : Math.floor(((blockAlign - 4 * numChannels) * 2) / numChannels) + 1;
    const numBlocks = Math.floor(dataSize / blockAlign);
    const maxFrames =
      factSamples > 0 ? factSamples : Math.max(1, numBlocks * computedSpb);
    const channels = Array.from(
      { length: numChannels },
      () => new Float32Array(maxFrames),
    );
    let frameWrite = 0;

    for (let b = 0; b < numBlocks && frameWrite < maxFrames; b++) {
      const bStart = dataOffset + b * blockAlign;
      const states: { pred: number; index: number }[] = [];
      for (let c = 0; c < numChannels; c++) {
        const pred = view.getInt16(bStart + c * 4, true);
        const index = Math.max(
          0,
          Math.min(88, view.getInt8(bStart + c * 4 + 2)),
        );
        states.push({ pred, index });
        const ch = channels[c];
        if (ch && frameWrite < maxFrames) {
          ch[frameWrite] = pred / 32768;
        }
      }
      frameWrite += 1;
      let pos = bStart + numChannels * 4;
      const bEnd = bStart + blockAlign;

      if (numChannels === 1) {
        const ch0 = channels[0];
        const st0 = states[0];
        if (ch0 && st0) {
          while (pos < bEnd && frameWrite < maxFrames) {
            const byte = bytes[pos++] ?? 0;
            ch0[frameWrite++] = decodeImaNibble(byte & 0x0f, st0);
            if (frameWrite < maxFrames) {
              ch0[frameWrite++] = decodeImaNibble((byte >> 4) & 0x0f, st0);
            }
          }
        }
      } else {
        while (pos + 4 * numChannels <= bEnd && frameWrite < maxFrames) {
          for (let c = 0; c < numChannels; c++) {
            const ch = channels[c];
            const st = states[c];
            if (!ch || !st) continue;
            for (let i = 0; i < 4; i++) {
              const byte = bytes[pos + c * 4 + i] ?? 0;
              const f0 = frameWrite + i * 2;
              const f1 = f0 + 1;
              const s0 = decodeImaNibble(byte & 0x0f, st);
              const s1 = decodeImaNibble((byte >> 4) & 0x0f, st);
              if (f0 < maxFrames) ch[f0] = s0;
              if (f1 < maxFrames) ch[f1] = s1;
            }
          }
          pos += 4 * numChannels;
          frameWrite = Math.min(maxFrames, frameWrite + 8);
        }
      }
    }

    return {
      channels:
        frameWrite < maxFrames
          ? channels.map((ch) => ch.subarray(0, frameWrite))
          : channels,
      sampleRate,
      frames: Math.max(1, frameWrite),
    };
  }

  if (fmtTag === 0x0001 && (bitsPerSample === 16 || bitsPerSample === 8)) {
    const bytesPerSample = bitsPerSample >> 3;
    const frameStride = numChannels * bytesPerSample;
    const frames = Math.floor(dataSize / frameStride);
    if (frames <= 0) return null;
    const channels = Array.from(
      { length: numChannels },
      () => new Float32Array(frames),
    );
    let pos = dataOffset;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numChannels; c++) {
        const ch = channels[c];
        if (ch) {
          ch[i] =
            bitsPerSample === 16
              ? view.getInt16(pos, true) / 32768
              : ((bytes[pos] ?? 128) - 128) / 128;
        }
        pos += bytesPerSample;
      }
    }
    return { channels, sampleRate, frames };
  }

  return null;
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

  /** Probes `/audio-ref/zh-events.json` on the dev server once (deduplicating concurrent calls). */
  async initReferencePack(): Promise<boolean> {
    if (this.zhProbed) return this.zhIndex !== null;
    if (this.zhProbePromise) return this.zhProbePromise;
    this.zhProbePromise = (async () => {
      if (typeof fetch === "undefined") {
        this.zhProbed = true;
        return false;
      }
      try {
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
    const zhName = this.catalog.reference.events[eventId];
    if (zhName === "NoSound" && !forceSynth) {
      return [];
    }
    if (!forceSynth && this.zhIndex) {
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
        const wavDecoded = decodeWavPcmChannels(arrayBuf);
        if (wavDecoded) {
          const buffer = ctx.createBuffer(
            wavDecoded.channels.length,
            wavDecoded.frames,
            wavDecoded.sampleRate,
          );
          for (let c = 0; c < wavDecoded.channels.length; c++) {
            const src = wavDecoded.channels[c];
            if (src) buffer.getChannelData(c).set(src);
          }
          this.storeInCache(soundId, buffer);
          return buffer;
        }
        const decoded = await ctx.decodeAudioData(arrayBuf);
        this.storeInCache(soundId, decoded);
        return decoded;
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
