// Repository status: open PRs and local
// branches or worktrees that no PR accounts for. GitHub is the source of truth.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KEEP = ["main", "gh-pages"];
const KEEP_PREFIX = ["archive/"];

/** Branch state: kept, open (PR open), merged (PR merged, delete it) or orphan (no PR). */
export function classifyBranch(name, prs) {
  if (KEEP.includes(name) || KEEP_PREFIX.some((p) => name.startsWith(p))) return "kept";
  if (prs.some((pr) => pr.state === "OPEN")) return "open";
  if (prs.some((pr) => pr.state === "MERGED")) return "merged";
  return "orphan";
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const gh = (args) => JSON.parse(run("gh", args));

function main() {
  const openPrs = gh(["pr", "list", "--state", "open", "--json", "number,title,headRefName"]);
  const branches = run("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    .split("\n")
    .filter(Boolean);
  const worktrees = run("git", ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .slice(1);

  console.log(`Open PRs (${openPrs.length})`);
  for (const pr of openPrs) console.log(`  #${pr.number} ${pr.title} [${pr.headRefName}]`);

  const stale = [];
  for (const name of branches) {
    const prs = gh(["pr", "list", "--state", "all", "--head", name, "--json", "number,state"]);
    const state = classifyBranch(name, prs);
    if (state === "merged" || state === "orphan") stale.push(`  ${name}: ${state}`);
  }
  console.log(`Stale local branches (${stale.length})`);
  for (const line of stale) console.log(line);
  console.log(`Extra worktrees (${worktrees.length})`);
  for (const w of worktrees) console.log(`  ${w.slice("worktree ".length)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
