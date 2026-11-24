// Adapts the compiled `@data/audio.json` bundle into the runtime `AudioCatalog`
// structure. Everything here is data: adding a unit, weapon, event, EVA line or
// faction only touches data/audio/*.yaml and reference.yaml. This adapter is the
// place to expose a new *class* of data (a new bus, a new mix knob, a new
// per-faction EVA shape); see docs/audio-extension.md.

import rawAudio from "@data/audio.json";
import { ZOOM_MAX, ZOOM_MIN } from "../camera";
import { RULES } from "../rules";
import type {
  AudioCatalog,
  EvaEventDef,
  SynthRecipeDef,
  VoiceSetDef,
} from "./types";

function buildCatalog(): AudioCatalog {
  const refEvents: Record<string, string> = {
    ...(rawAudio.reference as Record<string, string>),
  };

  const evaEvents: Record<string, EvaEventDef> = {};
  for (const [id, raw] of Object.entries(rawAudio.eva)) {
    const r = raw as {
      priority: number;
      cooldownMs: number;
      expireMs: number;
      sounds?: string[] | Record<string, string>;
    };
    const defaultSound = Array.isArray(r.sounds)
      ? (r.sounds[0] ?? "synth:eva")
      : "synth:eva";
    const sounds: Record<string, string> =
      r.sounds && !Array.isArray(r.sounds)
        ? { ...r.sounds }
        : Object.fromEntries(
            RULES.factions.map((faction) => [
              faction.id,
              refEvents[`eva.${faction.id}.${id}`] ?? defaultSound,
            ]),
          );
    evaEvents[id] = {
      priority: r.priority,
      cooldownMs: r.cooldownMs,
      expireMs: r.expireMs,
      sounds,
    };
  }

  const mix = rawAudio.mix;
  const voiceDuck = mix.ducking.voice as {
    duckMusicDb: number;
    duckSfxDb?: number;
    holdMs: number;
    releaseMs: number;
  };
  return {
    events: rawAudio.events as unknown as AudioCatalog["events"],
    voices: {
      sets: rawAudio.voices as unknown as Record<string, VoiceSetDef>,
    },
    eva: { events: evaEvents },
    mix: {
      buses: {
        master: mix.buses.master.volume,
        sfx: mix.buses.sfx.volume,
        voice: mix.buses.voice.volume,
        eva: mix.buses.eva.volume,
        ui: mix.buses.ui.volume,
        ambient: mix.buses.ambient.volume,
        music: mix.buses.music.volume,
      },
      limits: {
        worldChannels: mix.limits.sampleCountWorld,
        uiChannels: mix.limits.sampleCountUi,
        streamChannels: mix.limits.streamCount,
        minSampleVolume: mix.limits.minSampleVolume / 100,
        relative2dVolume: mix.relative2d.volumePercent / 100,
        drawableRetryMs: mix.limits.timeBetweenDrawableSoundsMs,
        fadeMs: mix.limits.timeToFadeAudioMs,
      },
      zoom: {
        minZoom: ZOOM_MIN,
        maxZoom: ZOOM_MAX,
        bonus: mix.zoom.soundVolumeBonusPercent / 100,
      },
      ducking: {
        eva: {
          musicDb: mix.ducking.eva.duckMusicDb,
          sfxDb: mix.ducking.eva.duckSfxDb ?? 0,
          holdMs: mix.ducking.eva.holdMs,
          releaseMs: mix.ducking.eva.releaseMs,
        },
        voice: {
          musicDb: voiceDuck.duckMusicDb,
          sfxDb: voiceDuck.duckSfxDb ?? 0,
          holdMs: voiceDuck.holdMs,
          releaseMs: voiceDuck.releaseMs,
        },
      },
      underFire: {
        perUnitCooldownMs: mix.underFire.perUnitCooldownMs,
        globalCooldownMs: mix.underFire.globalVoiceBudgetMs,
      },
      music: {
        fadeMs: mix.music?.fadeMs ?? 2000,
        combatHoldMs: mix.music?.combatHoldMs ?? 12000,
      },
    },
    reference: { events: refEvents },
    recipes: rawAudio.recipes as unknown as Record<string, SynthRecipeDef>,
  };
}

export const AUDIO_CATALOG: AudioCatalog = buildCatalog();

/** The faction whose voices, EVA and music play for `factionId`: itself when
 *  the audio data covers it (it has calm music), else the first faction with
 *  audio, so a faction without recordings never goes silent or crashes. */
export function audioFactionOf(factionId: string): string {
  const events = rawAudio.events as Record<string, unknown>;
  if (`music.calm.${factionId}` in events) return factionId;
  const covered = RULES.factions.find(
    (faction) => `music.calm.${faction.id}` in events,
  );
  return covered?.id ?? factionId;
}
