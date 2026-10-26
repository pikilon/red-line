// Resolves the audio events of the game to the files in the local Zero Hour
// reference pack (spec 25 §4.2). Local-only tooling: the pack is never
// committed or built, and these helpers only produce names and paths.
//
// Shared by `pack.mjs` (encodes the used files as Opus/WebM) and
// `inventory.mjs` (writes `data/audio/inventory.yaml`).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const CATEGORY_ORDER = [
  "weapon",
  "impact",
  "explosion",
  "move",
  "vehicle",
  "building",
  "ui",
  "ambient",
  "music",
  "voice",
  "eva",
];

const CATEGORY_KIND = {
  weapon: "sfx",
  impact: "sfx",
  explosion: "sfx",
  move: "sfx",
  vehicle: "sfx",
  building: "sfx",
  ui: "ui",
  ambient: "ambient",
  music: "music",
  voice: "voice",
  eva: "eva",
};

export function categoryOf(eventId) {
  const prefix = String(eventId).split(".")[0];
  return CATEGORY_ORDER.includes(prefix) ? prefix : "other";
}

export function kindOf(category) {
  return CATEGORY_KIND[category] ?? "sfx";
}

/** Lower-case token (`Files\\Shot.WAV`) to a pack-relative path (`files/shot.wav`). */
export function lookupToken(files, token) {
  if (!token) return null;
  const lower = String(token).toLowerCase();
  const base = lower.replace(/^.*[\\/]/, "");
  const stem = base.replace(/\.(wav|mp3)$/i, "");
  return files[lower] ?? files[base] ?? files[stem] ?? null;
}

/** Resolves one Zero Hour event name into its one-shot, attack and decay files. */
export function resolveZhEvent(zh, name) {
  const files = zh.files ?? {};
  const empty = { sounds: [], attack: [], decay: [], silence: false };
  if (!name || name === "NoSound") return { ...empty, silence: name === "NoSound" };

  const tokens = (list) =>
    (list ?? [])
      .map((token) => lookupToken(files, token))
      .filter((value, index, all) => value && all.indexOf(value) === index);

  const event = zh.events?.[name];
  if (event?.sounds?.length) {
    return {
      sounds: tokens(event.sounds),
      attack: tokens(event.attackSounds),
      decay: tokens(event.decaySounds),
      silence: false,
    };
  }

  const dialog = zh.dialogs?.[name];
  if (dialog?.filename) {
    const file = lookupToken(files, dialog.filename);
    if (file) return { ...empty, sounds: [file] };
  }

  const music = zh.music?.[name];
  if (music?.filename) {
    const file = lookupToken(files, music.filename);
    if (file) return { ...empty, sounds: [file] };
  }

  const eva = zh.eva?.[name];
  if (eva?.sideSounds) {
    const sounds = tokens(Object.values(eva.sideSounds));
    if (sounds.length > 0) return { ...empty, sounds };
  }

  const direct = lookupToken(files, name);
  return direct ? { ...empty, sounds: [direct] } : empty;
}

/**
 * Loads the committed event -> Zero Hour name map and the local parsed index.
 * Returns null when the reference pack has not been extracted on this machine.
 */
export function loadReference(rootDir, { refDir = join(rootDir, ".local", "audio-ref") } = {}) {
  const referencePath = join(rootDir, "data", "audio", "reference.yaml");
  const indexPath = join(refDir, "zh-events.json");
  if (!existsSync(indexPath)) return null;
  const reference = parse(readFileSync(referencePath, "utf8")) ?? {};
  const zh = JSON.parse(readFileSync(indexPath, "utf8"));
  return { reference, zh, refDir };
}

/** One entry per reference event id, with every file it can play. */
export function buildEntries({ reference, zh }) {
  const entries = [];
  for (const [id, name] of Object.entries(reference)) {
    const resolved = resolveZhEvent(zh, name);
    const files = [
      ...new Set([...resolved.sounds, ...resolved.attack, ...resolved.decay]),
    ];
    entries.push({
      id,
      name,
      category: categoryOf(id),
      kind: kindOf(categoryOf(id)),
      files,
      silence: resolved.silence || files.length === 0,
      loop: resolved.attack.length > 0 || resolved.decay.length > 0,
    });
  }
  return entries.sort((a, b) => {
    const byCategory =
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    return byCategory !== 0 ? byCategory : a.id.localeCompare(b.id);
  });
}

/** `files/shot.wav` -> `files/shot.webm`; the local pack mirrors the source tree. */
export function webmRel(sourceRel) {
  return sourceRel.replace(/\.(wav|mp3)$/i, ".webm");
}

/**
 * Encoding rule per category (spec 25 §12): voices 32 kbps mono, SFX 64 kbps
 * mono, music 96 kbps stereo, ambient 96 kbps stereo or 64 kbps mono.
 */
export function encodingRule(category, sourceChannels) {
  if (category === "music" || category === "ambient") {
    const stereo = category === "music" || (sourceChannels ?? 2) >= 2;
    return { bitrate: stereo ? 96_000 : 64_000, channels: stereo ? 2 : 1 };
  }
  if (category === "voice" || category === "eva") {
    return { bitrate: 32_000, channels: 1 };
  }
  return { bitrate: 64_000, channels: 1 };
}

/** Merges the rules of every category that uses one file (the widest wins). */
export function mergeRule(rules) {
  let bitrate = 0;
  let channels = 1;
  for (const rule of rules) {
    bitrate = Math.max(bitrate, rule.bitrate);
    channels = Math.max(channels, rule.channels);
  }
  return { bitrate, channels };
}
