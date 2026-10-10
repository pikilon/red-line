import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  FAILURE_MARKER,
  agentInvocation,
  allowedFiles,
  branchName,
  compactLog,
  deadline,
  isOwnerConfirmed,
  isPaid,
  previousAttempts,
  processIssue,
  readConfig,
  resolveModel,
  scopeProblem,
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

test("night-runner: RUNNER_PAID_CONFIRMED skips the question only on an exact provider/model match", async () => {
  const env = { RUNNER_PROVIDER: "deepseek-official", RUNNER_MODEL: "deepseek-flash" };
  const asked = [];
  const ask = async (question) => { asked.push(question); return "no"; };
  const confirmed = await resolveModel(readConfig({ ...env, RUNNER_PAID_CONFIRMED: "deepseek-official/deepseek-flash" }), ask);
  assert.equal(confirmed.model, "deepseek-flash");
  assert.equal(asked.length, 0);
  assert.equal(isOwnerConfirmed(readConfig({ ...env, RUNNER_PAID_CONFIRMED: "deepseek-official/deepseek-flash" })), true);
  for (const value of ["deepseek-official/other", "other/deepseek-flash", "deepseek-official", "yes", ""]) {
    const config = readConfig({ ...env, RUNNER_PAID_CONFIRMED: value });
    assert.equal(isOwnerConfirmed(config), false);
    assert.equal((await resolveModel(config, ask)).provider, "lmstudio");
  }
  assert.equal(asked.length, 5);
  assert.equal(isOwnerConfirmed(readConfig({ RUNNER_PAID_CONFIRMED: "lmstudio/ornith-1.5-35b-a3b-mlx" })), false);
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

function fakeWorld({ verifyStatus, attempts = 0, prStatus = 0, checksStatus = 0, strayInMain = false,
  body = "", changed = [] }) {
  const calls = [];
  let agentRan = false;
  const run = (cmd, args, opts = {}) => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    if (cmd === "npx" || cmd === "opencode") agentRan = true;
    if (opts.logFile) writeFileSync(opts.logFile, `output of ${cmd}\n`, { flag: "a" });
    if (line.startsWith("gh issue view")) {
      const comments = Array.from({ length: attempts }, () => ({ body: FAILURE_MARKER }));
      return { status: 0, stdout: JSON.stringify({ comments, body }) };
    }
    if (line === "node --run verify") return { status: verifyStatus, stdout: "" };
    if (line === "git diff --name-only --cached origin/main") return { status: 0, stdout: changed.join("\n") };
    if (line.startsWith("gh pr create")) return { status: prStatus, stdout: "" };
    if (line.startsWith("gh pr checks")) return { status: checksStatus, stdout: "" };
    if (line.startsWith("git status --porcelain") && !opts.cwd.includes(".night-runner")) {
      return { status: 0, stdout: strayInMain && agentRan ? " M scripts/a.mjs\n?? data/stray.yaml\n" : "" };
    }
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
  assert.ok(index("gh issue edit 12 --add-assignee @me") >= 0);
  assert.ok(index("git worktree add -B 12-trivial-fix") >= 0);
  assert.ok(index("npx -y @deepseek-ai/dsh") > index("git worktree add"));
  assert.ok(index("node --run verify") > index("npx -y @deepseek-ai/dsh"));
  assert.ok(index("git commit") > index("node --run verify"));
  assert.ok(index("git push -u origin 12-trivial-fix") > index("git commit"));
  const pr = world.calls[index("gh pr create")];
  assert.match(pr, /--head 12-trivial-fix/);
  assert.match(pr, /Closes #12/);
});

test("night-runner: comments each failure and escalates to needs-pro after the last attempt", async () => {
  const world = fakeWorld({ verifyStatus: 1, attempts: 1 });
  const { ctx } = context(world);
  const result = await processIssue({ number: 12, title: "Trivial fix" }, ctx);
  assert.equal(result, "escalated");
  const failures = world.calls.filter((c) => c.startsWith("gh issue comment 12") && c.includes(FAILURE_MARKER));
  assert.equal(failures.length, 2);
  assert.match(failures[1], /Attempt 3\/3/);
  assert.ok(world.calls.includes(
    "gh issue edit 12 --remove-label ready-local --add-label needs-pro --remove-assignee @me"));
  assert.equal(world.calls.some((c) => c.startsWith("gh pr create")), false);
  assert.ok(readFileSync(join(ctx.logDir, "12-attempt-3.log"), "utf8").includes("output of"));
});

test("night-runner: counts a PR that cannot be opened as a failed attempt", async () => {
  const world = fakeWorld({ verifyStatus: 0, attempts: 2, prStatus: 1 });
  const { ctx } = context(world);
  const result = await processIssue({ number: 12, title: "Trivial fix" }, ctx);
  assert.equal(result, "escalated");
  assert.ok(world.calls.some((c) => c.includes(FAILURE_MARKER) && c.includes("could not push or open the PR")));
});

const merges = (world) => world.calls.filter((c) => c.startsWith("gh pr merge"));

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
  const checks = world.calls.findIndex((c) => c.startsWith("gh pr checks 12-trivial-fix --watch"));
  assert.ok(checks > world.calls.findIndex((c) => c.startsWith("gh pr create")));
  assert.deepEqual(merges(world), ["gh pr merge 12-trivial-fix --squash --delete-branch"]);
  assert.ok(world.calls.indexOf(merges(world)[0]) > checks);
});

