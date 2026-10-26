// Validates data/audio/*.yaml against data/schema/audio.schema.json,
// manages data/generated/audio.json, and guards that no reference assets leak into git or dist.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readYamlOrDefault(filePath) {
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf8");
    return parse(raw) ?? {};
  }
  return {};
}

function getAllFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

/**
 * Builds the combined audio configuration object from YAML sources in data/audio/
 * and validates it against data/schema/audio.schema.json.
 */
export function buildAudioData(rootDir = DEFAULT_ROOT) {
  const audioDir = join(rootDir, "data", "audio");
  const eventsRaw = readYamlOrDefault(join(audioDir, "events.yaml"));
  const voicesRaw = readYamlOrDefault(join(audioDir, "voices.yaml"));
  const evaRaw = readYamlOrDefault(join(audioDir, "eva.yaml"));
  const mix = readYamlOrDefault(join(audioDir, "mix.yaml"));
  const reference = readYamlOrDefault(join(audioDir, "reference.yaml"));
  const recipesRaw = readYamlOrDefault(join(audioDir, "synth", "recipes.yaml"));

  const events = eventsRaw.events ?? eventsRaw;
  const voices = voicesRaw.sets ?? voicesRaw.voices ?? voicesRaw;
  const eva = evaRaw.events ?? evaRaw.eva ?? evaRaw;
  const recipes = recipesRaw.recipes ?? recipesRaw;

  const data = { events, voices, eva, mix, reference, recipes };

  const schemaPath = join(rootDir, "data", "schema", "audio.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(schema);

  if (!validate(data)) {
    const errorMessages = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || "/"}: ${e.message}`)
      .join("\n");
    const err = new Error(`Audio data schema validation failed:\n${errorMessages}`);
    err.errors = validate.errors;
    throw err;
  }

  return data;
}

/**
 * Runs audio verification checks:
 * 1. Stale or missing data/generated/audio.json check (or writes if options.write is true).
 * 2. Git guard: verifies git ls-files .local/audio-ref is empty.
 * 3. Dist guard: if client/dist exists, verifies no file path or JS bundle contains .local/audio-ref.
 */
export function checkAudio(rootDir = DEFAULT_ROOT, options = {}) {
  const write = options?.write ?? false;
  const generatedPath = join(rootDir, "data", "generated", "audio.json");
  const eventsYaml = join(rootDir, "data", "audio", "events.yaml");

  if (write) {
    const built = buildAudioData(rootDir);
    writeFileSync(generatedPath, JSON.stringify(built, null, 2) + "\n");
    console.log("Wrote data/generated/audio.json");
    return { ok: true, written: true };
  }

  // 1. Build and verify data/generated/audio.json if sources exist
  const hasSources = existsSync(eventsYaml);
  const hasGenerated = existsSync(generatedPath);

  if (hasSources || hasGenerated) {
    const built = buildAudioData(rootDir);
    const expected = JSON.stringify(built, null, 2) + "\n";
    if (!hasGenerated) {
      throw new Error("data/generated/audio.json is missing: run node scripts/check-audio.mjs --write");
    }
    const current = readFileSync(generatedPath, "utf8");
    if (current !== expected) {
      throw new Error("data/generated/audio.json is stale: run node scripts/check-audio.mjs --write");
    }
  }

  // 2. Inventory matches the reference map (phase 2, spec 25 §5.1)
  const inventoryPath = join(rootDir, "data", "audio", "inventory.yaml");
  if (existsSync(inventoryPath)) {
    const inventory = parse(readFileSync(inventoryPath, "utf8"));
    const reference = parse(readFileSync(join(rootDir, "data", "audio", "reference.yaml"), "utf8"));
    const entries = inventory.entries ?? {};
    const missing = Object.keys(reference).filter((id) => !(id in entries));
    const extra = Object.keys(entries).filter((id) => !(id in reference));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `inventory does not match reference.yaml (${missing.length} missing, ${extra.length} extra): ` +
          "run node scripts/audio/inventory.mjs --write",
      );
    }
    const statuses = new Set(["silent", "needs-script", "todo", "draft", "approved"]);
    for (const [id, entry] of Object.entries(entries)) {
      if (entry.reference !== reference[id]) {
        throw new Error(
          `inventory ${id}: reference is ${entry.reference}, expected ${reference[id]}`,
        );
      }
      if (!statuses.has(entry.status)) {
        throw new Error(`inventory ${id}: unknown status ${entry.status}`);
      }
      if (entry.category !== id.split(".")[0]) {
        throw new Error(`inventory ${id}: category ${entry.category} does not match the id`);
      }
    }
  }

  // 3. Git guard: .local/audio-ref must NEVER be committed to git
  try {
    const tracked = execSync("git ls-files .local/audio-ref", {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (tracked.length > 0) {
      throw new Error(`Tracked files found under .local/audio-ref! These must never be tracked in git:\n${tracked}`);
    }
  } catch (err) {
    if (err.message.includes("Tracked files found")) throw err;
    // If git command fails for other reason (e.g. not a repo in synthetic tests), ignore
  }

  // 4. Dist guard: client/dist must not contain .local/audio-ref
  const clientDist = join(rootDir, "client", "dist");
  if (existsSync(clientDist)) {
    const files = getAllFiles(clientDist);
    for (const file of files) {
      const rel = relative(clientDist, file);
      if (rel.includes(".local/audio-ref") || rel.includes("audio-ref")) {
        throw new Error(`client/dist contains forbidden audio-ref file: ${rel}`);
      }
      if (/\.(js|mjs|cjs|html|css|json|map)$/i.test(file)) {
        const text = readFileSync(file, "utf8");
        if (text.includes(".local/audio-ref")) {
          throw new Error(`client/dist bundle contains forbidden reference to .local/audio-ref in ${rel}`);
        }
      }
    }
  }

  console.log("check:audio: ok");
  return { ok: true };
}

// CLI entrypoint
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const write = process.argv.includes("--write");
  try {
    checkAudio(DEFAULT_ROOT, { write });
  } catch (err) {
    console.error(`check:audio: ${err.message}`);
    process.exit(1);
  }
}
