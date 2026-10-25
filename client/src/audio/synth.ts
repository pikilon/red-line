// Procedural fallback audio synthesis and WAV exporter (specs/25-audio.md §7).
// Renders `SynthRecipeDef` either into a Web Audio `AudioBuffer` or into a 16-bit PCM `.wav`
// byte buffer so the `?audio=debug` overlay can export placeholder takes for comparison.

import type { SynthRecipeDef } from "./types";

const SAMPLE_RATE = 22050;

/**
 * Synthesizes a recipe into a mono Float32Array at `sampleRate` Hz.
 * Pure and deterministic (seeded LCG for noise), so it runs identically in Node tests and browsers.
 */
export function synthesizePcm(
  recipe: SynthRecipeDef,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const totalSamples = Math.max(
    64,
    Math.floor((recipe.durationMs / 1000) * sampleRate),
  );
  const out = new Float32Array(totalSamples);
  const attackSamples = Math.max(
    1,
    Math.floor((recipe.attackMs / 1000) * sampleRate),
  );
  const decaySamples = Math.max(
    1,
    Math.floor((recipe.decayMs / 1000) * sampleRate),
  );

  // Simple 1-pole filter coefficient from `filterHz`
  const rc = 1 / (2 * Math.PI * Math.max(40, recipe.filterHz));
  const dt = 1 / sampleRate;
  const alphaLp = dt / (rc + dt);
  const alphaHp = rc / (rc + dt);

  let phase = 0;
  let lpState = 0;
  let hpState = 0;
  let prevRaw = 0;
  let seed = 0x13579bdf;

  const nextNoise = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / totalSamples;
    const freq =
      recipe.freqStartHz + (recipe.freqEndHz - recipe.freqStartHz) * t;
    phase += (2 * Math.PI * freq) / sampleRate;

    const tone =
      recipe.kind === "loop"
        ? Math.sin(phase) * 0.7 + Math.sin(phase * 2) * 0.3
        : Math.sin(phase);
    const noise = nextNoise();
    const raw = tone * (1 - recipe.noiseMix) + noise * recipe.noiseMix;

    lpState += alphaLp * (raw - lpState);
    hpState = alphaHp * (hpState + raw - prevRaw);
    prevRaw = raw;

    let filtered = lpState;
    if (recipe.filterType === "highpass") filtered = hpState;
    else if (recipe.filterType === "bandpass")
      filtered = (lpState + hpState) * 0.5;

    let env = 1;
    if (i < attackSamples) {
      env = i / attackSamples;
    } else if (recipe.kind !== "loop") {
      const decayPos = (i - attackSamples) / decaySamples;
      env = Math.max(0, Math.exp(-3 * decayPos));
    }

    out[i] = Math.max(-1, Math.min(1, filtered * env * recipe.gain));
  }
  return out;
}

/** Creates a Web Audio `AudioBuffer` from a `SynthRecipeDef`. */
export function createRecipeAudioBuffer(
  ctx: BaseAudioContext,
  recipe: SynthRecipeDef,
): AudioBuffer {
  const pcm = synthesizePcm(recipe, SAMPLE_RATE);
  const buffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
  buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  return buffer;
}

/** Encodes a mono Float32Array into a 16-bit PCM RIFF/WAV `Uint8Array` for debug download. */
export function encodeWavPcm16(
  samples: Float32Array,
  sampleRate = SAMPLE_RATE,
): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}
