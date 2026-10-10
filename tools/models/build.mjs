// `node --run assets:build` (spec 06 §4): runs every tools/models/<type-id>.py
// through headless Blender in file-name order; stops at the first failure.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NOT_MODELS = ["lib.py", "preview.py"];
const dir = dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(dir).filter((f) => f.endsWith(".py") && !NOT_MODELS.includes(f)).sort();
for (const script of scripts) {
  const result = spawnSync(process.env.BLENDER ?? "blender",
    ["--background", "--factory-startup", "--python-exit-code", "1", "--python", join(dir, script)],
    { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`${script} failed (${result.error?.message ?? `exit ${result.status}`})\n${result.stderr ?? ""}`);
    process.exit(1);
  }
  console.log(`built ${script.slice(0, -3)}.glb`);
}
