// Source-asset loop: indexes the licensed texture library kept outside the repo
// (CC0 Poly Haven + CC-BY-SA 0 A.D.), has a cheap model (Haiku) score each
// candidate for its terrain role, tone-maps the winner and writes it into the
// client. Replaces generated textures with real, redistributable ones.
//
//   node scripts/asset-source.mjs --index            # write source-index.json
//   node scripts/asset-source.mjs                    # score + apply every kind
//   node scripts/asset-source.mjs --only grass       # one kind
//   node scripts/asset-source.mjs --prepare          # tone-map candidates only, print their paths
//   node scripts/asset-source.mjs --scores           # apply using tools/asset-pipeline/source-scores.json
//
// Judge: `claude -p --model haiku` when the CLI is signed in; otherwise a Haiku
// subagent writes source-scores.json ({"<kind>/<file stem>": {score, why}}) and
// --scores applies it. The script never silently falls back to a guess.
//
// Only folders 04_ (CC0) and 05_ (0 A.D.) are ever read; EA / OpenRA / freeware
// material is never used (D-02).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodePng, readPngFile } from "./check-texture.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LIBRARY = process.env.ASSET_LIBRARY ?? join(homedir(), "Pictures", "c&c assets");
const SIZE = 512;
const CC0 = { license: "CC0-1.0", attribution: false };
const ZEROAD = { license: "CC-BY-SA-3.0", attribution: "Wildfire Games (0 A.D.)" };

/** Hand-picked candidates per terrain kind: [library-relative path, source]. */
const polyhaven = (name) => [`04_CC0_Public_Domain/polyhaven/textures/${name}/${name}_diff_2k.jpg`, CC0];
const zeroad = (sub, name) => [
  `05_0AD_CC_BY_SA/repo/binaries/data/mods/public/art/textures/terrain/types/${sub}/${name}.png`,
  ZEROAD,
];
export const CANDIDATES = {
  grass: [
    polyhaven("grass_ground"),
    polyhaven("sparse_grass"),
    polyhaven("leafy_grass"),
    zeroad("temperate", "grass_01"),
    zeroad("temperate", "grass_02"),
    zeroad("temperate", "grass_03"),
  ],
  dirt: [
    polyhaven("dry_ground_01"),
    polyhaven("dirt_aerial_02"),
    polyhaven("red_dirt_mud_01"),
    polyhaven("brown_mud_03"),
    zeroad("temperate", "mud_01"),
  ],
  rock: [
    polyhaven("gray_rocks"),
    polyhaven("rock_ground"),
    polyhaven("rocks_ground_01"),
    polyhaven("rock_face"),
    zeroad("temperate", "cliff_01"),
  ],
  forest: [
    polyhaven("forest_floor"),
    polyhaven("forest_ground_05"),
    polyhaven("leaves_forest_ground"),
    zeroad("temperate", "forestfloor_003"),
  ],
  shore: [polyhaven("coast_sand_01"), polyhaven("aerial_beach_02")],
};

/** What each kind should look like; `target` is the mean colour and `sat` the
 *  saturation multiplier that keeps it a muted RTS ground, not neon. */
const ROLES = {
  grass: { target: [0x5a, 0x6e, 0x3a], sat: 0.7, blurb: "muted olive-green grass for a 90s-style RTS ground, not neon or toxic green" },
  dirt: { target: [0x7a, 0x62, 0x44], sat: 0.85, blurb: "dry brown soil" },
  rock: { target: [0x7d, 0x75, 0x6b], sat: 0.8, blurb: "grey rock and stone" },
  forest: { target: [0x3a, 0x4a, 0x2a], sat: 0.7, blurb: "dark forest floor with leaves" },
  shore: { target: [0x9a, 0x8a, 0x66], sat: 0.85, blurb: "sandy shoreline" },
};

