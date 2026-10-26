// Local-only: asks the local Gemma model (LM Studio) for a written brief and a
// generation prompt for events that still have no description. The model is a
// vision model, not an audio model: it reads a spectrogram of the reference
// file plus the game context, and writes original text for our own sounds.
// Nothing from the reference audio is copied; the output is reviewed by ear
// before an entry becomes `approved`.
//
// Usage:
//   node scripts/audio/describe.mjs --only music,ambient --write
//   node scripts/audio/describe.mjs --only weapon,impact,explosion --limit 10
//
// Requires the LM Studio server and the local reference pack.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { parse, stringify } from "yaml";
import { buildEntries, loadReference } from "./reference.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const INVENTORY = join(ROOT, "data", "audio", "inventory.yaml");
const SPEC_DIR = join(ROOT, ".local", "audio-inventory", "specs");

const { values: flags } = parseArgs({
  options: {
    only: { type: "string", default: "music,ambient,weapon,impact,explosion,move,vehicle,building,ui" },
    limit: { type: "string" },
    model: { type: "string", default: "gemma-4-26b-a4b-it-mlx" },
    url: { type: "string", default: "http://127.0.0.1:1234/v1/chat/completions" },
    write: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!existsSync(INVENTORY)) {
  console.error("No data/audio/inventory.yaml: run `node scripts/audio/inventory.mjs --write` first.");
  process.exit(1);
}

const pack = loadReference(ROOT);
if (!pack) {
  console.error("No reference pack at .local/audio-ref: run `node --run audio:ref` first.");
  process.exit(1);
}

const inventoryText = await readFile(INVENTORY, "utf8");
const inventory = parse(inventoryText);
const header = inventoryText.slice(0, inventoryText.indexOf("version:")) || "";
const entries = inventory.entries ?? {};
const resolved = new Map(buildEntries(pack).map((entry) => [entry.id, entry]));
const categories = new Set(flags.only.split(",").map((value) => value.trim()));
const limit = flags.limit ? Number(flags.limit) : Number.POSITIVE_INFINITY;

const selected = Object.entries(entries).filter(([id, record]) => {
  if (!categories.has(record.category)) return false;
  if (record.status === "silent" || record.status === "needs-script") return false;
  if (!flags.force && record.brief) return false;
  const resolvedEntry = resolved.get(id);
  return resolvedEntry && resolvedEntry.files.length > 0;
});

const todo = selected.slice(0, limit);
console.log(
  `${todo.length} entries to describe (${selected.length} pending in ${[...categories].join(", ")}), model ${flags.model}`,
);
if (flags["dry-run"]) {
  for (const [id] of todo) console.log(`  ${id}`);
  process.exit(0);
}
if (todo.length === 0) process.exit(0);

const BANNED = /command\s*&\s*conquer|zero\s*hour|electronic\s*arts|\bea\b|c\s*&\s*c/i;

function roleOf(id, record) {
  const parts = id.split(".");
  switch (record.category) {
    case "weapon":
      return "one-shot weapon fire, positional in the world";
    case "impact":
      return "one-shot projectile impact, positional in the world";
    case "explosion":
      return "one-shot explosion, positional in the world";
    case "move":
      return "one-shot vehicle acceleration/engine sample, positional";
    case "vehicle":
      return "one-shot vehicle damage effect, positional";
    case "building":
      return "building construction, placement, completion or damage sound";
    case "ui":
      return "2D interface feedback, not positional";
    case "ambient":
      return "looping climate ambience bed";
    case "music": {
      const state = parts[1] === "calm" || parts[1] === "combat" ? parts[1] : parts[1];
      const faction = parts[2] === "ukraine" ? "Ukrainian" : parts[2] === "russia" ? "Russian" : "";
      return `${faction} ${state} music state${record.loop ? ", looped" : ", stinger"}`.trim();
    }
    default:
      return "game sound effect";
  }
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(err.slice(-300))),
    );
  });
}

