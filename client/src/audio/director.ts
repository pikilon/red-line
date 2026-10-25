// Zero Hour audio admission director (`SoundManager::canPlayNow`, GameSounds.cpp:206-322,
// `AudioManager::shouldPlayLocally`, GameAudio.cpp:1020, and spec 25 §6).

import {
  distanceAttenuation,
  distanceLowPassHz,
  pickVariantIndex,
  relative2dMultiplier,
  sampleDelayMs,
  samplePitchRate,
  sampleVolumeShift,
  screenStereoPan,
  zoomVolumeMultiplier,
} from "./math";
import {
  type ActiveChannel,
  type AdmissionDecision,
  type AdmissionReason,
  AUDIO_PRIORITY_RANK,
  type AudioBusName,
  type AudioCatalog,
  type AudioDebugEntry,
  type AudioEventDef,
  type AudioPlayRequest,
  type PlayerRelation,
  type SoundTypeFlag,
} from "./types";

const DEFAULT_MIN_DISTANCE = 4;
const DEFAULT_MAX_DISTANCE = 24;
const DEFAULT_LIMIT = 4;
const MAX_DEBUG_LOG = 80;

export interface ListenerState {
  tileX: number;
  tileY: number;
  zoom: number;
}

export interface DirectorOptions {
  catalog: AudioCatalog;
  nowMs?: () => number;
  rng?: () => number;
}

/**
 * Audience admission (`AudioManager::shouldPlayLocally`, `GameAudio.cpp:1020`).
 * Events without audience flags default to `everyone`.
 */
export function shouldPlayLocally(
  types: readonly SoundTypeFlag[],
  relation: PlayerRelation = "self",
): boolean {
  const hasPlayer = types.includes("player");
  const hasAllies = types.includes("allies");
  const hasEnemies = types.includes("enemies");
  const hasEveryone = types.includes("everyone");
  if (hasEveryone || (!hasPlayer && !hasAllies && !hasEnemies)) return true;
  if (relation === "self" && hasPlayer) return true;
  if (relation === "ally" && hasAllies) return true;
  if ((relation === "enemy" || relation === "neutral") && hasEnemies)
    return true;
  return false;
}

function resolveBus(
  eventId: string,
  types: readonly SoundTypeFlag[],
): AudioBusName {
  if (eventId.startsWith("music.")) return "music";
  if (eventId.startsWith("eva.")) return "eva";
  if (eventId.startsWith("ambient.")) return "ambient";
  if (types.includes("voice") || eventId.startsWith("voice.")) return "voice";
  if (types.includes("ui") || eventId.startsWith("ui.")) return "ui";
  return "sfx";
}

/**
 * Resolves an event ID against `catalog.events` and `catalog.voices.sets`
 * (including `voice.<unitTypeId>.<action>` -> `voice.<category>.<action>`).
 */
export function resolveEventDef(
  catalog: AudioCatalog,
  eventId: string,
  fallbackCategory?: string,
): AudioEventDef | null {
  const direct = catalog.events[eventId];
  if (direct) return { id: eventId, ...direct };

  if (eventId.startsWith("voice.")) {
    const parts = eventId.split(".");
    const setKey = parts[1];
    const action = parts[2] as
      | keyof (typeof catalog.voices.sets)[string]
      | undefined;
    if (setKey !== undefined && action !== undefined) {
      const set =
        catalog.voices.sets[setKey] ??
        (fallbackCategory
          ? catalog.voices.sets[fallbackCategory]
          : undefined) ??
        catalog.voices.sets.unit;
      const voiceDef = set?.[action];
      if (voiceDef) return { id: eventId, ...voiceDef };
    }
  }
  return null;
}

export class AudioDirector {
  private readonly catalog: AudioCatalog;
  private readonly nowMs: () => number;
  private readonly rng: () => number;
  private nextHandle = 1;
  private readonly active = new Map<number, ActiveChannel>();
  private readonly lastVariantByEvent = new Map<string, number>();
  private readonly unitUnderFireAt = new Map<number, number>();
  private lastGlobalUnderFireAt = -Infinity;
  private readonly debugLog: AudioDebugEntry[] = [];

