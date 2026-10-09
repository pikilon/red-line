// Fails when data/*.yaml is invalid or data/generated/ruleset.json is stale (specs/03 §4.3).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuleset, formatError, readSources, serializeRuleset } from "./build-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generated = join(root, "data", "generated", "ruleset.json");

if (!existsSync(join(root, "data", "rules", "globals.yaml"))) {
  console.log("check:data: no data sources yet, nothing to validate");
  process.exit(0);
}

const { ruleset, errors } = buildRuleset(readSources(root));
if (errors.length > 0) {
  errors.forEach((e) => console.error(formatError(e)));
  process.exit(1);
}
if (!existsSync(generated) || serializeRuleset(ruleset) !== readFileSync(generated, "utf8")) {
  console.error("data/generated/ruleset.json is stale: run node --run build:data");
  process.exit(1);
}
console.log("check:data: ok");