test("night-runner: keeps the PR open for review when CI fails with auto-merge on", async () => {
  const world = fakeWorld({ verifyStatus: 0, checksStatus: 1 });
  const { ctx } = context(world, { RUNNER_AUTO_MERGE: "1" });
  assert.equal(await processIssue({ number: 12, title: "Trivial fix" }, ctx), "opened");
  assert.deepEqual(merges(world), []);
  assert.equal(world.calls.some((c) => c.includes(FAILURE_MARKER)), false);
});

test("night-runner: fails the attempt when the agent changes the main checkout", async () => {
  const world = fakeWorld({ verifyStatus: 0, attempts: 2, strayInMain: true });
  const { ctx } = context(world);
  assert.equal(await processIssue({ number: 12, title: "Trivial fix" }, ctx), "escalated");
  assert.equal(world.calls.some((c) => c.startsWith("gh pr create")), false);
  const failure = world.calls.find((c) => c.includes(FAILURE_MARKER));
  assert.match(failure, /changed the main checkout/);
  assert.match(failure, /data\/stray\.yaml/);
  assert.match(failure, /scripts\/a\.mjs/);
});

const ISSUE_BODY = [
  "### Goal", "", "Do it.", "",
  "### Files allowed to change", "", "- `crates/sim/src/vision.rs`", "- `crates/sim/src/world.rs`", "",
  "### Files forbidden to change", "", "- `AGENTS.md`",
].join("\n");

test("night-runner: reads the allowed files from the issue body", () => {
  assert.deepEqual(allowedFiles(ISSUE_BODY), ["crates/sim/src/vision.rs", "crates/sim/src/world.rs"]);
  assert.deepEqual(allowedFiles("no such section"), []);
});

test("night-runner: accepts allowed files plus tests, rejects anything else", () => {
  const allowed = ["crates/sim/src/vision.rs", "crates/sim/src/world.rs"];
  assert.equal(scopeProblem(["crates/sim/src/vision.rs", "crates/sim/tests/vision.rs"], allowed), null);
  assert.equal(scopeProblem(["client/src/render/fog.test.ts", "crates/sim/src/world.rs"], allowed), null);
  assert.match(scopeProblem(["crates/sim/src/world.rs", "scripts/doctor.sh"], allowed), /outside.*scripts\/doctor\.sh/);
  assert.match(scopeProblem(["crates/sim/tests/vision.rs"], allowed), /no allowed file/);
  assert.equal(scopeProblem(["anything.txt"], []), null);
});

test("night-runner: fails the attempt when the agent changes files outside the issue's list", async () => {
  const world = fakeWorld({ verifyStatus: 0, attempts: 2, body: ISSUE_BODY, changed: ["scripts/doctor.sh"] });
  const { ctx } = context(world, { RUNNER_AUTO_MERGE: "1" });
  assert.equal(await processIssue({ number: 61, title: "Vision" }, ctx), "escalated");
  assert.equal(world.calls.some((c) => c.startsWith("gh pr create")), false);
  assert.match(world.calls.find((c) => c.includes(FAILURE_MARKER)), /outside the issue's allowed files.*scripts\/doctor\.sh/);
});

test("night-runner: formats the worktree before verifying", async () => {
  const world = fakeWorld({ verifyStatus: 0, body: ISSUE_BODY, changed: ["crates/sim/src/vision.rs"] });
  const { ctx } = context(world);
  assert.equal(await processIssue({ number: 61, title: "Vision" }, ctx), "opened");
  const format = world.calls.indexOf("node --run format");
  assert.ok(format > world.calls.findIndex((c) => c.startsWith("npx -y @deepseek-ai/dsh")));
  assert.ok(format < world.calls.indexOf("node --run verify"));
});

test("night-runner: gives the agent the issue body and the anti-stall rules", async () => {
  const world = fakeWorld({ verifyStatus: 0, body: ISSUE_BODY, changed: ["crates/sim/src/vision.rs"] });
  const { ctx } = context(world);
  await processIssue({ number: 61, title: "Vision" }, ctx);
  const agent = world.calls.find((c) => c.startsWith("npx -y @deepseek-ai/dsh"));
  assert.match(agent, /crates\/sim\/src\/vision\.rs/);
  assert.match(agent, /scratch test/);
  assert.match(agent, /only the files listed/);
});

test("night-runner: collapses repeated lines in the log tail given to the next attempt", () => {
  const log = ["start", ...Array(30).fill("Let me check Player::new."), "end"].join("\n");
  assert.equal(compactLog(log), ["start", "Let me check Player::new.", "[previous line repeated 29 more times]", "end"].join("\n"));
});
