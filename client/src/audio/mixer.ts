// Web Audio mixer, bus graph, ducking automation, and Zero Hour sample playback
// (specs/25-audio.md §6, §9, §10). No engine oscillators: vehicles only play the
// discrete `SoundMoveStart` samples from the reference pack.
//
// Three playback paths share the same buses:
// - `play`: one-shots through the director's admission rules.
// - `setAmbient` / `syncConstructionLoops`: sample loops with Zero Hour loop
//   head/tail; they reconcile on snapshots and fade instead of hard-cutting.
// - `setMusicState` / `updateMusic`: a two-source crossfade driven by the
//   MusicDirector (calm <-> combat <-> result).
// To add a new loop, add the data/reference mapping and call one of the loop
// methods; never build a live oscillator graph (the old engine drone is gone).

import { AudioDirector, type ListenerState, resolveEventDef } from "./director";
import { EvaQueue } from "./eva";
import { AudioLoader } from "./loader";
import {
  dbToGain,
  distanceAttenuation,
  distanceLowPassHz,
  pickVariantIndex,
  screenStereoPan,
  zoomVolumeMultiplier,
} from "./math";
import { MusicDirector, type MusicResult, menuMusicEvent } from "./music";
import type {
  AdmissionDecision,
  AudioBusName,
  AudioCatalog,
  AudioDebugEntry,
  AudioPlayRequest,
  ConstructionLoopState,
  UnitLoopState,
} from "./types";

export interface VolumeSettings {
  audioMaster: number; // 0..100
  audioSfx: number; // 0..100
  /** Ambient beds get their own slider: birds/wind are not combat effects. */
  audioAmbient: number; // 0..100
  audioVoice: number; // 0..100
  audioMusic: number; // 0..100
  strongLanguage?: boolean;
}

interface PlayingNode {
  handle: number;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
}

interface SampleLoopNode {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode | null;
  panner: StereoPannerNode | null;
  /** Zero Hour `DecaySounds`: the loop tail, played once on stop. */
  decay: AudioBuffer | null;
  bus: AudioBusName;
  volume: number;
  pan: number;
  lowPassHz: number;
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
  private readonly sampleLoops = new Map<string, SampleLoopNode>();
  /** Pending loop starts, keyed like `sampleLoops`; prevents per-frame restarts. */
  private readonly loopRequests = new Map<string, number>();
  private loopGeneration = 0;
  private ambientEvent: string | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private musicGeneration = 0;
  private currentMusicEvent: string | null = null;
  private readonly musicDirector: MusicDirector;
  private listener: ListenerState = { tileX: 32, tileY: 32, zoom: 1 };
  private volumes: VolumeSettings;
  private paused = false;
  private unlocked = false;

