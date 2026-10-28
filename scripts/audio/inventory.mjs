// Local-only: writes `data/audio/inventory.yaml` (spec 25 §5.1, phase 2),
// one entry per game sound event: the WebM file we will ship, how many
// variants it needs and the brief/prompt that will produce it. The committed
// file never points at a source recording.
//
// Descriptions are generated in our own words by `describe.mjs`; this script
// only builds the metadata and preserves any description already written.
//
// Usage:
//   node scripts/audio/inventory.mjs [--write]

import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse, stringify } from "yaml";
import { buildEntries, loadReference, targetTemplate } from "./reference.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const INVENTORY = join(ROOT, "data", "audio", "inventory.yaml");
const PACK_MANIFEST = join(ROOT, ".local", "audio-ref-webm", "pack.json");

const { values: flags } = parseArgs({
  options: {
    write: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
  },
});

const pack = loadReference(ROOT);
if (!pack) {
  console.error(
    "No reference pack at .local/audio-ref: run `node --run audio:ref` first (local only).",
  );
  process.exit(1);
}

const encodedBySource = new Map();
if (existsSync(PACK_MANIFEST)) {
  const manifest = JSON.parse(await readFile(PACK_MANIFEST, "utf8"));
  for (const item of Object.values(manifest.files ?? {})) {
    encodedBySource.set(item.source, item);
  }
}

let previous = null;
if (existsSync(INVENTORY)) {
  try {
    previous = parse(await readFile(INVENTORY, "utf8"));
  } catch (err) {
    console.warn(`ignoring unreadable inventory: ${err.message.split("\n")[0]}`);
  }
}
const previousEntries = previous?.entries ?? {};
const eventDefs = parse(readFileSync(join(ROOT, "data", "audio", "events.yaml"), "utf8")).events ?? {};

const entries = {};
let totalSeconds = 0;
let described = 0;

for (const entry of buildEntries(pack)) {
  const old = previousEntries[entry.id] ?? {};
  const seconds = entry.files.reduce((sum, file) => {
    const encoded = encodedBySource.get(file);
    return sum + (encoded?.durationSec ?? 0);
  }, 0);
  totalSeconds += seconds;

  const status = entry.silence
    ? "silent"
    : entry.kind === "voice" || entry.kind === "eva"
      ? (old.status === "approved" ? "approved" : "needs-script")
      : (old.status ?? "todo");
  if (old.brief) described += 1;

  const record = {
    category: entry.category,
    kind: entry.kind,
    ...(entry.silence ? {} : { target: targetTemplate(entry.id) }),
    variants: entry.files.length,
    seconds: Number(seconds.toFixed(2)),
    loop: entry.loop || Boolean(eventDefs[entry.id]?.control?.includes("loop")),
    status,
  };
  if (old.brief) record.brief = old.brief;
  if (old.prompt) record.prompt = old.prompt;
  if (old.tags?.length) record.tags = old.tags;
  if (old.notes) record.notes = old.notes;
  // `original: true` marks our own content where Zero Hour is silent (e.g.
  // infantry footsteps, owner 2026-10-27): keep its hand-written target.
  entries[entry.id] = old.original ? old : record;
}

for (const [id, old] of Object.entries(previousEntries)) {
  if (old.original && !entries[id]) entries[id] = old;
}

const header = `# Audio inventory (spec 25 §5.1, phase 2).
#
# \`original: true\` entries are our own additions where Zero Hour has no sound;
# the rebuild keeps them as written.
#
# One entry per game sound event. \`target\` is the WebM file we will ship,
# with \`<n>\` replaced by the variant number (1..variants). No entry points at a
# source recording: this is the worklist we transform.
#
# status:
#   silent       keep the silence, no target.
#   needs-script voice/EVA line: write the line in data/audio/lines/ first.
#   todo         no brief yet.
#   draft        brief and prompt written, pending listening review.
#   approved     owner approved the brief by ear.
#
# Drafts (status: draft) were written by a local vision model from a
# spectrogram plus the game context; review them by ear before approving.
#
# Regenerate the metadata with \`node scripts/audio/inventory.mjs --write\`;
# drafts are added by \`node scripts/audio/describe.mjs --write\`.
`;

if (flags.list) {
  for (const record of Object.values(entries)) {
    if (record.status === "silent") continue;
    for (let n = 1; n <= record.variants; n += 1) {
      console.log(record.target.replace("<n>", String(n)));
    }
  }
  process.exit(0);
}

const document = `${header}${stringify({ version: 1, entries }, { lineWidth: 0 })}`;

const categories = {};
for (const record of Object.values(entries)) {
  categories[record.category] ??= { total: 0, described: 0, seconds: 0 };
  categories[record.category].total += 1;
  categories[record.category].seconds += record.seconds;
  if (record.brief) categories[record.category].described += 1;
}

console.log(`inventory: ${Object.keys(entries).length} events, ${(totalSeconds / 60).toFixed(1)} min, ${described} described`);
for (const [category, stats] of Object.entries(categories)) {
  console.log(
    `  ${category.padEnd(10)} ${String(stats.total).padStart(3)} events  ` +
      `${(stats.seconds / 60).toFixed(1).padStart(5)} min  ${stats.described} described`,
  );
}

if (flags.write) {
  await writeFile(INVENTORY, document);
  console.log(`wrote ${INVENTORY.replace(`${ROOT}/`, "")}`);
}
