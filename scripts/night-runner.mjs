// Overnight runner (roadmap task 0.9, D-08, D-11): works open `ready-local`
// issues one by one with a local model, each in its own worktree, and opens a
// PR when `node --run verify` passes. Entry point: scripts/night-runner.sh.
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

export const FAILURE_MARKER = "<!-- night-runner:failure -->";
const LOCAL_PROVIDER = "lmstudio";
const LOG_TAIL_LINES = 40;

const ENGINES = {
  dsh: (config, prompt, root) => ({
    cmd: "npx",
    args: ["-y", "@deepseek-ai/dsh", "--profile", config.dshProfile,
      "--patch", join(root, "scripts/night-runner.dsh.yml"), prompt],
  }),
  opencode: (config, prompt) => ({
    cmd: "opencode",
    args: ["run", "--auto", "--model", `${config.provider}/${config.model}`, prompt],
  }),
};

export function readConfig(env) {
  const engine = env.RUNNER_ENGINE ?? "dsh";
  if (!Object.hasOwn(ENGINES, engine)) {
    throw new Error(`RUNNER_ENGINE must be one of ${Object.keys(ENGINES).join(", ")}, got '${engine}'`);
  }
  const localModel = env.RUNNER_LOCAL_MODEL ?? "ornith-1.5-35b-a3b-mlx";
  return {
    engine,
    provider: env.RUNNER_PROVIDER ?? LOCAL_PROVIDER,
    model: env.RUNNER_MODEL ?? localModel,
    localModel,
    lmStudioUrl: env.RUNNER_LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1",
    dshProfile: env.RUNNER_DSH_PROFILE ?? "headless",
    label: env.RUNNER_LABEL ?? "ready-local",
    maxAttempts: Number(env.RUNNER_MAX_ATTEMPTS ?? 3),
    stopAt: env.RUNNER_STOP_AT ?? "07:00",
    agentTimeoutMinutes: Number(env.RUNNER_AGENT_TIMEOUT_MINUTES ?? 90),
    confirmTimeoutSeconds: Number(env.RUNNER_CONFIRM_TIMEOUT_SECONDS ?? 60),
    issue: env.RUNNER_ISSUE ? Number(env.RUNNER_ISSUE) : null,
    autoMerge: env.RUNNER_AUTO_MERGE === "1",
  };
}

export function branchName(number, title) {
  const kebab = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${number}-${kebab}`.slice(0, 60).replace(/-$/, "");
}

export function selectIssues(issues, blockers) {
  return issues
    .filter((issue) => issue.assignees.length === 0)
    .filter((issue) => (blockers.get(issue.number) ?? []).every((state) => state === "closed"))
    .map((issue) => issue.number)
    .sort((a, b) => a - b);
}

export function previousAttempts(comments) {
  return comments.filter((comment) => comment.body.includes(FAILURE_MARKER)).length;
}

export function deadline(start, stopAt) {
  const match = /^(\d{2}):(\d{2})$/.exec(stopAt);
  if (!match) throw new Error(`RUNNER_STOP_AT must be HH:MM, got '${stopAt}'`);
  const stop = new Date(start);
  stop.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (stop <= start) stop.setDate(stop.getDate() + 1);
  return stop;
}

export function isPaid(config) {
  return config.provider !== LOCAL_PROVIDER;
}

// D-11: a paid model needs an interactive "yes" for this run; otherwise local.
export async function resolveModel(config, ask) {
  if (!isPaid(config)) return config;
  const answer = await ask(
    `${config.provider}/${config.model} is a paid remote API. Type "yes" to use it for this run: `,
  );
  if (/^y(es)?$/i.test((answer ?? "").trim())) return config;
  return { ...config, provider: LOCAL_PROVIDER, model: config.localModel };
}

export function agentInvocation(config, prompt, root) {
  const env = {
    RUNNER_PROVIDER: config.provider,
    RUNNER_MODEL: config.model,
    RUNNER_LOCAL_MODEL: config.localModel,
    RUNNER_LMSTUDIO_URL: config.lmStudioUrl,
  };
  return { ...ENGINES[config.engine](config, prompt, root), env };
}

function taskPrompt(issue, branch, previousFailure) {
  const lines = [
    `You are the overnight runner's agent for GitHub issue #${issue.number} ("${issue.title}").`,
    "Follow AGENTS.md. Load and execute .agents/skills/task-intake/SKILL.md for this issue;",
    `read it with \`scripts/gh.sh issue view ${issue.number}\` and follow its spec with the sdd-workflow skill.`,
    `The runner already claimed the issue and created this worktree on branch ${branch}; work only here.`,
    "You may commit locally, but do not push, open PRs, comment on or relabel issues:",
    "when you finish, the runner runs `node --run verify`, commits what is left and opens the PR.",
    "Never call a paid AI API (D-11). Never edit, skip or weaken tests written in the spec phase.",
  ];
  if (previousFailure) {
    lines.push("", "The previous attempt failed. Tail of its log:", "```", previousFailure, "```");
  }
  return lines.join("\n");
}

