// Unit tests for Zero Hour reference extractor synthetic operations.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildAudioData, checkAudio } from "../check-audio.mjs";
import { buildSyntheticBig, parseZhAudioInis, readBigDirectoryFromBuffer } from "./zh-ref.mjs";

test("buildSyntheticBig and readBigDirectoryFromBuffer round-trip synthetic entries in memory", () => {
  const binaryData = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]);
  const entries = [
    { name: "Data\\INI\\SoundEffects.ini", data: "AudioEvent Test\n  Volume = 50\nEnd\n" },
    { name: "Data\\Audio\\shot.wav", data: binaryData },
    { name: "Data\\Audio\\music.mp3", data: "mp3-stream-data" },
  ];

  const bigBuffer = buildSyntheticBig(entries);
  assert(Buffer.isBuffer(bigBuffer), "Output must be a Buffer");

  const readEntries = readBigDirectoryFromBuffer(bigBuffer);
  assert.equal(readEntries.length, 3);

  assert.equal(readEntries[0].name, "Data\\INI\\SoundEffects.ini");
  assert.equal(readEntries[0].size, Buffer.byteLength(entries[0].data, "latin1"));
  const textRead = bigBuffer.subarray(readEntries[0].offset, readEntries[0].offset + readEntries[0].size).toString("latin1");
  assert.equal(textRead, entries[0].data);

  assert.equal(readEntries[1].name, "Data\\Audio\\shot.wav");
  assert.equal(readEntries[1].size, binaryData.length);
  const binRead = bigBuffer.subarray(readEntries[1].offset, readEntries[1].offset + readEntries[1].size);
  assert.deepEqual(binRead, binaryData);

  assert.equal(readEntries[2].name, "Data\\Audio\\music.mp3");
  assert.equal(readEntries[2].size, Buffer.byteLength("mp3-stream-data", "latin1"));

  assert.throws(() => readBigDirectoryFromBuffer(Buffer.from("NOT_BIGF_DATA")), /Not a BIGF archive/);
});

test("parseZhAudioInis inherits DefaultSoundEffect defaults into AudioEvents", () => {
  const defaultIni = `
; Default sound effects configuration
AudioEvent DefaultSoundEffect
  Volume = 100
  Priority = high
  MinVolume = 40
  Control = random
  Limit = 4
  MinRange = 175.00
  MaxRange = 800.00
  PitchShift = -0 0
  Type = ui player
End
`;

  const sfxIni = `
// Weapon fire audio event
AudioEvent CrusaderTankWeapon
  Sounds = vcruweaa vcruweab vcruweac // audio variant stems
  Attack = vcruwea_start
  Decay = vcruwea_tail
  Volume = 90
  VolumeShift = -10
  PitchShift = -5 5
  Delay = 0 600
  Limit = 2
  LoopCount = 1
  Control = interrupt random
  LowPassCutoff = 50
End

AudioEvent MinimalEvent
  Sounds = beep
End
`;

  const { events } = parseZhAudioInis([
    { name: "Data\\INI\\Default\\SoundEffects.ini", text: defaultIni },
    { name: "Data\\INI\\SoundEffects.ini", text: sfxIni },
  ]);

  const tank = events["CrusaderTankWeapon"];
  assert.ok(tank, "CrusaderTankWeapon must be present");
  assert.deepEqual(tank.sounds, ["vcruweaa", "vcruweab", "vcruweac"]);
  assert.deepEqual(tank.attackSounds, ["vcruwea_start"]);
  assert.deepEqual(tank.decaySounds, ["vcruwea_tail"]);
  assert.equal(tank.volume, 90);
  assert.equal(tank.volumeShift, -10);
  assert.equal(tank.minVolume, 40); // Inherited from DefaultSoundEffect
  assert.deepEqual(tank.pitchShift, [-5, 5]);
  assert.deepEqual(tank.delay, [0, 600]);
  assert.equal(tank.limit, 2);
  assert.equal(tank.loopCount, 1);
  assert.equal(tank.priority, "high"); // Inherited
  assert.deepEqual(tank.type, ["ui", "player"]); // Inherited
  assert.deepEqual(tank.control, ["interrupt", "random"]);
  assert.equal(tank.minRange, 175); // Inherited
  assert.equal(tank.maxRange, 800); // Inherited
  assert.equal(tank.lowPassFreq, 50);

  const minimal = events["MinimalEvent"];
  assert.ok(minimal);
  assert.deepEqual(minimal.sounds, ["beep"]);
  assert.equal(minimal.volume, 100); // Inherited
  assert.equal(minimal.minVolume, 40); // Inherited
  assert.equal(minimal.priority, "high"); // Inherited
  assert.equal(minimal.limit, 4); // Inherited
});

