// Core types for the Zero Hour-modeled client audio engine (specs/25-audio.md).

export type AudioPriorityName =
  | "lowest"
  | "low"
  | "normal"
  | "high"
  | "critical";

export const AUDIO_PRIORITY_RANK: Record<AudioPriorityName, number> = {
  lowest: 0,
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
};

export type SoundTypeFlag =
  | "ui"
  | "world"
  | "shrouded"
  | "global"
  | "voice"
  | "player"
  | "allies"
  | "enemies"
  | "everyone";

export type AudioControlFlag =
  | "loop"
  | "random"
  | "all"
  | "postDelay"
  | "interrupt";

export type AudioBusName =
  | "master"
  | "sfx"
  | "voice"
  | "eva"
  | "ui"
  | "ambient"
  | "music";

export interface AudioEventDef {
  id: string;
  sounds: string[];
  attackSounds?: string[];
  decaySounds?: string[];
  volume?: number; // 0..150, default 100
  volumeShift?: number; // -100..0, default 0
  minVolume?: number; // 0..150, default 0
  pitchShift?: [number, number]; // [min%, max%], default [0, 0]
  delayMs?: [number, number]; // [minMs, maxMs], default [0, 0]
  limit?: number; // max simultaneous instances, default 4
  loopCount?: number; // 0 = infinite when control includes 'loop'
  priority?: AudioPriorityName; // default 'normal'
  type?: SoundTypeFlag[]; // default ['ui', 'player']
  control?: AudioControlFlag[]; // default ['random']
  minDistance?: number; // tiles, default 4
  maxDistance?: number; // tiles, default 24
  lowPass?: number; // 0..100, default 0
}

export type VoiceAction =
  | "select"
  | "move"
  | "attack"
  | "underFire"
  | "die"
  | "created";

export type VoiceSetDef = Partial<
  Record<VoiceAction, Omit<AudioEventDef, "id">>
>;

export interface EvaEventDef {
  priority: number; // 1..10 (0 never plays)
  cooldownMs: number;
  expireMs: number;
  sounds: Record<string, string>; // factionId -> sound/event ref
}

export interface DuckRule {
  musicDb: number;
  sfxDb: number;
  holdMs: number;
  releaseMs: number;
}

export interface AudioMixConfig {
  buses: Record<AudioBusName, number>;
  limits: {
    worldChannels: number;
    uiChannels: number;
    streamChannels: number;
    minSampleVolume: number;
    relative2dVolume: number;
    drawableRetryMs: number;
    fadeMs: number;
  };
  zoom: {
    minZoom: number;
    maxZoom: number;
    bonus: number;
  };
  ducking: {
    eva: DuckRule;
    voice: DuckRule;
  };
  underFire: {
    perUnitCooldownMs: number;
    globalCooldownMs: number;
  };
}

export interface SynthRecipeDef {
  kind: "tone" | "noise" | "burst" | "loop";
  durationMs: number;
  freqStartHz: number;
  freqEndHz: number;
  filterType: "lowpass" | "bandpass" | "highpass";
  filterHz: number;
  noiseMix: number;
  attackMs: number;
  decayMs: number;
  gain: number;
}

export interface AudioCatalog {
  events: Record<string, Omit<AudioEventDef, "id">>;
  voices: { sets: Record<string, VoiceSetDef> };
  eva: { events: Record<string, EvaEventDef> };
  mix: AudioMixConfig;
  reference: { events: Record<string, string> };
  recipes: Record<string, SynthRecipeDef>;
}

export type PlayerRelation = "self" | "ally" | "enemy" | "neutral";

export interface AudioPlayRequest {
  eventId: string;
  entityId?: number;
  ownerPlayer?: number;
  relation?: PlayerRelation;
  /** World tile coordinates for 3D positional sounds. */
  tileX?: number;
  tileY?: number;
  /** Screen X normalized in [-1, 1] (-1 left edge, +1 right edge; outside [-1,1] when off-screen). */
  screenX?: number;
  /** True when the sound position is currently within the camera viewport. */
  onScreen?: boolean;
  /** True when the tile is currently in clear vision (not shrouded/fogged). */
  tileVisible?: boolean;
  /** True when this is an infantry death scream (requires on-screen check). */
  infantryScream?: boolean;
  /** True when this is an underFire voice event (throttled by per-unit and global budget). */
  isUnderFire?: boolean;
}

export type AdmissionReason =
  | "admitted"
  | "unknown_event"
  | "culled_audience"
  | "culled_distance"
  | "culled_shroud"
  | "culled_offscreen"
  | "culled_min_volume"
  | "culled_voice_rule"
  | "culled_under_fire_cooldown"
  | "culled_under_fire_budget"
  | "culled_limit"
  | "culled_pool_full";

export interface ActiveChannel {
  handle: number;
  eventId: string;
  pool: "world" | "ui";
  priority: AudioPriorityName;
  entityId?: number;
  isVoice: boolean;
  startedAtMs: number;
  effectiveVolume: number;
}

export interface AdmissionDecision {
  admitted: boolean;
  reason: AdmissionReason;
  pool: "world" | "ui";
  bus: AudioBusName;
  effectiveVolume: number;
  pan: number;
  lowPassHz: number;
  playbackRate: number;
  delayMs: number;
  variantIndex: number;
  soundId: string;
  killedHandles: number[];
}

export interface AudioDebugEntry {
  timestampMs: number;
  eventId: string;
  zhRefName?: string;
  admitted: boolean;
  reason: AdmissionReason;
  effectiveVolume: number;
  pan: number;
  pool: "world" | "ui";
  soundId: string;
}
