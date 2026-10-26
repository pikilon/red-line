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

export class AudioLoader {
  private readonly catalog: AudioCatalog;
  private zhIndex: ZhRefIndex | null = null;
  private zhProbed = false;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>();
  private cachedBytes = 0;

  constructor(catalog: AudioCatalog) {
    this.catalog = catalog;
  }

  /** Probes `/audio-ref/zh-events.json` on the dev server once. */
  async initReferencePack(): Promise<boolean> {
    if (this.zhProbed) return this.zhIndex !== null;
    this.zhProbed = true;
    if (typeof fetch === "undefined") return false;
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
    }
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
