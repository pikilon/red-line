// Local-only: encodes the Zero Hour reference files that the game actually
// uses as Opus in WebM (spec 25 §12), so the dev pack speaks the shipping
// format. Output goes to `.local/audio-ref-webm/` and is never committed,
// built or served in production (D-02: no EA audio ships).
//
// Usage:
//   node scripts/audio/pack.mjs [--force] [--only music,ambient]
//
// The manifest (`pack.json`) maps every output file to its source, category,
// bitrate, duration and the event ids that use it.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import {
  buildEntries,
  encodingRule,
  loadReference,
  mergeRule,
  webmRel,
} from "./reference.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const CONCURRENCY = 4;

const { values: flags } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
    only: { type: "string" },
    out: { type: "string" },
  },
});

const pack = loadReference(ROOT);
if (!pack) {
  console.error(
    "No reference pack at .local/audio-ref: run `node --run audio:ref` first (local only).",
  );
  process.exit(1);
}

const outDir = resolve(ROOT, flags.out ?? join(".local", "audio-ref-webm"));
const entries = buildEntries(pack);
const only = flags.only ? new Set(flags.only.split(",").map((s) => s.trim())) : null;

/** sourceRel -> { categories: Set, events: Set } */
const sources = new Map();
for (const entry of entries) {
  if (only && !only.has(entry.category)) continue;
  for (const file of entry.files) {
    let record = sources.get(file);
    if (!record) {
      record = { categories: new Set(), events: new Set() };
      sources.set(file, record);
    }
    record.categories.add(entry.category);
    record.events.add(entry.id);
  }
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(out);
      else reject(new Error(`${command} exited ${code}: ${err.slice(-400)}`));
    });
  });
}

async function probe(file) {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=channels,sample_rate:format=duration",
    "-of",
    "json",
    file,
  ]);
  const data = JSON.parse(out);
  return {
    channels: Number(data.streams?.[0]?.channels) || 1,
    sampleRate: Number(data.streams?.[0]?.sample_rate) || 0,
    duration: Number(data.format?.duration) || 0,
  };
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

const manifest = {};
let sourceBytes = 0;
let outputBytes = 0;
let encoded = 0;
let skipped = 0;
let failed = 0;
let done = 0;

const queue = [...sources.entries()];
const total = queue.length;

async function encodeOne([sourceRel, record]) {
  const sourceAbs = join(pack.refDir, sourceRel);
  const outputRel = webmRel(sourceRel);
  const outputAbs = join(outDir, outputRel);
  const sourceStat = await stat(sourceAbs);
  sourceBytes += sourceStat.size;

  let sourceInfo;
  try {
    sourceInfo = await probe(sourceAbs);
  } catch (err) {
    failed += 1;
    console.error(`\nskip ${sourceRel}: ${err.message}`);
    return;
  }

  const rules = [];
  for (const category of record.categories) {
    rules.push(encodingRule(category, sourceInfo.channels));
  }
  const rule = mergeRule(rules);

  const fresh =
    !flags.force &&
    existsSync(outputAbs) &&
    (await stat(outputAbs)).mtimeMs >= sourceStat.mtimeMs;

  if (!fresh) {
    await mkdir(join(outputAbs, ".."), { recursive: true });
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourceAbs,
      "-map_metadata",
      "-1",
      "-vn",
      "-ac",
      String(rule.channels),
      "-ar",
      "48000",
      "-c:a",
      "libopus",
      "-b:a",
      String(rule.bitrate),
      "-vbr",
      "on",
      "-compression_level",
      "10",
      outputAbs,
    ]);
    encoded += 1;
  } else {
    skipped += 1;
  }

  let outputInfo;
  try {
    outputInfo = await probe(outputAbs);
  } catch (err) {
    failed += 1;
    console.error(`\ninvalid webm ${outputRel}: ${err.message}`);
    return;
  }
  const outputStat = await stat(outputAbs);
  outputBytes += outputStat.size;
  manifest[outputRel] = {
    source: sourceRel,
    sourceBytes: sourceStat.size,
    bytes: outputStat.size,
    sha256: await sha256(outputAbs),
    bitrate: rule.bitrate,
    channels: outputInfo.channels,
    durationSec: Number(outputInfo.duration.toFixed(3)),
    categories: [...record.categories].sort(),
    events: [...record.events].sort(),
  };
}

async function worker() {
  while (queue.length > 0) {
    const item = queue.shift();
    try {
      await encodeOne(item);
    } catch (err) {
      failed += 1;
      console.error(`\nfailed ${item?.[0]}: ${err.message}`);
    }
    done += 1;
    if (done % 25 === 0 || done === total) {
      process.stdout.write(`\r${done}/${total} files`);
    }
  }
}

await mkdir(outDir, { recursive: true });
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

const report = {
  encoder: "ffmpeg libopus (VBR, 48 kHz)",
  generatedAt: new Date().toISOString(),
  sourceDir: ".local/audio-ref",
  outputDir: outDir.replace(`${ROOT}/`, ""),
  totals: {
    files: Object.keys(manifest).length,
    sourceMB: Number((sourceBytes / 1_048_576).toFixed(2)),
    outputMB: Number((outputBytes / 1_048_576).toFixed(2)),
    durationSec: Number(
      Object.values(manifest)
        .reduce((sum, item) => sum + item.durationSec, 0)
        .toFixed(1),
    ),
    encoded,
    skipped,
    failed,
  },
  files: Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  ),
};

await writeFile(join(outDir, "pack.json"), JSON.stringify(report, null, 2) + "\n");
console.log(
  `\nwebm pack: ${report.totals.files} files, ${report.totals.sourceMB} MB -> ${report.totals.outputMB} MB, ` +
    `${(report.totals.durationSec / 60).toFixed(1)} min (${encoded} encoded, ${skipped} skipped, ${failed} failed)`,
);
console.log(`manifest: ${join(outDir, "pack.json").replace(`${ROOT}/`, "")}`);
if (failed > 0) process.exitCode = 1;
