import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEntries,
  categoryOf,
  encodingRule,
  lookupToken,
  mergeRule,
  resolveZhEvent,
  targetTemplate,
  webmRel,
} from "./reference.mjs";

const zh = {
  files: {
    "ashot.wav": "files/ashot.wav",
    bshot: "files/bshot.wav",
    "theme.mp3": "files/theme.mp3",
  },
  events: {
    Shot: {
      sounds: ["ASHOT.WAV", "bshot"],
      attackSounds: ["missing.wav"],
      decaySounds: ["bshot"],
    },
    Silent: {},
  },
  dialogs: { Voice: { filename: "ashot.wav" } },
  music: { Theme: { filename: "theme.mp3" } },
  eva: { Alarm: { sideSounds: { usa: "ashot.wav", china: "missing.wav" } } },
};

test("lookupToken resolves case, path and extension", () => {
  assert.equal(lookupToken(zh.files, "ASHOT.WAV"), "files/ashot.wav");
  assert.equal(lookupToken(zh.files, "Data\\Audio\\BShot.wav"), "files/bshot.wav");
  assert.equal(lookupToken(zh.files, "bshot"), "files/bshot.wav");
  assert.equal(lookupToken(zh.files, "nope.wav"), null);
});

test("resolveZhEvent follows the loader order: sounds, dialog, music, eva, direct", () => {
  assert.deepEqual(resolveZhEvent(zh, "Shot"), {
    sounds: ["files/ashot.wav", "files/bshot.wav"],
    attack: [],
    decay: ["files/bshot.wav"],
    silence: false,
  });
  assert.deepEqual(resolveZhEvent(zh, "Voice").sounds, ["files/ashot.wav"]);
  assert.deepEqual(resolveZhEvent(zh, "Theme").sounds, ["files/theme.mp3"]);
  assert.deepEqual(resolveZhEvent(zh, "Alarm").sounds, ["files/ashot.wav"]);
  assert.deepEqual(resolveZhEvent(zh, "ashot.wav").sounds, ["files/ashot.wav"]);
  assert.deepEqual(resolveZhEvent(zh, "NoSound"), {
    sounds: [],
    attack: [],
    decay: [],
    silence: true,
  });
});

test("buildEntries sorts by category and marks loops and silence", () => {
  const entries = buildEntries({
    reference: {
      "music.menu": "Theme",
      "weapon.x.fire": "Shot",
      "ambient.none": "NoSound",
      "voice.x.select": "Voice",
    },
    zh,
  });
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["weapon.x.fire", "ambient.none", "music.menu", "voice.x.select"],
  );
  assert.equal(entries[0].loop, true);
  assert.deepEqual(entries[0].files, ["files/ashot.wav", "files/bshot.wav"]);
  assert.equal(entries[1].silence, true);
  assert.equal(entries[2].loop, false);
  assert.equal(entries[3].category, "voice");
});

test("categoryOf and webmRel", () => {
  assert.equal(categoryOf("voice.ua-rifleman.select"), "voice");
  assert.equal(categoryOf("something.else"), "other");
  assert.equal(webmRel("files/A.WAV"), "files/A.webm");
  assert.equal(webmRel("files/track.mp3"), "files/track.webm");
});

test("encodingRule follows spec 25 §12", () => {
  assert.deepEqual(encodingRule("voice", 2), { bitrate: 32_000, channels: 1 });
  assert.deepEqual(encodingRule("eva", 1), { bitrate: 32_000, channels: 1 });
  assert.deepEqual(encodingRule("weapon", 2), { bitrate: 64_000, channels: 1 });
  assert.deepEqual(encodingRule("music", 1), { bitrate: 96_000, channels: 2 });
  assert.deepEqual(encodingRule("ambient", 1), { bitrate: 64_000, channels: 1 });
  assert.deepEqual(encodingRule("ambient", 2), { bitrate: 96_000, channels: 2 });
});

test("mergeRule takes the widest bitrate and channel count", () => {
  assert.deepEqual(
    mergeRule([
      { bitrate: 32_000, channels: 1 },
      { bitrate: 64_000, channels: 1 },
      { bitrate: 96_000, channels: 2 },
    ]),
    { bitrate: 96_000, channels: 2 },
  );
});

test("targetTemplate points only at shipping WebM files", () => {
  assert.equal(
    targetTemplate("voice.ua-rifleman.select"),
    "audio/voice/ukraine/ua-rifleman/select_<n>.webm",
  );
  assert.equal(
    targetTemplate("voice.building.die"),
    "audio/voice/common/building/die_<n>.webm",
  );
  assert.equal(
    targetTemplate("eva.russia.lowPower"),
    "audio/eva/russia/lowPower_<n>.webm",
  );
  assert.equal(targetTemplate("weapon.ua-rifle.fire"), "audio/sfx/weapon.ua-rifle.fire_<n>.webm");
  assert.equal(targetTemplate("music.calm.ukraine"), "audio/music/calm.ukraine_<n>.webm");
  assert.equal(targetTemplate("ambient.snow"), "audio/ambient/snow_<n>.webm");
  assert.equal(targetTemplate("ui.click"), "audio/ui/click_<n>.webm");
});
