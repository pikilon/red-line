// Screenshot of the skirmish with the generated textures on, for the judge agent.
// Usage: node ingame_shot.mjs <baseUrl> <out.png> [procedural]
// Needs a dev server of a checkout that has client/public/textures and the Esc-menu toggle (spec 12).
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  resolve(
    process.env.RED_LINE_CLIENT_DIR ?? resolve(here, "../../client"),
    "package.json",
  ),
);
const { chromium } = require("@playwright/test");

const [baseUrl, out, mode] = process.argv.slice(2);
if (!baseUrl || !out) {
  console.error("usage: node ingame_shot.mjs <baseUrl> <out.png> [procedural]");
  process.exit(1);
}
const settings = JSON.stringify({
  gore: true,
  generatedTextures: mode !== "procedural",
});
const browser = await chromium.launch({
  args: ["--ignore-gpu-blocklist", "--use-angle=metal"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(
  (value) => localStorage.setItem("redline.settings.v1", value),
  settings,
);
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.goto(`${baseUrl}/?seed=1`);
await page.waitForSelector("canvas");
await page.waitForTimeout(4000); // let the textures load and a few frames render
await page.screenshot({ path: out });
await browser.close();
console.log(
  JSON.stringify({ out, mode: mode ?? "generated", consoleErrors: errors }),
);
