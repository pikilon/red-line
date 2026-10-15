// Fails when data/*.yaml is invalid or data/generated/ is stale (specs/03 §4.3, spec 19 §4.3).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuleset, buildSaves, formatError, readSources, serializeJson, serializeRuleset } from "./build-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generated = join(root, "data", "generated", "ruleset.json");

if (!existsSync(join(root, "data", "rules", "globals.yaml"))) {
  console.log("check:data: no data sources yet, nothing to validate");
  process.exit(0);
}

const sources = readSources(root);
const { ruleset, errors } = buildRuleset(sources);
if (errors.length > 0) {
  errors.forEach((e) => console.error(formatError(e)));
  process.exit(1);
}
if (!existsSync(generated) || serializeRuleset(ruleset) !== readFileSync(generated, "utf8")) {
  console.error("data/generated/ruleset.json is stale: run node --run build:data");
  process.exit(1);
}
const saves = buildSaves(sources.saves, ruleset);
if (saves.errors.length > 0) {
  saves.errors.forEach((e) => console.error(formatError(e)));
  process.exit(1);
}
const current = (path, value) => {
  const file = join(root, "data", "generated", path);
  return existsSync(file) && readFileSync(file, "utf8") === serializeJson(value);
};
const listed = new Set(saves.saves.map(({ id }) => `${id}.json`));
const extra = existsSync(join(root, "data", "generated", "saves"))
  ? readdirSync(join(root, "data", "generated", "saves")).filter((name) => !listed.has(name))
  : [];
if (!current("saves.json", saves.index) || extra.length > 0 || saves.saves.some(({ id, file }) => !current(`saves/${id}.json`, file))) {
  console.error("data/generated/saves is stale: run node --run build:data");
  process.exit(1);
}
console.log("check:data: ok");