  constructor(catalog: AudioCatalog, initialVolumes?: Partial<VolumeSettings>) {
    this.catalog = catalog;
    this.director = new AudioDirector({ catalog });
    this.evaQueue = new EvaQueue(catalog.eva.events);
    this.loader = new AudioLoader(catalog);
    this.musicDirector = new MusicDirector(catalog.mix.music.combatHoldMs);
    this.volumes = {
      audioMaster:
        initialVolumes?.audioMaster ?? catalog.mix.buses.master ?? 100,
      audioSfx: initialVolumes?.audioSfx ?? catalog.mix.buses.sfx ?? 80,
      audioAmbient:
        initialVolumes?.audioAmbient ?? catalog.mix.buses.ambient ?? 50,
      audioVoice: initialVolumes?.audioVoice ?? catalog.mix.buses.voice ?? 70,
      audioMusic: initialVolumes?.audioMusic ?? catalog.mix.buses.music ?? 55,
      strongLanguage: initialVolumes?.strongLanguage ?? true,
    };
    this.loader.strongLanguage = this.volumes.strongLanguage !== false;
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
      // Menu music covers the gap before the first match snapshot; the music
      // director swaps to calm/combat as soon as the match starts.
      if (this.currentMusicEvent === null) {
        this.setMusicState(menuMusicEvent());
      }
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
    if (next.strongLanguage !== undefined)
      this.loader.strongLanguage = next.strongLanguage;
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
      // Our own EVA take (`eva.<faction>.<event>`) wins over the reference pack.
      const own = this.loader.shippedSounds(
        `eva.${next.faction}.${next.eventId}`,
      );
      const zhUrls =
        own.length > 0 ? own : this.loader.resolveZhUrls(next.soundRef);
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

  /**
   * Advances the calm/combat/victory/defeat music state. Call it once per
   * snapshot; the director applies the quiet-window hysteresis and the mixer
   * crossfades over `mix.music.fadeMs` (Zero Hour `TimeToFadeAudio` = 2 s).
   */
  updateMusic(
    faction: string,
    combatActive: boolean,
    result: MusicResult,
    nowMs = performance.now(),
  ): void {
    this.musicDirector.setFaction(faction);
    const eventId = this.musicDirector.update({
      faction,
      combatActive,
      result,
      nowMs,
    });
    this.setMusicState(eventId);
  }

  /** Starts or crossfades a background music state. */
  setMusicState(eventId: string): void {
    if (this.currentMusicEvent === eventId) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;
    const def = resolveEventDef(this.catalog, eventId);
    if (!def) return;
    const generation = ++this.musicGeneration;
    this.currentMusicEvent = eventId;

    void (async () => {
      if (!this.loader.isProbeDone()) {
        await this.loader.initReferencePack();
      }
      if (generation !== this.musicGeneration) return;
      const sounds = this.loader.resolveEventSounds(eventId, def.sounds);
      const soundId = sounds[0];
      if (!soundId) {
        if (generation === this.musicGeneration) this.currentMusicEvent = null;
        return;
      }

      const buffer = await this.loader.getBuffer(ctx, soundId);
      if (generation !== this.musicGeneration) return;
      if (!buffer || !this.ctx || !this.buses) {
        this.currentMusicEvent = null;
        return;
      }
      const now = this.ctx.currentTime;
      const fadeSec = Math.max(0.05, this.catalog.mix.music.fadeMs / 1000);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      source.connect(gain);
      gain.connect(this.buses.music);
      source.start(now);
      gain.gain.linearRampToValueAtTime(1, now + fadeSec);

      const oldSource = this.musicSource;
      const oldGain = this.musicGain;
      this.musicSource = source;
      this.musicGain = gain;
      if (oldSource && oldGain) {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setTargetAtTime(0, now, fadeSec / 3);
        try {
          oldSource.stop(now + fadeSec + 0.1);
        } catch {
          // already stopped
        }
        oldSource.onended = () => {
          oldSource.disconnect();
          oldGain.disconnect();
        };
      }
    })();
  }

  /**
   * Starts, replaces or fades out the ambient bed. Ambient samples are not
   * positional: they play on the `ambient` bus at a constant level, like Zero
   * Hour's global weather beds. `null` means silence (`?weather=none`).
   */
  setAmbient(eventId: string | null): void {
    if (this.ambientEvent === eventId) return;
    this.ambientEvent = eventId;
    this.stopSampleLoop("ambient");
    if (eventId === null) return;
    const def = resolveEventDef(this.catalog, eventId);
    if (!def) return;
    this.startSampleLoop({
      key: "ambient",
      eventId,
      bus: "ambient",
      volume: (def.volume ?? 100) / 100,
      pan: 0,
      lowPassHz: 18000,
    });
  }

  /**
   * Reconciles the `UnderConstructionLoop` sample loops for buildings that
   * are currently under construction. Call once per snapshot, not per frame:
   * the same call updates distance/pan/gain and starts/stops only the delta.
   * At most `building.construct.limit` sites run at once, nearest first.
   */
  syncConstructionLoops(loops: readonly ConstructionLoopState[]): void {
    this.syncLoopGroup("construction:", "building.construct", loops);
  }

  /** Same reconcile for unit loops (tracks, wheels, turret servos), per event. */
  syncUnitLoops(loops: readonly UnitLoopState[]): void {
    for (const eventId of [
      "move.loop.tracks",
      "move.loop.wheels",
      "move.turret",
    ] as const) {
      this.syncLoopGroup(
        `${eventId}:`,
        eventId,
        loops.filter((loop) => loop.eventId === eventId),
      );
    }
  }

  private syncLoopGroup(
    prefix: string,
    eventId: string,
    loops: readonly ConstructionLoopState[],
  ): void {
    const def = resolveEventDef(this.catalog, eventId);
    if (!def) return;
    const limit = Math.max(1, def.limit ?? 2);
    const minDistance = def.minDistance ?? 10;
    const maxDistance = def.maxDistance ?? 100;
    const active = loops
      .filter(
        (loop) =>
          loop.onScreen && (loop.relation !== "enemy" || loop.tileVisible),
      )
      .map((loop) => ({
        loop,
        dist: Math.hypot(
          loop.tileX - this.listener.tileX,
          loop.tileY - this.listener.tileY,
        ),
      }))
      .filter(({ dist }) => dist < maxDistance)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, limit);

    const keep = new Set(active.map(({ loop }) => `${prefix}${loop.entityId}`));
    for (const key of [...this.sampleLoops.keys()]) {
      if (key.startsWith(prefix) && !keep.has(key)) {
        this.stopSampleLoop(key);
      }
    }
    for (const key of [...this.loopRequests.keys()]) {
      if (key.startsWith(prefix) && !keep.has(key)) {
        this.stopSampleLoop(key);
      }
    }

    const zoom = zoomVolumeMultiplier(
      this.listener.zoom,
      this.catalog.mix.zoom.minZoom,
      this.catalog.mix.zoom.maxZoom,
      this.catalog.mix.zoom.bonus,
    );
    const now = this.ctx?.currentTime ?? 0;
    for (const { loop, dist } of active) {
      const key = `${prefix}${loop.entityId}`;
      const volume =
        ((def.volume ?? 100) / 100) *
        distanceAttenuation(dist, minDistance, maxDistance) *
        zoom;
      const pan = screenStereoPan(loop.screenX);
      const lowPassHz = distanceLowPassHz(
        dist,
        minDistance,
        maxDistance,
        def.lowPass ?? 0,
      );
      const node = this.sampleLoops.get(key);
      if (node) {
        node.volume = volume;
        node.pan = pan;
        node.lowPassHz = lowPassHz;
        this.updateSampleLoop(node, now);
      } else if (!this.loopRequests.has(key)) {
        this.startSampleLoop({
          key,
          eventId,
          bus: "sfx",
          volume,
          pan,
          lowPassHz,
        });
      }
    }
  }