test("parseZhAudioInis lets Zero Hour definitions override Generals base definitions", () => {
  const genIni = `
AudioEvent SharedTankGun
  Volume = 70
  Limit = 1
End
`;

  const zhIni = `
AudioEvent SharedTankGun
  Volume = 95
  Limit = 3
End
`;

  const { events } = parseZhAudioInis([
    { name: "gen:SoundEffects.ini", text: genIni },
    { name: "zh:SoundEffects.ini", text: zhIni },
  ]);

  assert.equal(events["SharedTankGun"].volume, 95);
  assert.equal(events["SharedTankGun"].limit, 3);
});

test("parseZhAudioInis parses DialogEvent and MusicTrack blocks", () => {
  const speechIni = `
DialogEvent EvaGLA_AllyUnderAttack
  Filename = egallyu.wav
  Volume = 90
End

DialogEvent DefaultDialog
  Volume = 100
End

DialogEvent EvaUSA_Sample
  Filename = euunitl.wav
End
`;

  const musicIni = `
MusicTrack Track1
  Filename = USA_09.mp3
  Volume = 85
End

MusicTrack Silence
  ; silence has no filename
End
`;

  const { dialogs, music } = parseZhAudioInis([
    { name: "Speech.ini", text: speechIni },
    { name: "Music.ini", text: musicIni },
  ]);

  assert.deepEqual(dialogs["EvaGLA_AllyUnderAttack"], { filename: "egallyu.wav", volume: 90 });
  assert.equal(dialogs["EvaUSA_Sample"].filename, "euunitl.wav");
  assert.equal(dialogs["EvaUSA_Sample"].volume, 100);

  assert.deepEqual(music["Track1"], { filename: "USA_09.mp3", volume: 85 });
  assert.equal(music["Silence"].volume, 100);
});

test("parseZhAudioInis parses EvaEvent blocks with side sounds mapping", () => {
  const evaIni = `
EvaEvent LowPower
  Priority = 2
  TimeBetweenChecksMS = 120000 ; 2 minutes
  ExpirationTimeMS = 5000 ; 5 seconds

  SideSounds
    Side = America
    Sounds = EvaUSA_LowPower
  End

  SideSounds
    Side = AmericaLaserGeneral
    Sounds = EvaUSA_Laser_LowPower
  End

  SideSounds
    Side = China
    Sounds = EvaChina_LowPower
  End

  SideSounds
    Side = GLA
    Sounds = EvaGLA_LowPower
  End
End

EvaEvent BaseUnderAttack
  Priority = 7
  TimeBetweenChecksMS = 30000
  ExpirationTimeMS = 5000

  SideSounds
    Side = USA
    Sounds = EvaUSA_BaseAttack
  End

  SideSounds
    Side = ChinaTankGeneral
    Sounds = EvaChina_BaseAttack
  End

  SideSounds
    Side = GLAStealthGeneral
    Sounds = EvaGLA_BaseAttack
  End
End
`;

  const { eva } = parseZhAudioInis(evaIni);

  assert.ok(eva["LowPower"]);
  assert.equal(eva["LowPower"].priority, 2);
  assert.equal(eva["LowPower"].timeBetweenChecksMS, 120000);
  assert.equal(eva["LowPower"].expirationTimeMS, 5000);
  assert.equal(eva["LowPower"].sideSounds.usa, "EvaUSA_LowPower");
  assert.equal(eva["LowPower"].sideSounds.china, "EvaChina_LowPower");
  assert.equal(eva["LowPower"].sideSounds.gla, "EvaGLA_LowPower");

  assert.ok(eva["BaseUnderAttack"]);
  assert.equal(eva["BaseUnderAttack"].priority, 7);
  assert.equal(eva["BaseUnderAttack"].timeBetweenChecksMS, 30000);
  assert.equal(eva["BaseUnderAttack"].sideSounds.usa, "EvaUSA_BaseAttack");
  assert.equal(eva["BaseUnderAttack"].sideSounds.china, "EvaChina_BaseAttack");
  assert.equal(eva["BaseUnderAttack"].sideSounds.gla, "EvaGLA_BaseAttack");
});

