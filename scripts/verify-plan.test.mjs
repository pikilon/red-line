import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { planSteps, verifySteps } from "./verify-plan.mjs";

const VERIFY = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts.verify;
const ALL = verifySteps(VERIFY);
const CLIENT = ["check:rules", "check", "typecheck", "test:unit", "build", "test:e2e"];

test("verify-plan: reads the steps from the verify script in its order", () => {
  assert.deepEqual(ALL, [
    "check:rust", "check:rules", "test:scripts", "build:wasm", "check", "typecheck",
    "test:unit", "build", "test:e2e", "check:data", "assets:check -- --strict",
  ]);
});

test("verify-plan: documentation and agent configuration need no checks", () => {
  const docs = [
    "AGENTS.md", "client/AGENTS.md", "specs/06-phase4.md", "docs/decisions.md", ".agents/skills/x/SKILL.md",
    ".claude/agents/verification-runner.md", "LICENSE-ASSETS", ".github/ISSUE_TEMPLATE/task.yml",
    ".github/pull_request_template.md", ".env.example", ".gitignore",
  ];
  assert.deepEqual(planSteps(docs, ALL), []);
  assert.deepEqual(planSteps([], ALL), []);
});

test("verify-plan: client changes run the client checks, models also the asset check", () => {
  assert.deepEqual(planSteps(["client/src/hud.ts"], ALL), CLIENT);
  assert.deepEqual(planSteps(["client/public/models/ru-bmp-2.glb"], ALL), [...CLIENT, "assets:check -- --strict"]);
});

test("verify-plan: simulation changes run Rust, WASM and the client that consumes it", () => {
  const sim = ["check:rust", "check:rules", "build:wasm", "typecheck", "test:unit", "build", "test:e2e"];
  for (const file of ["crates/sim/src/lib.rs", "Cargo.lock", "Cargo.toml", "clippy.toml"]) {
    assert.deepEqual(planSteps([file], ALL), sim);
  }
});

test("verify-plan: script and tool changes run their own tests", () => {
  assert.deepEqual(planSteps(["scripts/verify-agent.mjs"], ALL), ["check:rules", "test:scripts", "check:data"]);
  assert.deepEqual(planSteps(["tools/models/build.mjs"], ALL), ["test:scripts", "assets:check -- --strict"]);
});

test("verify-plan: data, manifests, CI and unknown paths run everything", () => {
  for (const file of ["data/factions/russia.yaml", "package.json", "client/package-lock.json", ".github/workflows/ci.yml", "new-dir/x.txt"]) {
    assert.deepEqual(planSteps([file], ALL), ALL);
  }
});

test("verify-plan: merges the steps of several files in the verify order", () => {
  assert.deepEqual(planSteps(["tools/models/build.mjs", "AGENTS.md", "scripts/x.mjs"], ALL), [
    "check:rules", "test:scripts", "check:data", "assets:check -- --strict",
  ]);
});
