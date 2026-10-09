import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  FAILURE_MARKER,
  agentInvocation,
  branchName,
  deadline,
  isPaid,
  previousAttempts,
  processIssue,
  readConfig,
  resolveModel,
  selectIssues,
} from "./night-runner.mjs";

test("night-runner: reads defaults and overrides from the environment", () => {
  const config = readConfig({});
  assert.equal(config.engine, "dsh");
  assert.equal(config.provider, "lmstudio");
  assert.equal(config.model, "ornith-1.5-35b-a3b-mlx");
  assert.equal(config.label, "ready-local");
  assert.equal(config.maxAttempts, 3);
  assert.equal(config.stopAt, "07:00");
  const custom = readConfig({ RUNNER_ENGINE: "opencode", RUNNER_MAX_ATTEMPTS: "2", RUNNER_ISSUE: "9" });
  assert.equal(custom.engine, "opencode");
  assert.equal(custom.maxAttempts, 2);
  assert.equal(custom.issue, 9);
  assert.equal(config.autoMerge, false);
  assert.equal(readConfig({ RUNNER_AUTO_MERGE: "1" }).autoMerge, true);
  assert.throws(() => readConfig({ RUNNER_ENGINE: "other" }), /RUNNER_ENGINE/);
});

test("night-runner: names branches <number>-<kebab-title>", () => {
  assert.equal(branchName(76, "P2-22: Command panel, resource bar and outcome overlay"),
    "76-p2-22-command-panel-resource-bar-and-outcome-overlay");
  assert.equal(branchName(3, "  Fix `README` typo!! "), "3-fix-readme-typo");
  assert.ok(branchName(1, "a ".repeat(80)).length <= 60);
});

test("night-runner: selects unassigned issues whose blockers are closed, lowest first", () => {
  const issues = [
    { number: 9, assignees: [] },
    { number: 4, assignees: [] },
    { number: 7, assignees: [{ login: "someone" }] },
    { number: 5, assignees: [] },
  ];
  const blockers = new Map([[4, ["closed"]], [5, ["open", "closed"]], [9, []]]);
  assert.deepEqual(selectIssues(issues, blockers), [4, 9]);
});

test("night-runner: counts previous failed attempts from marker comments", () => {
  const comments = [
    { body: "Claimed by night-runner" },
    { body: `${FAILURE_MARKER}\nAttempt 1 failed` },
    { body: `${FAILURE_MARKER}\nAttempt 2 failed` },
  ];
  assert.equal(previousAttempts(comments), 2);
  assert.equal(previousAttempts([]), 0);
});

test("night-runner: computes the next stop time after the start", () => {
  const evening = new Date(2026, 9, 9, 22, 30);
  assert.deepEqual(deadline(evening, "07:00"), new Date(2026, 9, 10, 7, 0));
  const morning = new Date(2026, 9, 10, 3, 15);
  assert.deepEqual(deadline(morning, "07:00"), new Date(2026, 9, 10, 7, 0));
  assert.throws(() => deadline(morning, "7am"), /RUNNER_STOP_AT/);
});

test("night-runner: treats any provider other than lmstudio as paid (D-11)", () => {
  assert.equal(isPaid(readConfig({})), false);
  assert.equal(isPaid(readConfig({ RUNNER_PROVIDER: "deepseek-official", RUNNER_MODEL: "deepseek-flash" })), true);
});

test("night-runner: uses a paid model only after an interactive yes, else falls back to local", async () => {
  const paid = readConfig({ RUNNER_PROVIDER: "deepseek-official", RUNNER_MODEL: "deepseek-flash" });
  const yes = await resolveModel(paid, async () => "yes");
  assert.equal(yes.model, "deepseek-flash");
  for (const answer of ["no", "", null]) {
    const local = await resolveModel(paid, async () => answer);
    assert.equal(local.provider, "lmstudio");
    assert.equal(local.model, "ornith-1.5-35b-a3b-mlx");
  }
  let asked = false;
  await resolveModel(readConfig({}), async () => { asked = true; return "yes"; });
  assert.equal(asked, false);
});

test("night-runner: builds the dsh and opencode invocations", () => {
  const dsh = agentInvocation(readConfig({}), "do it", "/repo");
  assert.equal(dsh.cmd, "npx");
  assert.deepEqual(dsh.args, ["-y", "@deepseek-ai/dsh", "--profile", "headless",
    "--patch", "/repo/scripts/night-runner.dsh.yml", "do it"]);
  assert.equal(dsh.env.RUNNER_MODEL, "ornith-1.5-35b-a3b-mlx");
  const oc = agentInvocation(readConfig({ RUNNER_ENGINE: "opencode" }), "do it", "/repo");
  assert.equal(oc.cmd, "opencode");
  assert.deepEqual(oc.args, ["run", "--auto", "--model", "lmstudio/ornith-1.5-35b-a3b-mlx", "do it"]);
});