/** Writes tools/asset-pipeline/source-index.json: everything usable, by licence. */
export function buildIndex() {
  const entries = [];
  for (const [kind, list] of Object.entries(CANDIDATES)) {
    for (const [path, src] of list) {
      entries.push({ kind, path, exists: existsSync(join(LIBRARY, path)), ...src });
    }
  }
  const kenney = join(LIBRARY, "04_CC0_Public_Domain/kenney");
  const kits = existsSync(kenney)
    ? readdirSync(kenney, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  const index = {
    library: "~/Pictures/c&c assets (outside the repo)",
    usable: ["04_CC0_Public_Domain (CC0-1.0)", "05_0AD_CC_BY_SA (CC-BY-SA-3.0, attribution required)"],
    never: ["01_EA_GPL_Source_Releases", "02_OpenRA", "03_Freeware_Original_Game_CDs"],
    terrain_textures: entries,
    kenney_kits_glb: kits,
  };
  writeFileSync(join(root, "tools/asset-pipeline/source-index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/** Converts any image to a SIZE x SIZE PNG in `work` (sips ships with macOS). */
function toPng(src, dest) {
  execFileSync("sips", ["-s", "format", "png", "-z", String(SIZE), String(SIZE), src, "--out", dest], { stdio: "ignore" });
  return readPngFile(dest);
}

/** Shifts the mean toward `target` and scales saturation by `sat`. */
export function toneMap(rgba, target, sat) {
  const n = rgba.length / 4;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) { r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2]; }
  const mean = [r / n, g / n, b / n];
  const out = new Uint8Array(rgba.length);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const px = [rgba[o], rgba[o + 1], rgba[o + 2]];
    const luma = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
    for (let c = 0; c < 3; c++) {
      const desat = luma + (px[c] - luma) * sat;
      out[o + c] = clamp(desat + (target[c] - mean[c]) * 0.7);
    }
    out[o + 3] = 255;
  }
  return out;
}

/** Asks Haiku (headless Claude Code) for a 1-10 score; null when unavailable. */
function judge(png, kind, key) {
  if (scoresFile?.[key]) return scoresFile[key];
  const prompt =
    `Read the image ${png}. Score 1-10 how well it works as a seamless top-down ${kind} ground tile ` +
    `for a stylized 90s-style RTS (${ROLES[kind].blurb}). Penalise visible lighting gradients, ` +
    `big unique features that would repeat obviously, and over-saturated colours. ` +
    `Reply with only JSON: {"score": <number>, "why": "<8 words>"}`;
  try {
    const out = execFileSync(
      "claude",
      ["-p", prompt, "--model", "haiku", "--allowedTools", "Read", "--add-dir", dirname(png)],
      { cwd: tmpdir(), encoding: "utf8", timeout: 180_000 },
    );
    const match = out.match(/\{[^}]*"score"[^}]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (error) {
    throw new Error(`Haiku judge failed (${String(error.stderr ?? error.message).trim().slice(0, 200)}); use --prepare then --scores`);
  }
}

let scoresFile = null;

function run() {
  const args = process.argv.slice(2);
  if (args.includes("--scores")) {
    scoresFile = JSON.parse(readFileSync(join(root, "tools/asset-pipeline/source-scores.json"), "utf8"));
  }
  if (args.includes("--index")) {
    const idx = buildIndex();
    console.log(`indexed ${idx.terrain_textures.length} terrain textures, ${idx.kenney_kits_glb.length} kenney kits`);
    return;
  }
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const prepare = args.includes("--prepare");
  const work = process.env.ASSET_WORK ?? join(tmpdir(), "red-line-asset-source");
  mkdirSync(work, { recursive: true });
  const report = [];
  for (const [kind, list] of Object.entries(CANDIDATES)) {
    if (only && only !== kind) continue;
    const scored = [];
    for (const [path, src] of list) {
      const abs = join(LIBRARY, path);
      if (!existsSync(abs)) { console.log(`  skip (missing) ${path}`); continue; }
      const png = join(work, `${kind}-${basename(path).replace(/\.\w+$/, "")}.png`);
      const img = toPng(abs, png);
      const toned = toneMap(img.rgba, ROLES[kind].target, ROLES[kind].sat);
      writeFileSync(png, encodePng(toned, img.width, img.height));
      if (prepare) { console.log(`${kind}/${basename(path).replace(/\.\w+$/, "")} ${png}`); continue; }
      const key = `${kind}/${basename(path).replace(/\.\w+$/, "")}`;
      const verdict = judge(png, kind, key);
      console.log(`  ${key}: ${verdict.score} (${verdict.why})`);
      scored.push({ path, src, png, score: verdict.score, why: verdict.why });
    }
    if (scored.length === 0) continue;
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const dest = ["grass", "dirt", "rock"].includes(kind)
      ? join(root, "client/public/textures", `${kind}.png`)
      : join(root, "client/public/textures/terrain", `${kind}.png`);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(best.png, dest);
    report.push({ kind, chosen: best.path, ...best.src, score: best.score, why: best.why });
    console.log(`=> ${kind}: ${best.path}`);
  }
  writeFileSync(join(root, "tools/asset-pipeline/source-results.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