  private startSampleLoop(options: {
    key: string;
    eventId: string;
    bus: AudioBusName;
    volume: number;
    pan: number;
    lowPassHz: number;
  }): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;
    const def = resolveEventDef(this.catalog, options.eventId);
    if (!def) return;
    const generation = ++this.loopGeneration;
    this.loopRequests.set(options.key, generation);

    void (async () => {
      if (!this.loader.isProbeDone()) {
        await this.loader.initReferencePack();
      }
      if (this.loopRequests.get(options.key) !== generation) return;
      const parts = this.loader.resolveLoopParts(options.eventId, def.sounds);
      if (parts.loop.length === 0) {
        this.loopRequests.delete(options.key);
        return;
      }
      const index = pickVariantIndex(
        parts.loop.length,
        true,
        this.lastResolvedVariant.get(`${options.key}:loop`),
      );
      this.lastResolvedVariant.set(`${options.key}:loop`, index);
      // Zero Hour `Control = all` layers every listed sound (construction
      // machinery, meadow/wind beds); without it one variant is enough.
      const chosenId = parts.loop[index] ?? parts.loop[0];
      const loopIds = def.control?.includes("all")
        ? parts.loop
        : chosenId !== undefined
          ? [chosenId]
          : [];
      const loopBuffers = (
        await Promise.all(loopIds.map((id) => this.loader.getBuffer(ctx, id)))
      ).filter((buffer): buffer is AudioBuffer => buffer !== null);
      const loopBuffer =
        loopBuffers.length > 1
          ? this.mixBuffers(ctx, loopBuffers)
          : (loopBuffers[0] ?? null);
      const attackBuffers = (
        await Promise.all(
          parts.attack.map((id) => this.loader.getBuffer(ctx, id)),
        )
      ).filter((buffer): buffer is AudioBuffer => buffer !== null);
      const decayBuffers = (
        await Promise.all(
          parts.decay.map((id) => this.loader.getBuffer(ctx, id)),
        )
      ).filter((buffer): buffer is AudioBuffer => buffer !== null);
      const attackBuffer =
        attackBuffers.length > 1
          ? this.mixBuffers(ctx, attackBuffers)
          : (attackBuffers[0] ?? null);
      const decayBuffer =
        decayBuffers.length > 1
          ? this.mixBuffers(ctx, decayBuffers)
          : (decayBuffers[0] ?? null);
      if (this.loopRequests.get(options.key) !== generation) return;
      if (!loopBuffer || !this.ctx || !this.buses) {
        this.loopRequests.delete(options.key);
        return;
      }

      const now = this.ctx.currentTime;
      const source = this.ctx.createBufferSource();
      source.buffer = loopBuffer;
      source.loop = true;
      let lastNode: AudioNode = source;
      let filter: BiquadFilterNode | null = null;
      let panner: StereoPannerNode | null = null;
      if (options.lowPassHz < 17500) {
        filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = options.lowPassHz;
        lastNode.connect(filter);
        lastNode = filter;
      }
      if (
        options.pan !== 0 &&
        typeof this.ctx.createStereoPanner === "function"
      ) {
        panner = this.ctx.createStereoPanner();
        panner.pan.value = options.pan;
        lastNode.connect(panner);
        lastNode = panner;
      }
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      lastNode.connect(gain);
      gain.connect(this.buses[options.bus] ?? this.buses.sfx);
      source.start(now);
      const attackSec = attackBuffer ? Math.min(0.5, attackBuffer.duration) : 0;
      gain.gain.linearRampToValueAtTime(
        options.volume,
        now + Math.max(0.05, attackSec || 0.2),
      );

      this.sampleLoops.set(options.key, {
        source,
        gain,
        filter,
        panner,
        decay: decayBuffer,
        bus: options.bus,
        volume: options.volume,
        pan: options.pan,
        lowPassHz: options.lowPassHz,
      });
      this.loopRequests.delete(options.key);
      if (attackBuffer) this.playLoopOneShot(attackBuffer, options);
    })();
  }

  private stopSampleLoop(key: string): void {
    this.loopRequests.delete(key);
    const node = this.sampleLoops.get(key);
    if (!node) return;
    this.sampleLoops.delete(key);
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    node.gain.gain.cancelScheduledValues(now);
    node.gain.gain.setTargetAtTime(0, now, 0.08);
    try {
      node.source.stop(now + 0.4);
    } catch {
      // already stopped
    }
    node.source.onended = () => {
      node.source.disconnect();
      node.gain.disconnect();
      node.filter?.disconnect();
      node.panner?.disconnect();
    };
    if (node.decay) {
      this.playLoopOneShot(node.decay, {
        bus: node.bus,
        volume: node.volume,
        pan: node.pan,
        lowPassHz: node.lowPassHz,
      });
    }
  }

  private updateSampleLoop(node: SampleLoopNode, now: number): void {
    node.gain.gain.setTargetAtTime(node.volume, now, 0.08);
    node.panner?.pan.setTargetAtTime(node.pan, now, 0.08);
    node.filter?.frequency.setTargetAtTime(node.lowPassHz, now, 0.08);
  }

  /**
   * Mixes the variants of a Zero Hour `all` loop into one buffer. Scaling by
   * 1/sqrt(n) keeps layered beds (meadow, construction) from clipping while
   * staying louder than a single variant.
   */
  private mixBuffers(
    ctx: BaseAudioContext,
    buffers: readonly AudioBuffer[],
  ): AudioBuffer {
    const frames = Math.max(...buffers.map((buffer) => buffer.length));
    const channels = Math.max(
      ...buffers.map((buffer) => buffer.numberOfChannels),
    );
    const sampleRate = buffers[0]?.sampleRate ?? ctx.sampleRate;
    const mixed = ctx.createBuffer(channels, frames, sampleRate);
    const scale = 1 / Math.sqrt(buffers.length);
    for (let channel = 0; channel < channels; channel += 1) {
      const out = mixed.getChannelData(channel);
      for (const buffer of buffers) {
        const source = buffer.getChannelData(
          Math.min(channel, buffer.numberOfChannels - 1),
        );
        for (let frame = 0; frame < source.length; frame += 1) {
          out[frame] = (out[frame] ?? 0) + (source[frame] ?? 0) * scale;
        }
      }
    }
    return mixed;
  }

  private playLoopOneShot(
    buffer: AudioBuffer,
    options: {
      bus: AudioBusName;
      volume: number;
      pan: number;
      lowPassHz: number;
    },
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    let lastNode: AudioNode = source;
    let filter: BiquadFilterNode | null = null;
    let panner: StereoPannerNode | null = null;
    if (options.lowPassHz < 17500) {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowPassHz;
      lastNode.connect(filter);
      lastNode = filter;
    }
    if (options.pan !== 0 && typeof ctx.createStereoPanner === "function") {
      panner = ctx.createStereoPanner();
      panner.pan.value = options.pan;
      lastNode.connect(panner);
      lastNode = panner;
    }
    const gain = ctx.createGain();
    gain.gain.value = options.volume;
    lastNode.connect(gain);
    gain.connect(this.buses[options.bus] ?? this.buses.sfx);
    source.start();
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      filter?.disconnect();
      panner?.disconnect();
    };
  }

  getDebugLog(): readonly AudioDebugEntry[] {
    return this.director.getDebugLog();
  }

  /** Current music state id, or null before the first menu/calm track. */
  getMusicEvent(): string | null {
    return this.currentMusicEvent;
  }

  /** Current ambient bed id, or null when the map/climate has no bed. */
  getAmbientEvent(): string | null {
    return this.ambientEvent;
  }

  /** Number of live sample loops (construction sites plus the ambient bed). */
  getActiveLoopCount(): number {
    return this.sampleLoops.size;
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
      Math.min(1.5, this.volumes.audioAmbient / 100),
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