  constructor(options: DirectorOptions) {
    this.catalog = options.catalog;
    this.nowMs = options.nowMs ?? (() => performance.now());
    this.rng = options.rng ?? Math.random;
  }

  getActiveChannels(): ActiveChannel[] {
    return [...this.active.values()];
  }

  getPoolCounts(): { world: number; ui: number } {
    let world = 0;
    let ui = 0;
    for (const ch of this.active.values()) {
      if (ch.pool === "world") world += 1;
      else ui += 1;
    }
    return { world, ui };
  }

  getDebugLog(): readonly AudioDebugEntry[] {
    return this.debugLog;
  }

  clearDebugLog(): void {
    this.debugLog.length = 0;
  }

  releaseChannel(handle: number): void {
    this.active.delete(handle);
  }

  reset(): void {
    this.active.clear();
    this.lastVariantByEvent.clear();
    this.unitUnderFireAt.clear();
    this.lastGlobalUnderFireAt = -Infinity;
  }

  /**
   * Evaluates Zero Hour's `canPlayNow` 6-step admission pipeline (`GameSounds.cpp:206`)
   * and, if admitted, registers the channel (stealing or interrupting if needed).
   */
  admit(
    request: AudioPlayRequest,
    listener: ListenerState,
    fallbackCategory?: string,
  ): { decision: AdmissionDecision; handle: number | null } {
    const now = this.nowMs();
    const def = resolveEventDef(
      this.catalog,
      request.eventId,
      fallbackCategory,
    );
    if (!def || def.sounds.length === 0) {
      return this.reject(request.eventId, "unknown_event", "ui", "sfx", now);
    }

    const types = def.type ?? ["ui", "player"];
    const controls = def.control ?? ["random"];
    const priority = def.priority ?? "normal";
    const isWorld = types.includes("world");
    const isGlobal = types.includes("global");
    const isShrouded = types.includes("shrouded");
    const isVoice = types.includes("voice");
    const isInterrupt = controls.includes("interrupt");
    const isRandom = controls.includes("random");
    const pool: "world" | "ui" = isWorld && !isGlobal ? "world" : "ui";
    const bus = resolveBus(def.id, types);

    // Step 1: Audience filter (`AudioManager::shouldPlayLocally`, GameAudio.cpp:1020)
    const relation = request.relation ?? "self";
    if (!shouldPlayLocally(types, relation)) {
      return this.reject(def.id, "culled_audience", pool, bus, now);
    }

    // Step 1b: Spec 25 §6 differences: underFire and infantry death screams require on-screen
    if (
      (request.isUnderFire || request.infantryScream) &&
      request.onScreen === false
    ) {
      return this.reject(def.id, "culled_offscreen", pool, bus, now);
    }

    // Step 2: Distance & shroud cull (`SoundManager::canPlayNow`, GameSounds.cpp:225-248)
    let dist = 0;
    const minDistance = def.minDistance ?? DEFAULT_MIN_DISTANCE;
    const maxDistance = def.maxDistance ?? DEFAULT_MAX_DISTANCE;
    if (
      isWorld &&
      !isGlobal &&
      request.tileX !== undefined &&
      request.tileY !== undefined
    ) {
      dist = Math.hypot(
        request.tileX - listener.tileX,
        request.tileY - listener.tileY,
      );
      if (priority !== "critical" && dist >= maxDistance) {
        return this.reject(def.id, "culled_distance", pool, bus, now);
      }
      if (
        isShrouded &&
        relation !== "self" &&
        relation !== "ally" &&
        request.tileVisible === false
      ) {
        return this.reject(def.id, "culled_shroud", pool, bus, now);
      }
    }

    // Effective volume calculation (`MilesAudioManager::getEffectiveVolume`)
    const baseVolume = (def.volume ?? 100) / 100;
    const volShift = sampleVolumeShift(def.volumeShift ?? 0, this.rng);
    let effectiveVolume = baseVolume * volShift;

    if (isWorld && !isGlobal) {
      const atten = distanceAttenuation(dist, minDistance, maxDistance);
      const zoomMult = zoomVolumeMultiplier(
        listener.zoom,
        this.catalog.mix.zoom.minZoom,
        this.catalog.mix.zoom.maxZoom,
        this.catalog.mix.zoom.bonus,
      );
      effectiveVolume *= atten * zoomMult;
    } else {
      effectiveVolume *= relative2dMultiplier(
        this.catalog.mix.limits.relative2dVolume,
      );
    }

    const minSampleVol = Math.max(
      this.catalog.mix.limits.minSampleVolume,
      (def.minVolume ?? 0) / 1000,
    );
    if (effectiveVolume < minSampleVol) {
      return this.reject(
        def.id,
        "culled_min_volume",
        pool,
        bus,
        now,
        effectiveVolume,
      );
    }

    const killedHandles: number[] = [];

    // Step 3: Voice concurrency (`violatesVoice`, GameSounds.cpp:322, MilesAudioManager.cpp:1933)
    if (isVoice && request.entityId !== undefined) {
      const existingVoice = [...this.active.values()].find(
        (ch) => ch.isVoice && ch.entityId === request.entityId,
      );
      if (existingVoice) {
        if (!isInterrupt || request.isUnderFire) {
          return this.reject(
            def.id,
            "culled_voice_rule",
            pool,
            bus,
            now,
            effectiveVolume,
          );
        }
        killedHandles.push(existingVoice.handle);
      }
    }

    // Step 3b: Under-fire per-unit cooldown (12s) and global budget (1 line per 3s) (spec 25 §6.4)
    if (request.isUnderFire) {
      const { perUnitCooldownMs, globalCooldownMs } =
        this.catalog.mix.underFire;
      if (request.entityId !== undefined) {
        const lastUnit =
          this.unitUnderFireAt.get(request.entityId) ?? -Infinity;
        if (now - lastUnit < perUnitCooldownMs) {
          return this.reject(
            def.id,
            "culled_under_fire_cooldown",
            pool,
            bus,
            now,
            effectiveVolume,
          );
        }
      }
      if (now - this.lastGlobalUnderFireAt < globalCooldownMs) {
        return this.reject(
          def.id,
          "culled_under_fire_budget",
          pool,
          bus,
          now,
          effectiveVolume,
        );
      }
    }

    // Step 4: Per-event instance limit (`doesViolateLimit`, MilesAudioManager.cpp:1826)
    const limit = def.limit ?? DEFAULT_LIMIT;
    if (limit > 0) {
      const sameEvent = [...this.active.values()]
        .filter(
          (ch) => ch.eventId === def.id && !killedHandles.includes(ch.handle),
        )
        .sort((a, b) => a.startedAtMs - b.startedAtMs);
      if (sameEvent.length >= limit) {
        const oldest = sameEvent[0];
        if (!isInterrupt || oldest === undefined) {
          return this.reject(
            def.id,
            "culled_limit",
            pool,
            bus,
            now,
            effectiveVolume,
          );
        }
        killedHandles.push(oldest.handle);
      }
    }

    // Step 5 & 6: Channel pool check, priority stealing (`isPlayingLowerPriority`), or interrupt fallback
    const poolLimit =
      pool === "world"
        ? this.catalog.mix.limits.worldChannels
        : this.catalog.mix.limits.uiChannels;
    const poolActive = [...this.active.values()].filter(
      (ch) => ch.pool === pool && !killedHandles.includes(ch.handle),
    );

    if (poolActive.length >= poolLimit) {
      const reqRank = AUDIO_PRIORITY_RANK[priority];
      let stealCandidate: ActiveChannel | undefined;
      for (const ch of poolActive) {
        const chRank = AUDIO_PRIORITY_RANK[ch.priority];
        if (chRank < reqRank && reqRank > AUDIO_PRIORITY_RANK.lowest) {
          if (
            !stealCandidate ||
            AUDIO_PRIORITY_RANK[stealCandidate.priority] > chRank ||
            (AUDIO_PRIORITY_RANK[stealCandidate.priority] === chRank &&
              stealCandidate.startedAtMs > ch.startedAtMs)
          ) {
            stealCandidate = ch;
          }
        }
      }
      if (stealCandidate) {
        killedHandles.push(stealCandidate.handle);
      } else if (isInterrupt) {
        const sameInPool = poolActive.find((ch) => ch.eventId === def.id);
        if (sameInPool) {
          killedHandles.push(sameInPool.handle);
        } else {
          return this.reject(
            def.id,
            "culled_pool_full",
            pool,
            bus,
            now,
            effectiveVolume,
          );
        }
      } else {
        return this.reject(
          def.id,
          "culled_pool_full",
          pool,
          bus,
          now,
          effectiveVolume,
        );
      }
    }

    for (const h of killedHandles) {
      this.active.delete(h);
    }

    if (request.isUnderFire) {
      this.lastGlobalUnderFireAt = now;
      if (request.entityId !== undefined) {
        this.unitUnderFireAt.set(request.entityId, now);
      }
    }

    const lastIdx = this.lastVariantByEvent.get(def.id);
    const variantIndex = pickVariantIndex(
      def.sounds.length,
      isRandom,
      lastIdx,
      this.rng,
    );
    this.lastVariantByEvent.set(def.id, variantIndex);
    const soundId = def.sounds[variantIndex] ?? def.sounds[0] ?? "synth:click";

    const pan =
      isWorld && !isGlobal ? screenStereoPan(request.screenX ?? 0) : 0;
    const lowPassHz =
      isWorld && !isGlobal
        ? distanceLowPassHz(dist, minDistance, maxDistance, def.lowPass ?? 0)
        : 18000;
    const playbackRate = samplePitchRate(def.pitchShift, this.rng);
    const delayMs = sampleDelayMs(def.delayMs, this.rng);

    const handle = this.nextHandle++;
    this.active.set(handle, {
      handle,
      eventId: def.id,
      pool,
      priority,
      entityId: request.entityId,
      isVoice,
      startedAtMs: now,
      effectiveVolume,
    });

    const decision: AdmissionDecision = {
      admitted: true,
      reason: "admitted",
      pool,
      bus,
      effectiveVolume,
      pan,
      lowPassHz,
      playbackRate,
      delayMs,
      variantIndex,
      soundId,
      killedHandles,
    };
    this.recordDebug(def.id, decision, now);
    return { decision, handle };
  }

  private reject(
    eventId: string,
    reason: AdmissionReason,
    pool: "world" | "ui",
    bus: AudioBusName,
    now: number,
    effectiveVolume = 0,
  ): { decision: AdmissionDecision; handle: null } {
    const decision: AdmissionDecision = {
      admitted: false,
      reason,
      pool,
      bus,
      effectiveVolume,
      pan: 0,
      lowPassHz: 18000,
      playbackRate: 1,
      delayMs: 0,
      variantIndex: 0,
      soundId: "",
      killedHandles: [],
    };
    this.recordDebug(eventId, decision, now);
    return { decision, handle: null };
  }

  private recordDebug(
    eventId: string,
    decision: AdmissionDecision,
    timestampMs: number,
  ): void {
    this.debugLog.unshift({
      timestampMs,
      eventId,
      zhRefName: this.catalog.reference.events[eventId],
      admitted: decision.admitted,
      reason: decision.reason,
      effectiveVolume: decision.effectiveVolume,
      pan: decision.pan,
      pool: decision.pool,
      soundId: decision.soundId,
    });
    if (this.debugLog.length > MAX_DEBUG_LOG) {
      this.debugLog.length = MAX_DEBUG_LOG;
    }
  }
}
