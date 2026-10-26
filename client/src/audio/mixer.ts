// Web Audio mixer, bus graph, ducking automation, and Zero Hour sample playback
// (specs/25-audio.md §6, §9, §10). No engine oscillators: vehicles only play the
// discrete `SoundMoveStart` samples from the reference pack.

import { AudioDirector, type ListenerState, resolveEventDef } from "./director";
import { EvaQueue } from "./eva";
import { AudioLoader } from "./loader";
import { dbToGain, pickVariantIndex } from "./math";
import type {
  AdmissionDecision,
  AudioBusName,
  AudioCatalog,
  AudioDebugEntry,
  AudioPlayRequest,
} from "./types";

export interface VolumeSettings {
  audioMaster: number; // 0..100
  audioSfx: number; // 0..100
  audioVoice: number; // 0..100
  audioMusic: number; // 0..100
  strongLanguage?: boolean;
}

interface PlayingNode {
  handle: number;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
}

export class AudioMixer {
  readonly catalog: AudioCatalog;
  readonly director: AudioDirector;
  readonly evaQueue: EvaQueue;
  readonly loader: AudioLoader;

  private ctx: AudioContext | null = null;
  private buses: Record<AudioBusName, GainNode> | null = null;
  private duckNodes: { music: GainNode; sfx: GainNode } | null = null;
  private readonly playing = new Map<number, PlayingNode>();
  private readonly lastResolvedVariant = new Map<string, number>();
  private musicSource: AudioBufferSourceNode | null = null;
  private currentMusicEvent: string | null = null;
  private listener: ListenerState = { tileX: 32, tileY: 32, zoom: 1 };
  private volumes: VolumeSettings;
  private paused = false;
  private unlocked = false;

  constructor(catalog: AudioCatalog, initialVolumes?: Partial<VolumeSettings>) {
    this.catalog = catalog;
    this.director = new AudioDirector({ catalog });
    this.evaQueue = new EvaQueue(catalog.eva.events);
    this.loader = new AudioLoader(catalog);
    this.volumes = {
      audioMaster:
        initialVolumes?.audioMaster ?? catalog.mix.buses.master ?? 100,
      audioSfx: initialVolumes?.audioSfx ?? catalog.mix.buses.sfx ?? 80,
      audioVoice: initialVolumes?.audioVoice ?? catalog.mix.buses.voice ?? 70,
      audioMusic: initialVolumes?.audioMusic ?? catalog.mix.buses.music ?? 55,
      strongLanguage: initialVolumes?.strongLanguage ?? true,
    };
  }