async function spectrogram(id, file, seconds) {
  await mkdir(SPEC_DIR, { recursive: true });
  const out = join(SPEC_DIR, `${id.replace(/[^a-z0-9_-]/gi, "_")}.png`);
  const start = seconds > 40 ? Math.max(0, seconds * 0.25) : 0;
  const length = Math.min(seconds > 40 ? 30 : seconds, seconds);
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...(start > 0 ? ["-ss", start.toFixed(2)] : []),
    "-t",
    Math.max(0.2, length).toFixed(2),
    "-i",
    join(pack.refDir, file),
    "-lavfi",
    "showspectrumpic=s=900x450:legend=0:scale=log:color=intensity:mode=combined",
    "-frames:v",
    "1",
    out,
  ]);
  return out;
}

function promptFor(id, record) {
  return `You are writing audio briefs for "Modern Conquest: Red Line", an original free browser RTS. The attached image is a log-frequency spectrogram of an existing reference sound (time left to right, frequency bottom to top, energy as colour). Read its density, brightness, attack/decay shape and rhythmic pattern.

Context:
- Event id: ${id}
- Category: ${record.category}
- Reference event name (broad clue only, never repeat it): ${record.reference}
- Role in the game: ${roleOf(id, record)}
- Length: ${(record.seconds / Math.max(1, record.variants)).toFixed(2)} s per variant, ${record.variants} variant(s)${record.loop ? ", loops" : ""}

Write original sound design text for OUR OWN replacement asset. Return strict JSON with exactly these keys:
{"brief": "1-2 sentences: what the sound should be, in our own words", "prompt": "a compact prompt for a text-to-audio model: source, character, tempo if music, structure, production, duration", "tags": ["3 to 6 lowercase English tags"]}

Rules: never mention Command & Conquer, Zero Hour, EA, the reference, or any real weapon trademark; do not claim instruments the spectrogram cannot support (if unsure, describe energy and texture); no markdown, no code fence.`;
}

async function ask(model, url, id, record, imagePath) {
  const image = (await readFile(imagePath)).toString("base64");
  const body = {
    model,
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptFor(id, record) },
          { type: "image_url", image_url: { url: `data:image/png;base64,${image}` } },
        ],
      },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no JSON in reply: ${text.slice(0, 160)}`);
  const parsed = JSON.parse(match[0]);
  if (typeof parsed.brief !== "string" || typeof parsed.prompt !== "string") {
    throw new Error("JSON without brief/prompt");
  }
  const brief = parsed.brief.trim();
  const prompt = parsed.prompt.trim();
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map((tag) => String(tag).toLowerCase().trim()).filter(Boolean).slice(0, 8)
    : [];
  if (brief.length < 20 || prompt.length < 20) throw new Error("too short");
  if (BANNED.test(brief) || BANNED.test(prompt)) throw new Error("mentions the franchise");
  return { brief, prompt, tags };
}

let described = 0;
let failed = 0;
for (const [id, record] of todo) {
  const entry = resolved.get(id);
  const file = entry.files[0];
  let image;
  try {
    image = await spectrogram(id, file, record.seconds);
  } catch (err) {
    failed += 1;
    console.error(`\n${id}: spectrogram failed: ${err.message}`);
    continue;
  }

  let result;
  for (let attempt = 1; attempt <= 2 && !result; attempt += 1) {
    try {
      result = await ask(flags.model, flags.url, id, record, image);
    } catch (err) {
      if (attempt === 2) {
        failed += 1;
        console.error(`\n${id}: ${err.message}`);
      }
    }
  }
  if (!result) continue;

  entries[id] = {
    ...record,
    status: "draft",
    brief: result.brief,
    prompt: result.prompt,
    tags: result.tags,
  };
  described += 1;
  console.log(`${id}\n  ${result.brief}\n  -> ${result.prompt}`);
  if (flags.write) {
    await writeFile(
      INVENTORY,
      `${header}${stringify({ version: inventory.version ?? 1, entries }, { lineWidth: 0 })}`,
    );
  }
}

console.log(`\n${described} described, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
