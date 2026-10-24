// Reads INI files out of the owner's local Generals / Zero Hour .big archives,
// read-only, for the generals-precedent subagent: EA's source release has the
// code but not the Data/INI values. Prints to stdout and never writes a file.
//
// Usage: node --run generals:ini -- <list [regex] | grep <regex> | show <path>> [--generals]
// The install folder comes from GENERALS_GAME_DIR, or ZHWP_GAME_DIR (OpenZH).
import { existsSync, readdirSync } from "node:fs";
import { open } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const ZERO_HOUR = "INIZH.big";
const GENERALS = "INI.big";
const isIni = (name) => /\.ini$/i.test(name);
const normalize = (path) => path.replaceAll("/", "\\").toLowerCase();

/** Entry names, offsets and sizes of a BIGF archive. */
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
      entries.push({ offset: header.readUInt32BE(at), size: header.readUInt32BE(at + 4), name: header.toString("latin1", at + 8, end) });
      at = end + 1;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

async function readEntry(path, entry) {
  const handle = await open(path, "r");
  try {
    const body = Buffer.alloc(entry.size);
    await handle.read(body, 0, entry.size, entry.offset);
    return body.toString("latin1");
  } finally {
    await handle.close();
  }
}

const findIn = (dir, file) => {
  if (existsSync(join(dir, file))) return join(dir, file);
  const sub = readdirSync(dir, { withFileTypes: true }).find((item) => item.isDirectory() && existsSync(join(dir, item.name, file)));
  return sub && join(dir, sub.name, file);
};

/** INIZH.big, then INI.big with `generals`, in `dir` or one folder below it. */
export function findArchives(dir, { generals = false } = {}) {
  const zeroHour = existsSync(dir) && findIn(dir, ZERO_HOUR);
  if (!zeroHour) throw new Error(`no ${ZERO_HOUR} in ${dir} or its subfolders: is the drive mounted?`);
  const base = generals && findIn(dir, GENERALS);
  return base ? [zeroHour, base] : [zeroHour];
}

async function iniEntries(archives) {
  const all = [];
  for (const archive of archives) {
    for (const entry of await readBigDirectory(archive)) if (isIni(entry.name)) all.push({ archive, entry });
  }
  return all;
}

const label = ({ archive, entry }) => `${basename(archive)}:${entry.name}`;

export async function listIni(archives, pattern = "") {
  const match = new RegExp(pattern, "i");
  return (await iniEntries(archives)).filter(({ entry }) => match.test(entry.name)).map(label);
}

export async function grepIni(archives, pattern) {
  const match = new RegExp(pattern, "i");
  const hits = [];
  for (const item of await iniEntries(archives)) {
    const lines = (await readEntry(item.archive, item.entry)).split(/\r?\n/);
    for (const [index, line] of lines.entries()) if (match.test(line)) hits.push(`${label(item)}:${index + 1}:${line}`);
  }
  return hits;
}

/** The first archive's copy of `path` (Zero Hour wins over Generals). */
export async function showIni(archives, path) {
  const item = (await iniEntries(archives)).find(({ entry }) => normalize(entry.name) === normalize(path));
  if (!item) throw new Error(`${path} not found in ${archives.map((archive) => basename(archive)).join(", ")}`);
  return readEntry(item.archive, item.entry);
}

const COMMANDS = {
  list: async (archives, [pattern]) => (await listIni(archives, pattern)).join("\n"),
  grep: async (archives, [pattern]) => (await grepIni(archives, pattern)).join("\n"),
  show: (archives, [path]) => showIni(archives, path),
};

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { generals: { type: "boolean" } } });
  const [command, ...rest] = positionals;
  const dir = process.env.GENERALS_GAME_DIR ?? process.env.ZHWP_GAME_DIR;
  if (!Object.hasOwn(COMMANDS, command) || (command !== "list" && !rest[0]) || !dir) {
    console.error("usage: generals-ini <list [regex] | grep <regex> | show <path>> [--generals]; set GENERALS_GAME_DIR");
    process.exit(2);
  }
  try {
    console.log(await COMMANDS[command](findArchives(dir, values), rest));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
