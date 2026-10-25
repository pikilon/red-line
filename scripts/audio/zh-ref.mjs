// Extracts audio events and referenced sound assets from Zero Hour and Generals BIG archives.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENV_LOCAL = join(DEFAULT_ROOT, ".env.local");
const OUTPUT_DIR = join(DEFAULT_ROOT, ".local", "audio-ref");

const ZERO_HOUR_ARCHIVE = "INIZH.big";
const GENERALS_ARCHIVE = "INI.big";

const INI_ORDER = [
  "Data\\INI\\Default\\SoundEffects.ini",
  "Data\\INI\\Default\\Speech.ini",
  "Data\\INI\\Default\\Music.ini",
  "Data\\INI\\Voice.ini",
  "Data\\INI\\SoundEffects.ini",
  "Data\\INI\\Speech.ini",
  "Data\\INI\\Music.ini",
  "Data\\INI\\MiscAudio.ini",
  "Data\\INI\\Eva.ini",
  "Data\\INI\\AudioSettings.ini",
];

const normalizeIniPath = (p) => p.replaceAll("/", "\\").toLowerCase();

/**
 * Builds a BIGF archive buffer in memory.
 * @param {Array<{ name: string, data: Buffer | Uint8Array | string }> | Record<string, Buffer | string>} entries
 * @returns {Buffer}
 */
export function buildSyntheticBig(entries) {
  const list = Array.isArray(entries)
    ? entries
    : Object.entries(entries).map(([name, data]) => ({ name, data }));

  const names = list.map((e) => Buffer.from(`${e.name}\0`, "latin1"));
  const bodies = list.map((e) => (Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "", "latin1")));

  const headerSize = 16 + names.reduce((sum, name) => sum + 8 + name.length, 0);
  const records = [];
  let offset = headerSize;

  for (const [index, name] of names.entries()) {
    const record = Buffer.alloc(8);
    record.writeUInt32BE(offset, 0);
    record.writeUInt32BE(bodies[index].length, 4);
    records.push(record, name);
    offset += bodies[index].length;
  }

  const header = Buffer.alloc(16);
  header.write("BIGF", 0, "latin1");
  header.writeUInt32LE(offset, 4);
  header.writeUInt32BE(names.length, 8);
  header.writeUInt32BE(headerSize, 12);

  return Buffer.concat([header, ...records, ...bodies]);
}

/**
 * Reads entry names, offsets and sizes from a BIGF archive buffer.
 * @param {Buffer} buf
 * @returns {Array<{ offset: number, size: number, name: string }>}
 */
export function readBigDirectoryFromBuffer(buf) {
  if (buf.toString("latin1", 0, 4) !== "BIGF") {
    throw new Error("Not a BIGF archive");
  }
  const count = buf.readUInt32BE(8);
  const entries = [];
  let at = 16;
  for (let index = 0; index < count; index += 1) {
    const end = buf.indexOf(0, at + 8);
    entries.push({
      offset: buf.readUInt32BE(at),
      size: buf.readUInt32BE(at + 4),
      name: buf.toString("latin1", at + 8, end),
    });
    at = end + 1;
  }
  return entries;
}

/**
 * Reads entry names, offsets and sizes from a BIG archive file on disk.
 * @param {string} path
 * @returns {Promise<Array<{ offset: number, size: number, name: string }>>}
 */