  /** Hooks first user gesture to create & resume `AudioContext` and probe `/audio-ref/`. */
  installGestureUnlock(target: EventTarget = window): void {
    void this.loader.initReferencePack();
    const unlock = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === "suspended" && !this.paused) {
        void this.ctx.resume();
      }
      this.unlocked = true;
    };
    target.addEventListener("pointerdown", unlock, { passive: true });
    target.addEventListener("keydown", unlock, { passive: true });
  }

  updateListener(listener: ListenerState): void {
    this.listener = listener;
  }

  getListener(): ListenerState {
    return this.listener;
  }

  getVolumes(): VolumeSettings {
    return { ...this.volumes };
  }

  setVolumes(next: Partial<VolumeSettings>): void {
    this.volumes = { ...this.volumes, ...next };
    this.applyBusVolumes();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!this.ctx) return;
    if (paused) {
      void this.ctx.suspend();
    } else if (this.unlocked) {
      void this.ctx.resume();
    }
  }

  /**
   * Submits a play request through `AudioDirector.admit()` (`canPlayNow`) and plays it
   * if admitted.
   */
  play(
    request: AudioPlayRequest,
    options?: { fallbackCategory?: string; forceSynth?: boolean },
  ): AdmissionDecision {
    const { decision, handle } = this.director.admit(
      request,
      this.listener,
      options?.fallbackCategory,
    );
    if (!decision.admitted || handle === null) {
      return decision;
    }

    // Stop any channels killed by voice-rule interrupt, per-event limit, or priority steal
    for (const killed of decision.killedHandles) {
      this.stopHandle(killed);
    }

    const def = resolveEventDef(
      this.catalog,
      request.eventId,
      options?.fallbackCategory,
    );
    const configuredSounds = def?.sounds ?? [decision.soundId];
    const forceSynth = options?.forceSynth ?? false;
    const isRandom = def?.control?.includes("random") ?? true;
    const resolved = this.resolvePlaybackVariant(
      request.eventId,
      configuredSounds,
      isRandom,
      forceSynth,
    );
    if (!resolved) {
      this.director.releaseChannel(handle);
      return decision;
    }
    decision.variantIndex = resolved.index;
    decision.soundId = resolved.soundId;

    this.schedulePlayback(
      handle,
      decision,
      request.eventId,
      configuredSounds,
      isRandom,
      forceSynth,
    );
    return decision;
  }

  /**
   * Resolves the samples for an event and picks a variant that respects `random`.
   * Reference events have more variants than the single `synth:` fallback in our data,
   * so the pick must happen after the reference pack has been resolved.
   */
  private resolvePlaybackVariant(
    eventId: string,
    configuredSounds: readonly string[],
    isRandom: boolean,
    forceSynth: boolean,
  ): { soundId: string; index: number } | null {
    const sounds = this.loader.resolveEventSounds(
      eventId,
      configuredSounds,
      forceSynth,
    );
    if (sounds.length === 0) return null;
    const index = pickVariantIndex(
      sounds.length,
      isRandom,
      this.lastResolvedVariant.get(eventId),
    );
    this.lastResolvedVariant.set(eventId, index);
    return {
      soundId: sounds[index] ?? sounds[0] ?? "",
      index,
    };
  }

  /** Directly auditions an event ID on the debug overlay (bypassing fog/distance cull). */
  audition(eventId: string, forceSynth = false): AdmissionDecision {
    return this.play(
      {
        eventId,
        relation: "self",
        tileX: this.listener.tileX,
        tileY: this.listener.tileY,
        screenX: 0,
        onScreen: true,
        tileVisible: true,
      },
      { forceSynth },
    );
  }

  /** Enqueues an EVA event and processes the EVA priority queue. */
  triggerEva(eventId: string, faction: string): boolean {
    const queued = this.evaQueue.trigger(eventId, faction);
    this.tickEva();
    return queued;
  }

  /** Advances the EVA queue and plays the highest-priority waiting announcement if free. */
  tickEva(): void {
    const next = this.evaQueue.process(2000);
    if (!next) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;

    void (async () => {
      if (!this.loader.isProbeDone()) {
        await this.loader.initReferencePack();
      }
      const zhUrls = this.loader.resolveZhUrls(next.soundRef);
      const pickedUrl =
        zhUrls.length > 0
          ? zhUrls[pickVariantIndex(zhUrls.length, true, undefined)]
          : undefined;
      const soundId =
        pickedUrl ??
        (next.soundRef.startsWith("synth:") ? next.soundRef : "synth:eva");

      const buffer = await this.loader.getBuffer(ctx, soundId);
      if (!buffer || !this.ctx || !this.buses) return;
      const durationMs = buffer.duration * 1000;
      this.evaQueue.notifyPlayingDuration(durationMs);
      this.applyDucking("eva", durationMs);

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.95;
      source.connect(gain);
      gain.connect(this.buses.eva);
      source.start();
    })();
  }

  /** Starts or crossfades background music state (`music.calm.<faction>`, `music.combat.<faction>`, etc.). */
  setMusicState(eventId: string): void {
    if (this.currentMusicEvent === eventId) return;
    this.currentMusicEvent = eventId;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;

    if (this.musicSource) {
      try {
        this.musicSource.stop();
        this.musicSource.disconnect();
      } catch {
        // ignore
      }
      this.musicSource = null;
    }

    const def = resolveEventDef(this.catalog, eventId);
    if (!def) return;

    void (async () => {
      if (!this.loader.isProbeDone()) {
        await this.loader.initReferencePack();
      }
      const sounds = this.loader.resolveEventSounds(eventId, def.sounds);
      const soundId = sounds[0];
      if (!soundId) return;
      if (this.currentMusicEvent !== eventId) return;

      const buffer = await this.loader.getBuffer(ctx, soundId);
      if (
        !buffer ||
        !this.ctx ||
        !this.buses ||
        this.currentMusicEvent !== eventId
      )
        return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.buses.music);
      source.start();
      this.musicSource = source;
    })();
  }

  getDebugLog(): readonly AudioDebugEntry[] {
    return this.director.getDebugLog();
  }

  private schedulePlayback(
    handle: number,
    decision: AdmissionDecision,
    eventId: string,
    configuredSounds: readonly string[],
    isRandom: boolean,
    forceSynth: boolean,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) {
      // Release immediately in headless/non-WebAudio environments after a synthetic tick
      setTimeout(() => this.director.releaseChannel(handle), 150);
      return;
    }

    void (async () => {
      let soundId = decision.soundId;
      // The first sounds of a match can arrive while the reference probe is in
      // flight. Wait for it and re-resolve so they use the real Zero Hour sample
      // instead of the synth fallback.
      if (!forceSynth && !this.loader.isProbeDone()) {
        await this.loader.initReferencePack();
        const resolved = this.resolvePlaybackVariant(
          eventId,
          configuredSounds,
          isRandom,
          false,
        );
        if (!resolved) {
          this.director.releaseChannel(handle);
          return;
        }
        soundId = resolved.soundId;
        decision.variantIndex = resolved.index;
        decision.soundId = soundId;
      }

      const buffer = await this.loader.getBuffer(ctx, soundId);
      if (!buffer || !this.ctx || !this.buses) {
        this.director.releaseChannel(handle);
        return;
      }
      // Check if handle was already stolen/killed while probing/decoding
      if (
        !this.director.getActiveChannels().some((ch) => ch.handle === handle)
      ) {
        return;
      }

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = decision.playbackRate;

      const gainNode = this.ctx.createGain();
      gainNode.gain.value = decision.effectiveVolume;

      let lastNode: AudioNode = source;

      if (decision.pool === "world") {
        if (decision.lowPassHz < 17500) {
          const filter = this.ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = decision.lowPassHz;
          lastNode.connect(filter);
          lastNode = filter;
        }
        if (
          typeof this.ctx.createStereoPanner === "function" &&
          decision.pan !== 0
        ) {
          const panner = this.ctx.createStereoPanner();
          panner.pan.value = decision.pan;
          lastNode.connect(panner);
          lastNode = panner;
        }
      }

      lastNode.connect(gainNode);
      const targetBus = this.buses[decision.bus] ?? this.buses.sfx;
      gainNode.connect(targetBus);

      if (decision.bus === "voice") {
        this.applyDucking(
          "voice",
          (buffer.duration / decision.playbackRate) * 1000,
        );
      }

      this.playing.set(handle, { handle, source, gainNode });
      source.onended = () => {
        this.playing.delete(handle);
        this.director.releaseChannel(handle);
      };

      const startAt = this.ctx.currentTime + decision.delayMs / 1000;
      source.start(startAt);
    })();
  }

  private stopHandle(handle: number): void {
    const node = this.playing.get(handle);
    this.playing.delete(handle);
    this.director.releaseChannel(handle);
    if (node) {
      try {
        node.source.onended = null;
        node.source.stop();
        node.source.disconnect();
        node.gainNode.disconnect();
      } catch {
        // ignore
      }
    }
  }

  private applyDucking(kind: "eva" | "voice", durationMs: number): void {
    if (!this.ctx || !this.duckNodes) return;
    const rule = this.catalog.mix.ducking[kind];
    const now = this.ctx.currentTime;
    const holdSec = (durationMs + rule.holdMs) / 1000;
    const releaseSec = Math.max(0.05, rule.releaseMs / 1000);

    if (rule.musicDb < 0) {
      const g = dbToGain(rule.musicDb);
      this.duckNodes.music.gain.cancelScheduledValues(now);
      this.duckNodes.music.gain.setTargetAtTime(g, now, 0.03);
      this.duckNodes.music.gain.setTargetAtTime(
        1,
        now + holdSec,
        releaseSec / 3,
      );
    }
    if (rule.sfxDb < 0) {
      const g = dbToGain(rule.sfxDb);
      this.duckNodes.sfx.gain.cancelScheduledValues(now);
      this.duckNodes.sfx.gain.setTargetAtTime(g, now, 0.03);
      this.duckNodes.sfx.gain.setTargetAtTime(1, now + holdSec, releaseSec / 3);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      const ctx = new AudioCtx();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -6;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      compressor.connect(ctx.destination);

      const master = ctx.createGain();
      master.connect(compressor);

      const sfxDuck = ctx.createGain();
      sfxDuck.connect(master);
      const musicDuck = ctx.createGain();
      musicDuck.connect(master);

      const sfx = ctx.createGain();
      sfx.connect(sfxDuck);
      const voice = ctx.createGain();
      voice.connect(master);
      const eva = ctx.createGain();
      eva.connect(master);
      const ui = ctx.createGain();
      ui.connect(master);
      const ambient = ctx.createGain();
      ambient.connect(sfxDuck);
      const music = ctx.createGain();
      music.connect(musicDuck);

      this.ctx = ctx;
      this.buses = { master, sfx, voice, eva, ui, ambient, music };
      this.duckNodes = { music: musicDuck, sfx: sfxDuck };
      this.applyBusVolumes();
      return ctx;
    } catch {
      return null;
    }
  }

  private applyBusVolumes(): void {
    if (!this.buses) return;
    this.buses.master.gain.value = Math.max(
      0,
      Math.min(1.5, this.volumes.audioMaster / 100),
    );
    this.buses.sfx.gain.value = Math.max(
      0,
      Math.min(1.5, this.volumes.audioSfx / 100),
    );
    this.buses.ui.gain.value = Math.max(
      0,
      Math.min(1.5, this.volumes.audioSfx / 100),
    );
    this.buses.ambient.gain.value = Math.max(
      0,
      Math.min(1.5, (this.volumes.audioSfx / 100) * 0.75),
    );
    this.buses.voice.gain.value = Math.max(
      0,
      Math.min(1.5, this.volumes.audioVoice / 100),
    );
    this.buses.eva.gain.value = Math.max(
      0,
      Math.min(1.5, this.volumes.audioVoice / 100),
    );
    this.buses.music.gain.value = Math.max(
      0,
      Math.min(1.5, this.volumes.audioMusic / 100),
    );
  }
}
