// Which `verify` steps a change needs (D-08): documentation and agent
// configuration need none, each layer runs the steps that can fail because of
// it, and anything unknown runs everything. CI always runs the full
// `node --run verify`, so this only shortens local verification.
// Entry point: node --run verify:plan (prints the changed files and the steps).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ALL = "all";
const CLIENT = ["check:rules", "check", "typecheck", "test:unit", "build", "test:e2e"];
const ASSETS = "assets:check -- --strict";

// First matching rule wins.
const RULES = [
  [/\.md$|^(docs|specs|\.agents|\.claude)\/|^LICENSE|^\.github\/(ISSUE_TEMPLATE\/|pull_request_template)|^\.env\.example$|^\.gitignore$/, []],
  [/^client\/(package(-lock)?\.json)$/, ALL],
  [/^client\/public\/models\//, [...CLIENT, ASSETS]],
  [/^client\//, CLIENT],
  [/^crates\/|^Cargo\.(toml|lock)$|^clippy\.toml$/, ["check:rust", "check:rules", "build:wasm", "typecheck", "test:unit", "build", "test:e2e"]],
  [/^scripts\//, ["check:rules", "test:scripts", "check:data"]],
  [/^tools\//, ["test:scripts", ASSETS]],
];

export function verifySteps(verifyScript) {
  return verifyScript.split("&&").map((step) => step.trim().replace(/^node --run /, ""));
}

export function planSteps(files, steps) {
  const needed = new Set();
  for (const file of files) {
    const rule = RULES.find(([pattern]) => pattern.test(file));
    const fileSteps = rule ? rule[1] : ALL;
    for (const step of fileSteps === ALL ? steps : fileSteps) needed.add(step);
  }
  return steps.filter((step) => needed.has(step));
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).split("\n").filter(Boolean);
}

// Committed changes since the merge base with origin/main, plus uncommitted and untracked files.
export function changedFiles(cwd) {
  const [base] = git(["merge-base", "origin/main", "HEAD"], cwd);
  const committed = git(["diff", "--name-only", base, "HEAD"], cwd);
  const pending = git(["status", "--porcelain", "--untracked-files=all"], cwd).map((line) => line.slice(3).split(" -> ").at(-1));
  return [...new Set([...committed, ...pending])].sort();
}

export function plan(cwd, root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const files = changedFiles(cwd);
  return { files, steps: planSteps(files, verifySteps(pkg.scripts.verify)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { files, steps } = plan(process.cwd(), root);
  console.log(`Changed files (${files.length}):`);
  for (const file of files) console.log(`  ${file}`);
  console.log(steps.length === 0
    ? "Steps: none (only documentation and agent configuration changed; CI runs the full verify)"
    : `Steps: ${steps.map((step) => `node --run ${step}`).join(" ; ")}`);
}