function changedLines(before, after) {
  const known = new Set(before.split("\n"));
  return after.split("\n").filter((line) => line.trim() !== "" && !known.has(line)).map((line) => line.slice(3));
}

function tail(file) {
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").trimEnd().split("\n").slice(-LOG_TAIL_LINES).join("\n");
}

export async function processIssue(issue, ctx) {
  const { config, run, root, logDir, until, log } = ctx;
  const gh = (...args) => run("scripts/gh.sh", args, { cwd: root });
  const { number, title } = issue;
  const branch = branchName(number, title);
  const worktree = join(root, ".night-runner", "worktrees", branch);
  const model = `${config.engine} ${config.provider}/${config.model}`;
  mkdirSync(logDir, { recursive: true });

  const view = gh("issue", "view", String(number), "--json", "comments");
  let attempts = previousAttempts(JSON.parse(view.stdout || "{}").comments ?? []);
  gh("issue", "edit", String(number), "--add-assignee", "@me");
  gh("issue", "comment", String(number), "--body", `Claimed by night-runner / ${model}`);

  if (!existsSync(worktree)) {
    run("git", ["fetch", "origin", "main"], { cwd: root });
    run("git", ["worktree", "add", "-B", branch, worktree, "origin/main"], { cwd: root });
    run("git", ["config", "user.name", "pikilon"], { cwd: worktree });
    run("git", ["config", "user.email", "pikilon@gmail.com"], { cwd: worktree });
  }
  run("node", ["--run", "install:client"], { cwd: worktree });

  const deliver = (dirty) => {
    if (dirty) {
      run("git", ["add", "-A"], { cwd: worktree });
      run("git", ["commit", "-m", `chore: applies night-runner changes for #${number}`], { cwd: worktree });
    }
    return run("git", ["push", "-u", "origin", branch], { cwd: worktree }).status === 0 &&
      gh("pr", "create", "--base", "main", "--head", branch, "--title", title, "--body",
        `Closes #${number}\n\n## Verification\n\n\`node --run verify\` passed in the overnight runner ` +
        `(${model}). No test was skipped or weakened by the runner.\n\nGenerated by \`scripts/night-runner.sh\`.`,
      ).status === 0;
  };

  // Agents must leave the main checkout alone; nothing is deleted on their behalf.
  const mainStatus = () => run("git", ["status", "--porcelain"], { cwd: root }).stdout;

  let previousFailure = "";
  while (attempts < config.maxAttempts && Date.now() < until.getTime()) {
    attempts += 1;
    const logFile = join(logDir, `${number}-attempt-${attempts}.log`);
    log(`#${number} attempt ${attempts}/${config.maxAttempts} with ${model}`);
    const agent = agentInvocation(config, taskPrompt(issue, branch, previousFailure), root);
    const timeoutMs = Math.min(config.agentTimeoutMinutes * 60_000, until.getTime() - Date.now());
    const mainBefore = mainStatus();
    const agentRun = run(agent.cmd, agent.args, { cwd: worktree, env: agent.env, timeoutMs, logFile });
    const strays = changedLines(mainBefore, mainStatus());
    const verify = agentRun.status === 0 ? run("node", ["--run", "verify"], { cwd: worktree, logFile }) : null;
    const dirty = run("git", ["status", "--porcelain"], { cwd: worktree }).stdout.trim() !== "";
    const ahead = Number(run("git", ["rev-list", "--count", "origin/main..HEAD"], { cwd: worktree }).stdout || 0);
    const reason = strays.length > 0 ? `the agent changed the main checkout (${strays.join(", ")}); clean it by hand`
      : agentRun.status !== 0 ? "agent exited with an error or timed out"
      : verify.status !== 0 ? "`node --run verify` failed"
      : !dirty && ahead === 0 ? "the agent made no changes"
      : !deliver(dirty) ? "could not push or open the PR" : null;

    if (!reason) {
      run("git", ["worktree", "remove", "--force", worktree], { cwd: root });
      return config.autoMerge ? mergeWhenGreen(branch, ctx) : "opened";
    }

    previousFailure = tail(logFile);
    log(`#${number} attempt ${attempts} failed: ${reason}`);
    gh("issue", "comment", String(number), "--body",
      `${FAILURE_MARKER}\nAttempt ${attempts}/${config.maxAttempts} failed with ${model}: ${reason}.\n\n` +
      `<details><summary>Log tail</summary>\n\n\`\`\`\n${previousFailure}\n\`\`\`\n</details>`);
  }

  if (attempts >= config.maxAttempts) {
    gh("issue", "edit", String(number), "--remove-label", config.label, "--add-label", "needs-pro",
      "--remove-assignee", "@me");
    return "escalated";
  }
  gh("issue", "edit", String(number), "--remove-assignee", "@me");
  return "failed";
}