export async function readBigDirectory(path) {
  const handle = await open(path, "r");
  try {
    const fixed = Buffer.alloc(16);
    await handle.read(fixed, 0, 16, 0);
    if (fixed.toString("latin1", 0, 4) !== "BIGF") throw new Error(`${path} is not a BIGF archive`);
    const count = fixed.readUInt32BE(8);
    const header = Buffer.alloc(fixed.readUInt32BE(12));
    await handle.read(header, 0, header.length, 0);
    const entries = [];
    let at = 16;
    for (let index = 0; index < count; index += 1) {
      const end = header.indexOf(0, at + 8);
      entries.push({
        offset: header.readUInt32BE(at),
        size: header.readUInt32BE(at + 4),
        name: header.toString("latin1", at + 8, end),
      });
      at = end + 1;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/**
 * Parses INI blocks (AudioEvent, DialogEvent, MusicTrack, EvaEvent, AudioSettings)
 * with DefaultSoundEffect inheritance and Zero Hour definitions overriding Generals.
 * @param {Array<{ name: string, text: string }> | Record<string, string> | string} input
 */
export function parseZhAudioInis(input) {
  let entries = [];
  if (Array.isArray(input)) {
    entries = input.map((item, idx) => {
      if (typeof item === "string") return { name: `input_${idx}.ini`, text: item };
      return { name: item.name || item.path || `input_${idx}.ini`, text: item.text || item.content || "" };
    });
  } else if (typeof input === "object" && input !== null) {
    entries = Object.entries(input).map(([name, text]) => ({ name, text }));
  } else if (typeof input === "string") {
    entries = [{ name: "input.ini", text: input }];
  }

  // Ensure Default/ INIs are parsed first so DefaultSoundEffect is available
  entries.sort((a, b) => {
    const aDef = /default/i.test(a.name) ? 0 : 1;
    const bDef = /default/i.test(b.name) ? 0 : 1;
    return aDef - bDef;
  });

  const events = {};
  const dialogs = {};
  const music = {};
  const eva = {};
  const settings = {};
  const miscAudio = {};

  let defaultSoundEffect = {};
  let defaultDialog = { volume: 100 };
  let defaultMusicTrack = { volume: 100 };

  for (const { name: _fileName, text } of entries) {
    const lines = text.split(/\r?\n/);
    let curBlockType = null;
    let curBlockName = null;
    let curBlockData = null;
    let curSubBlockType = null;
    let curSubBlockData = null;

    for (const rawLine of lines) {
      const line = rawLine.replace(/;.*|\/\/.*$/, "").trim();
      if (!line) continue;

      if (/^End\b/i.test(line)) {
        if (curSubBlockType) {
          if (curSubBlockType === "sidesounds" && curBlockType === "evaevent") {
            const side = (curSubBlockData.side ?? "").toLowerCase();
            const sounds = curSubBlockData.sounds;
            if (sounds) {
              let factionKey = null;
              if (side === "usa" || side === "america" || side === "us" || side.startsWith("america")) {
                factionKey = "usa";
              } else if (side === "china" || side.startsWith("china") || side === "boss") {
                factionKey = "china";
              } else if (side === "gla" || side.startsWith("gla")) {
                factionKey = "gla";
              }
              if (factionKey) {
                if (
                  !curBlockData.sideSounds[factionKey] ||
                  side === "usa" ||
                  side === "america" ||
                  side === "china" ||
                  side === "gla"
                ) {
                  curBlockData.sideSounds[factionKey] = sounds;
                }
              }
            }
          }
          curSubBlockType = null;
          curSubBlockData = null;
          continue;
        }

        if (curBlockType === "audioevent") {
          if (curBlockName.toLowerCase() === "defaultsoundeffect") {
            defaultSoundEffect = { ...defaultSoundEffect, ...curBlockData };
            events[curBlockName] = { ...defaultSoundEffect };
          } else {
            events[curBlockName] = { ...defaultSoundEffect, ...curBlockData };
          }
        } else if (curBlockType === "dialogevent") {
          if (curBlockName.toLowerCase() === "defaultdialog") {
            defaultDialog = { ...defaultDialog, ...curBlockData };
          }
          dialogs[curBlockName] = { ...defaultDialog, ...curBlockData };
        } else if (curBlockType === "musictrack") {
          if (curBlockName.toLowerCase() === "defaultmusictrack") {
            defaultMusicTrack = { ...defaultMusicTrack, ...curBlockData };
          }
          music[curBlockName] = { ...defaultMusicTrack, ...curBlockData };
        } else if (curBlockType === "evaevent") {
          eva[curBlockName] = curBlockData;
        } else if (curBlockType === "audiosettings") {
          Object.assign(settings, curBlockData);
        } else if (curBlockType === "miscaudio") {
          Object.assign(miscAudio, curBlockData);
        }

        curBlockType = null;
        curBlockName = null;
        curBlockData = null;
        continue;
      }

      if (!curBlockType) {
        const audioEventMatch = line.match(/^AudioEvent\s+(\w+)/i);
        if (audioEventMatch) {
          curBlockType = "audioevent";
          curBlockName = audioEventMatch[1];
          curBlockData = {};
          continue;
        }
        const dialogEventMatch = line.match(/^DialogEvent\s+(\w+)/i);
        if (dialogEventMatch) {
          curBlockType = "dialogevent";
          curBlockName = dialogEventMatch[1];
          curBlockData = {};
          continue;
        }
        const musicTrackMatch = line.match(/^MusicTrack\s+(\w+)/i);
        if (musicTrackMatch) {
          curBlockType = "musictrack";
          curBlockName = musicTrackMatch[1];
          curBlockData = {};
          continue;
        }
        const evaEventMatch = line.match(/^EvaEvent\s+(\w+)/i);
        if (evaEventMatch) {
          curBlockType = "evaevent";
          curBlockName = evaEventMatch[1];
          curBlockData = {
            priority: 1,
            timeBetweenChecksMS: 0,
            expirationTimeMS: 0,
            sideSounds: { usa: "", china: "", gla: "" },
          };
          continue;
        }
        if (/^AudioSettings\b/i.test(line)) {
          curBlockType = "audiosettings";
          curBlockName = "AudioSettings";
          curBlockData = {};
          continue;
        }
        if (/^MiscAudio\b/i.test(line)) {
          curBlockType = "miscaudio";
          curBlockName = "MiscAudio";
          curBlockData = {};
          continue;
        }
        continue;
      }

      if (curBlockType === "evaevent" && !curSubBlockType) {
        if (/^SideSounds\b/i.test(line)) {
          curSubBlockType = "sidesounds";
          curSubBlockData = {};
          continue;
        }
      }

      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();
      const keyLower = key.toLowerCase();

      if (curSubBlockType === "sidesounds") {
        if (keyLower === "side") {
          curSubBlockData.side = val;
        } else if (keyLower === "sounds") {
          curSubBlockData.sounds = val;
        }
        continue;
      }

      if (curBlockType === "audioevent") {
        if (keyLower === "sounds") {
          curBlockData.sounds = val.split(/\s+/).filter(Boolean);
        } else if (keyLower === "attack" || keyLower === "attacksounds") {
          curBlockData.attackSounds = val.split(/\s+/).filter(Boolean);
        } else if (keyLower === "decay" || keyLower === "decaysounds") {
          curBlockData.decaySounds = val.split(/\s+/).filter(Boolean);
        } else if (keyLower === "volume") {
          curBlockData.volume = Number(val);
        } else if (keyLower === "volumeshift") {
          curBlockData.volumeShift = Number(val);
        } else if (keyLower === "minvolume") {
          curBlockData.minVolume = Number(val);
        } else if (keyLower === "pitchshift") {
          const parts = val.split(/\s+/).filter(Boolean).map(Number);
          curBlockData.pitchShift = parts.length === 1 ? [parts[0], parts[0]] : parts.slice(0, 2);
        } else if (keyLower === "delay") {
          const parts = val.split(/\s+/).filter(Boolean).map(Number);
          curBlockData.delay = parts.length === 1 ? [0, parts[0]] : parts.slice(0, 2);
        } else if (keyLower === "limit") {
          curBlockData.limit = Number(val);
        } else if (keyLower === "loopcount") {
          curBlockData.loopCount = Number(val);
        } else if (keyLower === "priority") {
          curBlockData.priority = val.toLowerCase();
        } else if (keyLower === "type") {
          curBlockData.type = val.toLowerCase().split(/\s+/).filter(Boolean);
        } else if (keyLower === "control") {
          curBlockData.control = val.toLowerCase().split(/\s+/).filter(Boolean);
        } else if (keyLower === "minrange") {
          curBlockData.minRange = Number(val);
        } else if (keyLower === "maxrange") {
          curBlockData.maxRange = Number(val);
        } else if (keyLower === "lowpasscutoff" || keyLower === "lowpassfreq") {
          curBlockData.lowPassFreq = Number(val);
        }
      } else if (curBlockType === "dialogevent") {
        if (keyLower === "filename") {
          curBlockData.filename = val;
        } else if (keyLower === "volume") {
          curBlockData.volume = Number(val);
        }
      } else if (curBlockType === "musictrack") {
        if (keyLower === "filename") {
          curBlockData.filename = val;
        } else if (keyLower === "volume") {
          curBlockData.volume = Number(val);
        }
      } else if (curBlockType === "evaevent") {
        if (keyLower === "priority") {
          curBlockData.priority = Number(val);
        } else if (keyLower === "timebetweenchecksms") {
          curBlockData.timeBetweenChecksMS = Number(val);
        } else if (keyLower === "expirationtimems") {
          curBlockData.expirationTimeMS = Number(val);
        }
      } else if (curBlockType === "audiosettings" || curBlockType === "miscaudio") {
        const num = Number(val);
        curBlockData[key] = isNaN(num) ? val : num;
      }
    }
  }

  return { events, dialogs, music, eva, settings, miscAudio };
}

/**
 * Resolves the Zero Hour folder from argument, env, or .env.local, updating .env.local if passed.
 * @param {string | undefined} argZh
 * @returns {string}
 */
export function resolveZhDir(argZh) {
  if (argZh) {
    const abs = resolve(argZh);
    let envContent = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, "utf8") : "";
    if (/^ZH_DIR=.*$/m.test(envContent)) {
      envContent = envContent.replace(/^ZH_DIR=.*$/m, `ZH_DIR="${abs}"`);
    } else {
      envContent = `${envContent.trimEnd()}\nZH_DIR="${abs}"\n`;
    }
    writeFileSync(ENV_LOCAL, envContent);
    return abs;
  }

  if (process.env.ZH_DIR) {
    return resolve(process.env.ZH_DIR);
  }

  if (existsSync(ENV_LOCAL)) {
    const envContent = readFileSync(ENV_LOCAL, "utf8");
    const match = envContent.match(/^ZH_DIR=\s*["']?([^"'\r\n]+)["']?/m);
    if (match && match[1]) {
      return resolve(match[1]);
    }
  }

  throw new Error("Zero Hour directory not found. Pass --zh <dir> or set ZH_DIR in .env.local");
}

/**
 * Locates the Zero Hour folder and the sibling Command and Conquer Generals folder.
 * @param {string} inputDir
 * @returns {{ zhDir: string, genDir: string | null }}
 */
export function locateGameFolders(inputDir) {
  if (existsSync(join(inputDir, ZERO_HOUR_ARCHIVE))) {
    const parent = dirname(inputDir);
    const siblings = readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(parent, d.name));
    const genDir = siblings.find(
      (d) => d !== inputDir && existsSync(join(d, GENERALS_ARCHIVE)) && !existsSync(join(d, ZERO_HOUR_ARCHIVE)),
    );
    return { zhDir: inputDir, genDir: genDir ?? null };
  }

  if (existsSync(inputDir)) {
    const subs = readdirSync(inputDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(inputDir, d.name));
    const zhDir = subs.find((d) => existsSync(join(d, ZERO_HOUR_ARCHIVE)));
    const genDir = subs.find(
      (d) => existsSync(join(d, GENERALS_ARCHIVE)) && !existsSync(join(d, ZERO_HOUR_ARCHIVE)),
    );
    if (zhDir) {
      return { zhDir, genDir: genDir ?? null };
    }
  }

  throw new Error(`Could not find ${ZERO_HOUR_ARCHIVE} in ${inputDir} or its subdirectories.`);
}

/**
 * Discovers all .big files in folder, ordered by priority (INI first, then audio, then remainder).
 * @param {string} dir
 * @returns {string[]}
 */
function discoverBigFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".big"))
    .map((f) => join(dir, f));

  const priorityScore = (p) => {
    const name = basename(p).toLowerCase();
    if (name.includes("ini")) return 0;
    if (name.includes("audio")) return 1;
    if (name.includes("speech")) return 2;
    if (name.includes("music")) return 3;
    return 10;
  };

  return files.sort((a, b) => priorityScore(a) - priorityScore(b));
}

