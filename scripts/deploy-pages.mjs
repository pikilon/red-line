// Builds the game locally and force-pushes it to the `gh-pages` branch, which
// GitHub Pages serves (no GitHub Actions involved). Run from a checkout that has
// the dependencies installed: `node --run deploy:pages`.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
const out = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();

// CI (.github/workflows/pages.yml) passes the authenticated URL in PAGES_REMOTE
// and no git identity exists there, so it commits as the Actions bot.
const remote = process.env.PAGES_REMOTE || out("git", ["remote", "get-url", "origin"]);
const identity = process.env.GITHUB_ACTIONS
  ? ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"]
  : [];
const domain = "red-line.pikilon.com";
const base = "/";
const source = out("git", ["rev-parse", "--short", "HEAD"]);
const dirty = out("git", ["status", "--porcelain"]) !== "";

const work = mkdtempSync(join(tmpdir(), "pages-"));
const site = join(work, "site");
try {
  run("node", ["--run", "build:wasm"]);
  run("node", ["--run", "build:data"]);
  run(
    "npx",
    ["vite", "build", `--base=${base}`, "--outDir", site, "--emptyOutDir"],
    "client",
  );
  writeFileSync(join(site, ".nojekyll"), "");
  writeFileSync(join(site, "CNAME"), `${domain}\n`);

  const pub = join(work, "pub");
  cpSync(site, pub, { recursive: true });
  run("git", ["init", "-q", "-b", "gh-pages"], pub);
  run("git", ["add", "-A"], pub);
  run(
    "git",
    [...identity, "commit", "-q", "-m", `Deploy local build of ${source}${dirty ? " (dirty tree)" : ""}`],
    pub,
  );
  run("git", ["remote", "add", "origin", remote], pub);
  run("git", ["push", "-f", "origin", "gh-pages"], pub);
  console.log(`Published ${source} to https://${domain}/`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
