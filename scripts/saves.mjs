// Example save tooling for agents (spec 19 §6.2). Every command prints at most
// one short line per save and never dumps save contents, so any harness can
// call it without filling its context.
//
//   node --run saves:list
//   node --run saves:run -- <id|path> [ticks]
//   node --run saves:import -- <file|-> <id> [--force]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildRuleset, buildSaves, formatError, readSources, writeSaves } from "./build-data.mjs";
import { parseSaveFile } from "./save-file.mjs";

const DEV_URL = "http://localhost:5173/?load=";
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const GLOBALS = "data/rules/globals.yaml";
const MESSAGES = "client/src/i18n/en.json";
const DEFAULT_TICKS = 900;

const read = (root, path) => readFileSync(join(root, path), "utf8");
const mtime = (path) => (existsSync(path) ? statSync(path).mtimeMs : 0);

/** Rebuilds `data/generated/saves*` from the sources; throws the build errors. */
function buildSavesData(root) {
  const sources = readSources(root);
  // Ajv prints strict-mode notes about the faction schema on every compile;
  // they are not errors and would flood an agent's context.
  const warn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = buildRuleset(sources);
  } finally {
    console.warn = warn;
  }
  const { ruleset, errors } = result;
  const built = ruleset === null ? { errors } : buildSaves(sources.saves, ruleset);
  if (built.errors.length > 0) throw new Error(built.errors.map(formatError).join("; "));
  writeSaves(root, built);
}

/** Rebuilds when the generated index is older than a save source or globals. */
function ensureBuilt(root) {
  const index = mtime(join(root, "data/generated/saves.json"));
  const dir = join(root, "data/saves");
  const sources = existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : [];
  const newest = Math.max(mtime(join(root, GLOBALS)), ...sources.map(mtime));
  if (index < newest) buildSavesData(root);
}

/** One line per example: id, map, form, entities and its `?load=` URL. */
export function listSaves(root) {
  ensureBuilt(root);
  const index = JSON.parse(read(root, "data/generated/saves.json"));
  return index.saves.map((s) => `${s.id}  ${s.map}  ${s.form}  ${s.entities}  ${DEV_URL}${s.id}`);
}

/** `cargo run -p headless -- save <args>` in `root`. */
function headless(root, args) {
  return spawnSync("cargo", ["run", "-q", "--release", "-p", "headless", "--", "save", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(homedir(), ".cargo", "bin")}:${process.env.PATH ?? ""}` },
  });
}

/** `headless save check`: `{ ok }` or `{ ok: false, detail }`. */
function headlessCheck(root, path) {
  const result = headless(root, ["check", path]);
  if (result.status === 0) return { ok: true };
  const detail = (result.status === 1 ? result.stdout : result.stderr).trim();
  return { ok: false, detail: detail || "headless save check failed" };
}

/** Adds `id` to the `saves:` list of `globals.yaml`, keeping its comments. */
function withSaveListed(text, id) {
  const list = /^saves: \[([^\]]*)\]/m.exec(text);
  if (list === null) return text.replace(/^(ai: .*)$/m, `$1\nsaves: [${id}]`);
  const ids = list[1].split(",").map((entry) => entry.trim()).filter(Boolean);
  if (ids.includes(id)) return text;
  return text.replace(list[0], `saves: [${[...ids, id].join(", ")}]`);
}

const refuse = (detail) => ({ ok: false, line: `error: ${detail}` });

/**
 * Imports a world-form save copied from the game as example `id` (spec 19
 * §6.2). `check(path)` defaults to `headless save check`.
 */
export function importSave({ root, file, id, force = false, check }) {
  if (!ID.test(id ?? "") || id.startsWith("slot-")) return refuse(`invalid id ${id}`);
  let text;
  try {
    text = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  } catch (error) {
    return refuse(`cannot read ${file}: ${error.message}`);
  }
  const parsed = parseSaveFile(text);
  if (!parsed.ok) return refuse(`not a save file (${parsed.error})`);
  const save = parsed.save;
  if (save.world === undefined) return refuse("only saves copied from the game (world form) can be imported");
  const target = join(root, "data/saves", `${id}.json`);
  const exists = existsSync(target) || existsSync(join(root, "data/saves", `${id}.yaml`));
  if (exists && !force) return refuse(`${id} already exists; pass --force to replace it`);

  const verdict = (check ?? ((path) => headlessCheck(root, path)))(file);
  if (!verdict.ok) return refuse(verdict.detail);

  const previous = {
    save: existsSync(target) ? readFileSync(target, "utf8") : null,
    globals: read(root, GLOBALS),
    messages: read(root, MESSAGES),
  };
  const messages = JSON.parse(previous.messages);
  messages[`saves.${id}.name`] = save.name.trim();
  messages[`saves.${id}.description`] ??= "";
  try {
    writeFileSync(target, `${JSON.stringify(save, null, 2)}\n`);
    writeFileSync(join(root, GLOBALS), withSaveListed(previous.globals, id));
    writeFileSync(join(root, MESSAGES), `${JSON.stringify(messages, null, 2)}\n`);
    buildSavesData(root);
  } catch (error) {
    if (previous.save === null) rmSync(target, { force: true });
    else writeFileSync(target, previous.save);
    writeFileSync(join(root, GLOBALS), previous.globals);
    writeFileSync(join(root, MESSAGES), previous.messages);
    return refuse(error.message);
  }
  const entities = save.world.entities?.length ?? 0;
  return { ok: true, line: `imported ${id} (${entities} entities, tick ${save.tick})` };
}

/** Runs example `idOrPath` headless for `ticks`; one JSON line. */
export function runSave(root, idOrPath, ticks = DEFAULT_TICKS) {
  let path = idOrPath;
  if (!existsSync(path)) {
    ensureBuilt(root);
    path = join(root, "data/generated/saves", `${idOrPath}.json`);
    if (!existsSync(path)) return refuse(`unknown save ${idOrPath}`);
  }
  const result = headless(root, ["run", path, String(ticks)]);
  if (result.status !== 0) return refuse(result.stderr.trim() || "headless save run failed");
  return { ok: true, line: result.stdout.trim() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, ...args] = process.argv.slice(2);
  const finish = ({ ok, line }) => {
    (ok ? console.log : console.error)(line);
    process.exit(ok ? 0 : 1);
  };
  const commands = {
    list: () => {
      for (const line of listSaves(root)) console.log(line);
    },
    run: () => finish(runSave(root, args[0] ?? "", Number(args[1] ?? DEFAULT_TICKS))),
    import: () => {
      const positional = args.filter((arg) => arg !== "--force");
      finish(importSave({ root, file: positional[0], id: positional[1], force: args.includes("--force") }));
    },
  };
  const run = commands[command];
  if (run === undefined) finish(refuse("usage: saves.mjs list | run <id|path> [ticks] | import <file|-> <id> [--force]"));
  else run();
}
