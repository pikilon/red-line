// Help-card screenshots (spec 48 §3.3): replays every recipe of `data/help/`
// in the real game and writes `client/public/help/<shot>.jpg`.
//
//   node --run help:shots                  stale or missing shots only
//   node --run help:shots -- --all         every shot
//   node --run help:shots -- --type ua-bradley   one card's shots
//   node --run help:shots -- --check       list stale shots, capture nothing
//   node --run help:shots -- --url http://127.0.0.1:5191   reuse a server
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECIPES = join(ROOT, "data/help");
const OUT = join(ROOT, "client/public/help");
const MANIFEST = join(OUT, "shots.json");
/** What the game looks like: a change here makes every shot stale. */
const LOOK = [
  "client/index.html",
  "client/src/render",
  "client/public/models",
  "client/public/textures",
  "data/render",
  "data/factions",
  "data/maps",
];

/** Every recipe, tagged with the card (file) it belongs to. */
export function readRecipes(dir = RECIPES) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .flatMap((f) => {
      const card = f.replace(/\.yaml$/, "");
      const list = parse(readFileSync(join(dir, f), "utf8")) ?? [];
      return list.map((recipe) => ({ card, ...recipe }));
    });
}

function lookHash() {
  const listing = execFileSync("git", ["ls-files", "-s", "--", ...LOOK], { cwd: ROOT, encoding: "utf8" });
  return createHash("sha256").update(listing).digest("hex");
}

/** Fingerprint of one shot: the recipe, its save and the look. */
export function fingerprint(recipe, look, saveText) {
  const { card: _card, ...fields } = recipe;
  return createHash("sha256")
    .update(look)
    .update(JSON.stringify(fields))
    .update(saveText)
    .digest("hex")
    .slice(0, 16);
}

const readManifest = () => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {});

function writeManifestEntry(id, fp) {
  // Re-read so parallel runs for other cards keep their entries.
  const manifest = readManifest();
  manifest[id] = fp;
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
}

function saveText(id) {
  const path = join(ROOT, "data/saves", `${id}.yaml`);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Shots whose image is missing or whose fingerprint changed. */
export function staleShots(recipes, look, manifest) {
  return recipes.filter(
    (r) => !existsSync(join(OUT, `${r.id}.jpg`)) || manifest[r.id] !== fingerprint(r, look, saveText(r.save)),
  );
}

function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no server at ${url}`);
}

async function capture(page, base, recipe) {
  const ai = recipe.ai === true ? "" : "&ai=off";
  await page.goto(`${base}/?load=${recipe.save}${ai}`);
  await page.waitForFunction(() => window.__redline?.isReady?.() === true && window.__redline.modelsReady?.() !== false, undefined, { timeout: 60_000 });
  const ticks = recipe.ticks ?? 30;
  await page.waitForFunction((n) => window.__redline.tick() >= n, ticks, { timeout: 120_000, polling: 100 });
  await page.evaluate((types) => {
    const api = window.__redline;
    if (!types || types.length === 0) return api.select([]);
    const me = api.controlledPlayer();
    const kinds = new Set(types.map((id) => api.typeIndex(id)));
    api.select(api.entities().filter((e) => e.owner === me && kinds.has(e.kind)).map((e) => e.id));
  }, recipe.select ?? []);
  await page.addStyleTag({ content: "#perf-panel { display: none !important; }" });
  if (recipe.hud === true) {
    if (recipe.tab) await page.click(`#hud-tab-${recipe.tab}`);
  } else {
    await page.addStyleTag({ content: "#hud-bar, #hud, #perf-panel, #toast, #outcome, #touch-controls, .tutorial { display: none !important; }" });
  }
  // Let the selection and the HUD paint.
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${recipe.id}.jpg`), type: "jpeg", quality: 80 });
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const type = value("--type");
  const all = readRecipes();
  const look = lookHash();
  const manifest = readManifest();
  const scope = type === undefined ? all : all.filter((r) => r.card === type);
  if (flag("--check")) {
    const stale = staleShots(all, look, manifest);
    for (const r of stale) console.log(`stale ${r.id} (${r.card})`);
    console.log(`help shots: ${stale.length} stale of ${all.length}`);
    process.exitCode = flag("--strict") && stale.length > 0 ? 1 : 0;
    return;
  }
  const todo = flag("--all") ? scope : staleShots(scope, look, manifest);
  if (todo.length === 0) {
    console.log(`help shots: nothing to do (${scope.length} current)`);
    return;
  }
  const missingSaves = todo.filter((r) => saveText(r.save) === "");
  if (missingSaves.length > 0) throw new Error(`missing saves: ${missingSaves.map((r) => r.save).join(", ")}`);
  execFileSync("node", ["scripts/build-data.mjs"], { cwd: ROOT, stdio: "inherit" });
  mkdirSync(OUT, { recursive: true });

  let base = value("--url");
  let server = null;
  if (base === undefined) {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
      cwd: join(ROOT, "client"),
      stdio: "ignore",
      detached: true,
    });
    await waitFor(base, 60_000);
  }
  const { chromium } = createRequire(join(ROOT, "client/package.json"))("@playwright/test");
  const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", "--use-angle=metal", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failed = 0;
  try {
    for (const recipe of todo) {
      try {
        await capture(page, base, recipe);
        writeManifestEntry(recipe.id, fingerprint(recipe, look, saveText(recipe.save)));
        console.log(`shot ${recipe.id}`);
      } catch (error) {
        failed += 1;
        console.log(`FAILED ${recipe.id}: ${error.message.split("\n")[0]}`);
      }
    }
  } finally {
    await browser.close();
    if (server !== null) process.kill(-server.pid);
  }
  if (errors.length > 0) console.log(`page errors: ${[...new Set(errors)].join(" | ")}`);
  console.log(`help shots: ${todo.length - failed} written, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