/**
 * Reads specified INI entry text from a .big archive.
 */
async function readBigEntryText(archivePath, entries, iniPath) {
  const norm = normalizeIniPath(iniPath);
  const entry = entries.find((e) => normalizeIniPath(e.name) === norm);
  if (!entry) return null;

  const handle = await open(archivePath, "r");
  try {
    const buf = Buffer.alloc(entry.size);
    await handle.read(buf, 0, entry.size, entry.offset);
    return buf.toString("latin1");
  } finally {
    await handle.close();
  }
}

/**
 * Extracts all Zero Hour audio references and audio files into .local/audio-ref/
 * @param {{ zhDir?: string, outputDir?: string }} options
 */
export async function extractZhAudioReference(options = {}) {
  const zhDirParam = resolveZhDir(options.zhDir);
  const { zhDir, genDir } = locateGameFolders(zhDirParam);
  const outDir = options.outputDir ?? OUTPUT_DIR;
  const outFilesDir = join(outDir, "files");

  console.log(`Extracting Zero Hour audio reference:`);
  console.log(`  Zero Hour folder: ${zhDir}`);
  console.log(`  Generals folder:  ${genDir ?? "none"}`);
  console.log(`  Output folder:    ${outDir}`);

  // 1. Parse INIs
  const iniTexts = [];

  // Generals base INIs first (if available)
  if (genDir) {
    const genIniArchive = join(genDir, GENERALS_ARCHIVE);
    if (existsSync(genIniArchive)) {
      const genEntries = await readBigDirectory(genIniArchive);
      for (const iniPath of INI_ORDER) {
        const text = await readBigEntryText(genIniArchive, genEntries, iniPath);
        if (text) iniTexts.push({ name: `gen:${iniPath}`, text });
      }
    }
  }

  // Zero Hour INIs second (overriding Generals base)
  const zhIniArchive = join(zhDir, ZERO_HOUR_ARCHIVE);
  if (existsSync(zhIniArchive)) {
    const zhEntries = await readBigDirectory(zhIniArchive);
    for (const iniPath of INI_ORDER) {
      const text = await readBigEntryText(zhIniArchive, zhEntries, iniPath);
      if (text) iniTexts.push({ name: `zh:${iniPath}`, text });
    }
  }

  const parsed = parseZhAudioInis(iniTexts);
  const { events, dialogs, music, eva } = parsed;

  console.log(`  Parsed INIs:`);
  console.log(`    AudioEvents:  ${Object.keys(events).length}`);
  console.log(`    DialogEvents: ${Object.keys(dialogs).length}`);
  console.log(`    MusicTracks:  ${Object.keys(music).length}`);
  console.log(`    EvaEvents:    ${Object.keys(eva).length}`);

  // 2. Discover all audio .big archives (Zero Hour archives first, then Generals archives)
  const zhBigs = discoverBigFiles(zhDir);
  const genBigs = genDir ? discoverBigFiles(genDir) : [];
  const allBigs = [...zhBigs, ...genBigs];

  // Index all .wav and .mp3 entries across archives
  // Map lowercase filename and lowercase stem -> { archivePath, entry }
  const audioIndex = new Map();

  for (const archivePath of allBigs) {
    try {
      const entries = await readBigDirectory(archivePath);
      for (const entry of entries) {
        if (/\.(wav|mp3)$/i.test(entry.name)) {
          const filename = entry.name.split(/[/\\]/).pop().toLowerCase();
          const stem = filename.replace(/\.[^.]+$/, "");
          if (!audioIndex.has(filename)) {
            audioIndex.set(filename, { archivePath, entry });
          }
          if (!audioIndex.has(stem)) {
            audioIndex.set(stem, { archivePath, entry });
          }
        }
      }
    } catch (_err) {
      // Ignore unreadable archives
    }
  }

  // 3. Collect all referenced sound names
  const referencedSounds = new Set();

  for (const event of Object.values(events)) {
    for (const s of event.sounds ?? []) referencedSounds.add(s.toLowerCase());
    for (const s of event.attackSounds ?? []) referencedSounds.add(s.toLowerCase());
    for (const s of event.decaySounds ?? []) referencedSounds.add(s.toLowerCase());
  }

  for (const dialog of Object.values(dialogs)) {
    if (dialog.filename && dialog.filename.toLowerCase() !== "nofilename") {
      referencedSounds.add(dialog.filename.toLowerCase());
    }
  }

  for (const track of Object.values(music)) {
    if (track.filename && track.filename.toLowerCase() !== "nofilename") {
      referencedSounds.add(track.filename.toLowerCase());
    }
  }

  for (const evaItem of Object.values(eva)) {
    for (const sideSound of Object.values(evaItem.sideSounds ?? {})) {
      if (sideSound) {
        referencedSounds.add(sideSound.toLowerCase());
        const d = dialogs[sideSound];
        if (d?.filename && d.filename.toLowerCase() !== "nofilename") {
          referencedSounds.add(d.filename.toLowerCase());
        }
      }
    }
  }

  // Match referenced sounds against audio index
  const filesToExtract = new Map(); // targetFilename -> { archivePath, entry }
  const filesMap = {};

  for (const ref of referencedSounds) {
    const item = audioIndex.get(ref);
    if (item) {
      const targetFilename = item.entry.name.split(/[/\\]/).pop().toLowerCase();
      const targetStem = targetFilename.replace(/\.[^.]+$/, "");
      filesToExtract.set(targetFilename, item);
      filesMap[targetFilename] = `files/${targetFilename}`;
      filesMap[targetStem] = `files/${targetFilename}`;
      filesMap[ref] = `files/${targetFilename}`;
    }
  }

  // 4. Extract matched audio files into .local/audio-ref/files/
  mkdirSync(outFilesDir, { recursive: true });

  const byArchive = new Map();
  for (const [targetFilename, item] of filesToExtract.entries()) {
    if (!byArchive.has(item.archivePath)) byArchive.set(item.archivePath, []);
    byArchive.get(item.archivePath).push({ targetFilename, entry: item.entry });
  }

  let extractedCount = 0;
  let totalBytes = 0;

  for (const [archivePath, items] of byArchive.entries()) {
    items.sort((a, b) => a.entry.offset - b.entry.offset);
    const handle = await open(archivePath, "r");
    try {
      for (const { targetFilename, entry } of items) {
        const destPath = join(outFilesDir, targetFilename);
        totalBytes += entry.size;
        if (existsSync(destPath) && statSync(destPath).size === entry.size) {
          extractedCount += 1;
          continue;
        }
        const buf = Buffer.alloc(entry.size);
        await handle.read(buf, 0, entry.size, entry.offset);
        writeFileSync(destPath, buf);
        extractedCount += 1;
      }
    } finally {
      await handle.close();
    }
  }

  // 5. Write zh-events.json
  const zhEventsJson = {
    events,
    dialogs,
    music,
    eva,
    files: filesMap,
  };

  writeFileSync(join(outDir, "zh-events.json"), JSON.stringify(zhEventsJson, null, 2) + "\n");

  console.log(`  Extracted ${extractedCount} audio files (${(totalBytes / 1024 / 1024).toFixed(1)} MB).`);
  console.log(`  Wrote ${join(outDir, "zh-events.json")}`);
  return { events, dialogs, music, eva, files: filesMap };
}

// CLI entrypoint
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const zhIdx = args.indexOf("--zh");
  const zhArg = zhIdx !== -1 ? args[zhIdx + 1] : undefined;

  extractZhAudioReference({ zhDir: zhArg })
    .then(() => {
      console.log("zh-ref: ok");
    })
    .catch((err) => {
      console.error(`zh-ref: ${err.message}`);
      process.exit(1);
    });
}