// RUNNER_AUTO_MERGE=1: merge on green CI so issues blocked by this one unblock
// in the same run; a red or missing CI leaves the PR open for review.
function mergeWhenGreen(branch, { run, root, log }) {
  const gh = (...args) => run("scripts/gh.sh", args, { cwd: root }).status === 0;
  run("sleep", ["30"]); // let GitHub register the CI checks first
  const merged = gh("pr", "checks", branch, "--watch", "--fail-fast", "--interval", "30") &&
    gh("pr", "merge", branch, "--squash", "--delete-branch");
  if (!merged) log(`${branch}: CI did not pass or the merge failed; PR left open for review`);
  return merged ? "merged" : "opened";
}

function run(cmd, args, { cwd, env, timeoutMs, logFile } = {}) {
  const fd = logFile ? openSync(logFile, "a") : null;
  const result = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: fd === null ? ["ignore", "pipe", "inherit"] : ["ignore", fd, fd],
  });
  if (fd !== null) closeSync(fd);
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

function askOnTerminal(timeoutSeconds) {
  return async (question) => {
    if (!process.stdin.isTTY) return null;
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await terminal.question(question, { signal: AbortSignal.timeout(timeoutSeconds * 1000) });
    } catch {
      return null;
    } finally {
      terminal.close();
    }
  };
}

function nextIssue(ctx, done) {
  const { config, run, root } = ctx;
  const gh = (...args) => JSON.parse(run("scripts/gh.sh", args, { cwd: root }).stdout || "null");
  if (config.issue !== null) {
    return done.has(config.issue) ? null : gh("issue", "view", String(config.issue), "--json", "number,title");
  }
  const issues = gh("issue", "list", "--label", config.label, "--state", "open",
    "--json", "number,title,assignees", "--limit", "200").filter((issue) => !done.has(issue.number));
  const blockers = new Map(issues.map((issue) => [issue.number,
    gh("api", `repos/{owner}/{repo}/issues/${issue.number}/dependencies/blocked_by`).map((b) => b.state)]));
  const [number] = selectIssues(issues, blockers);
  return issues.find((issue) => issue.number === number) ?? null;
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const logDir = join(root, ".night-runner", "logs", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(logDir, { recursive: true });
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    appendFileSync(join(logDir, "runner.log"), `${line}\n`);
  };
  const requested = readConfig(process.env);
  const config = await resolveModel(requested, askOnTerminal(requested.confirmTimeoutSeconds));
  if (config.model !== requested.model) log(`No confirmation for ${requested.model}; using local ${config.model}`);
  const until = deadline(new Date(), config.stopAt);
  log(`Starting with ${config.engine} ${config.provider}/${config.model}, stopping at ${until.toISOString()}`);
  const ctx = { config, run, root, logDir, until, log };
  const done = new Set();
  for (let issue = nextIssue(ctx, done); issue && Date.now() < until.getTime(); issue = nextIssue(ctx, done)) {
    done.add(issue.number);
    log(`#${issue.number}: ${await processIssue(issue, ctx)}`);
  }
  log("Finished");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