function fakeWorld({ verifyStatus, attempts = 0, prStatus = 0, checksStatus = 0 }) {
  const calls = [];
  const run = (cmd, args, opts = {}) => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    if (opts.logFile) writeFileSync(opts.logFile, `output of ${cmd}\n`, { flag: "a" });
    if (line.startsWith("scripts/gh.sh issue view")) {
      const comments = Array.from({ length: attempts }, () => ({ body: FAILURE_MARKER }));
      return { status: 0, stdout: JSON.stringify({ comments }) };
    }
    if (line === "node --run verify") return { status: verifyStatus, stdout: "" };
    if (line.startsWith("scripts/gh.sh pr create")) return { status: prStatus, stdout: "" };
    if (line.startsWith("scripts/gh.sh pr checks")) return { status: checksStatus, stdout: "" };
    if (line.startsWith("git status --porcelain")) return { status: 0, stdout: " M file\n" };
    return { status: 0, stdout: "" };
  };
  return { calls, run };
}

function context(world, env = {}) {
  const root = mkdtempSync(join(tmpdir(), "night-runner-"));
  return {
    root,
    ctx: {
      config: readConfig(env),
      run: world.run,
      root,
      logDir: join(root, "logs"),
      until: new Date(Date.now() + 3_600_000),
      log: () => {},
    },
  };
}

test("night-runner: claims, runs the agent, verifies and opens a PR", async () => {
  const world = fakeWorld({ verifyStatus: 0 });
  const { ctx } = context(world);
  const result = await processIssue({ number: 12, title: "Trivial fix" }, ctx);
  assert.equal(result, "opened");
  const index = (prefix) => world.calls.findIndex((c) => c.startsWith(prefix));
  assert.ok(index("scripts/gh.sh issue edit 12 --add-assignee @me") >= 0);
  assert.ok(index("git worktree add -B 12-trivial-fix") >= 0);
  assert.ok(index("npx -y @deepseek-ai/dsh") > index("git worktree add"));
  assert.ok(index("node --run verify") > index("npx -y @deepseek-ai/dsh"));
  assert.ok(index("git commit") > index("node --run verify"));
  assert.ok(index("git push -u origin 12-trivial-fix") > index("git commit"));
  const pr = world.calls[index("scripts/gh.sh pr create")];
  assert.match(pr, /--head 12-trivial-fix/);
  assert.match(pr, /Closes #12/);
});

test("night-runner: comments each failure and escalates to needs-pro after the last attempt", async () => {
  const world = fakeWorld({ verifyStatus: 1, attempts: 1 });
  const { ctx } = context(world);
  const result = await processIssue({ number: 12, title: "Trivial fix" }, ctx);
  assert.equal(result, "escalated");
  const failures = world.calls.filter((c) => c.startsWith("scripts/gh.sh issue comment 12") && c.includes(FAILURE_MARKER));
  assert.equal(failures.length, 2);
  assert.match(failures[1], /Attempt 3\/3/);
  assert.ok(world.calls.includes(
    "scripts/gh.sh issue edit 12 --remove-label ready-local --add-label needs-pro --remove-assignee @me"));
  assert.equal(world.calls.some((c) => c.startsWith("scripts/gh.sh pr create")), false);
  assert.ok(readFileSync(join(ctx.logDir, "12-attempt-3.log"), "utf8").includes("output of"));
});

test("night-runner: counts a PR that cannot be opened as a failed attempt", async () => {
  const world = fakeWorld({ verifyStatus: 0, attempts: 2, prStatus: 1 });
  const { ctx } = context(world);
  const result = await processIssue({ number: 12, title: "Trivial fix" }, ctx);
  assert.equal(result, "escalated");
  assert.ok(world.calls.some((c) => c.includes(FAILURE_MARKER) && c.includes("could not push or open the PR")));
});

const merges = (world) => world.calls.filter((c) => c.startsWith("scripts/gh.sh pr merge"));

test("night-runner: leaves the PR open when auto-merge is off", async () => {
  const world = fakeWorld({ verifyStatus: 0 });
  const { ctx } = context(world);
  assert.equal(await processIssue({ number: 12, title: "Trivial fix" }, ctx), "opened");
  assert.deepEqual(merges(world), []);
});

test("night-runner: squash-merges its PR after green CI when auto-merge is on", async () => {
  const world = fakeWorld({ verifyStatus: 0 });
  const { ctx } = context(world, { RUNNER_AUTO_MERGE: "1" });
  assert.equal(await processIssue({ number: 12, title: "Trivial fix" }, ctx), "merged");
  const checks = world.calls.findIndex((c) => c.startsWith("scripts/gh.sh pr checks 12-trivial-fix --watch"));
  assert.ok(checks > world.calls.findIndex((c) => c.startsWith("scripts/gh.sh pr create")));
  assert.deepEqual(merges(world), ["scripts/gh.sh pr merge 12-trivial-fix --squash --delete-branch"]);
  assert.ok(world.calls.indexOf(merges(world)[0]) > checks);
});

test("night-runner: keeps the PR open for review when CI fails with auto-merge on", async () => {
  const world = fakeWorld({ verifyStatus: 0, checksStatus: 1 });
  const { ctx } = context(world, { RUNNER_AUTO_MERGE: "1" });
  assert.equal(await processIssue({ number: 12, title: "Trivial fix" }, ctx), "opened");
  assert.deepEqual(merges(world), []);
  assert.equal(world.calls.some((c) => c.includes(FAILURE_MARKER)), false);
});
