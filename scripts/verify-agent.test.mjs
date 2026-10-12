import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseRoute, exitCodeFor, isLocalUp, readVerifyConfig, verifyInvocation } from "./verify-agent.mjs";

const MODELS = { data: [{ id: "ornith-1.5-35b-a3b-mlx" }, { id: "gemma-4-26b-a4b-it-mlx" }] };

test("verify-agent: reads the local model and the paid fallback route from the environment", () => {
  const config = readVerifyConfig({});
  assert.equal(config.localModel, "ornith-1.5-35b-a3b-mlx");
  assert.equal(config.lmStudioUrl, "http://127.0.0.1:1234/v1");
  assert.equal(config.fallbackProvider, "deepseek-official");
  assert.equal(config.fallbackModel, "deepseek-flash");
  const custom = readVerifyConfig({ VERIFY_FALLBACK: "other/model-x", RUNNER_LOCAL_MODEL: "gemma-4-26b-a4b-it-mlx" });
  assert.equal(custom.fallbackProvider, "other");
  assert.equal(custom.fallbackModel, "model-x");
  assert.equal(custom.localModel, "gemma-4-26b-a4b-it-mlx");
});

test("verify-agent: the local model is up only when LM Studio lists it", () => {
  assert.equal(isLocalUp(MODELS, "ornith-1.5-35b-a3b-mlx"), true);
  assert.equal(isLocalUp(MODELS, "missing-model"), false);
  assert.equal(isLocalUp(null, "ornith-1.5-35b-a3b-mlx"), false);
  assert.equal(isLocalUp({}, "ornith-1.5-35b-a3b-mlx"), false);
});

test("verify-agent: prefers the local model and never asks about the paid one when it is up", async () => {
  let asked = false;
  const route = await chooseRoute(readVerifyConfig({}), { localUp: true, ask: async () => { asked = true; return "yes"; } });
  assert.deepEqual(route, { provider: "lmstudio", model: "ornith-1.5-35b-a3b-mlx" });
  assert.equal(asked, false);
});

test("verify-agent: falls back to the paid route only with the owner's confirmation (D-11)", async () => {
  const fallback = { provider: "deepseek-official", model: "deepseek-flash" };
  assert.deepEqual(await chooseRoute(readVerifyConfig({}), { localUp: false, ask: async () => "yes" }), fallback);
  const confirmed = readVerifyConfig({ RUNNER_PAID_CONFIRMED: "deepseek-official/deepseek-flash" });
  assert.deepEqual(await chooseRoute(confirmed, { localUp: false, ask: async () => "no" }), fallback);
  for (const answer of ["no", "", null]) {
    assert.equal(await chooseRoute(readVerifyConfig({}), { localUp: false, ask: async () => answer }), null);
  }
});

test("verify-agent: runs the verification-runner definition through the harness in the target checkout", () => {
  const config = readVerifyConfig({});
  const invocation = verifyInvocation(config, { provider: "lmstudio", model: "ornith-1.5-35b-a3b-mlx" }, "/repo", "/target");
  assert.equal(invocation.cmd, "npx");
  assert.ok(invocation.args.includes("/repo/scripts/night-runner.dsh.yml"));
  const prompt = invocation.args.at(-1);
  assert.match(prompt, /\.agents\/agents\/verification-runner\/agent\.md/);
  assert.match(prompt, /\/target/);
  assert.equal(invocation.env.RUNNER_PROVIDER, "lmstudio");
  assert.equal(invocation.env.RUNNER_MODEL, "ornith-1.5-35b-a3b-mlx");
});

test("verify-agent: maps the report verdict to the exit code", () => {
  assert.equal(exitCodeFor("Verdict: PASS\n\nCommands:\n* ok"), 0);
  assert.equal(exitCodeFor("\n\nVerdict: FAIL\n\nFailures:"), 1);
  assert.equal(exitCodeFor("I could not finish."), 4);
  assert.equal(exitCodeFor(""), 4);
});