test("buildAudioData and checkAudio validate schemas, handle --write and guard client/dist", () => {
  const root = mkdtempSync(join(tmpdir(), "check-audio-"));
  const schemaDir = join(root, "data", "schema");
  const audioDir = join(root, "data", "audio");
  const synthDir = join(audioDir, "synth");
  const genDir = join(root, "data", "generated");
  mkdirSync(schemaDir, { recursive: true });
  mkdirSync(synthDir, { recursive: true });
  mkdirSync(genDir, { recursive: true });

  const originalSchema = join(dirname(fileURLToPath(import.meta.url)), "../../data/schema/audio.schema.json");
  writeFileSync(join(schemaDir, "audio.schema.json"), readFileSync(originalSchema, "utf8"));

  writeFileSync(
    join(audioDir, "events.yaml"),
    `events:\n  weapon.shot:\n    sounds: [synth:shot]\n    volume: 80\n`,
  );
  writeFileSync(
    join(audioDir, "voices.yaml"),
    `sets:\n  soldier:\n    select: { sounds: [synth:voice], volume: 90 }\n`,
  );
  writeFileSync(
    join(audioDir, "eva.yaml"),
    `events:\n  lowPower:\n    priority: 2\n    cooldownMs: 60000\n    expireMs: 5000\n`,
  );
  writeFileSync(join(audioDir, "mix.yaml"), `buses:\n  master: { volume: 100 }\nducking: {}\n`);
  writeFileSync(join(audioDir, "reference.yaml"), `weapon.shot: CrusaderTankWeapon\n`);
  writeFileSync(join(synthDir, "recipes.yaml"), `recipes:\n  shot: { kind: burst, gain: 0.8 }\n`);

  // buildAudioData compiles and returns valid object
  const built = buildAudioData(root);
  assert.equal(built.events["weapon.shot"].volume, 80);
  assert.equal(built.voices["soldier"].select.volume, 90);
  assert.equal(built.eva["lowPower"].priority, 2);
  assert.equal(built.reference["weapon.shot"], "CrusaderTankWeapon");

  // In check mode without generated file -> throws missing error
  assert.throws(() => checkAudio(root), /data\/generated\/audio\.json is missing/);

  // With write: true -> creates data/generated/audio.json
  const resWrite = checkAudio(root, { write: true });
  assert.equal(resWrite.ok, true);
  assert.equal(resWrite.written, true);

  // In check mode with matching generated file -> succeeds
  const resCheck = checkAudio(root);
  assert.equal(resCheck.ok, true);

  // Stale check
  writeFileSync(join(genDir, "audio.json"), '{\n  "stale": true\n}\n');
  assert.throws(() => checkAudio(root), /data\/generated\/audio\.json is stale/);

  // Restore matching file
  checkAudio(root, { write: true });

  // Guard client/dist
  const distDir = join(root, "client", "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, "main.js"), "const x = 1;");
  assert.equal(checkAudio(root).ok, true);

  // Leak .local/audio-ref in client/dist bundle
  writeFileSync(join(distDir, "main.js"), 'const x = "/.local/audio-ref/files/foo.wav";');
  assert.throws(() => checkAudio(root), /forbidden reference to \.local\/audio-ref/);
});
