// Verification on the cheapest model, outside the caller's context (D-08, D-11):
// runs .agents/agents/verification-runner/agent.md through the agent harness on
// the local LM Studio model and prints only its report. Without a local model it
// falls back to a paid route (default DeepSeek Flash) only with the owner's
// confirmation for this run. The first stdout line is the verdict: PASS, FAIL,
// UNAVAILABLE (no cheap model: Claude Code falls back to its Haiku subagent,
// other harnesses ask the owner) or ERROR (the agent run failed: stop and tell
// the owner). Exit codes 0/1/3/4 match them, but `node --run` reports every
// non-zero code as 1.
// Entry point: node --run verify:agent
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentInvocation, askOnTerminal, readConfig, resolveModel } from "./night-runner.mjs";

const EXIT = { pass: 0, fail: 1, noModel: 3, agentFailed: 4 };
const DEFAULT_FALLBACK = "deepseek-official/deepseek-flash";

export function readVerifyConfig(env) {
  const base = readConfig({ ...env, RUNNER_PROVIDER: undefined, RUNNER_MODEL: undefined });
  const [fallbackProvider, fallbackModel] = (env.VERIFY_FALLBACK ?? DEFAULT_FALLBACK).split("/");
  return {
    ...base,
    fallbackProvider,
    fallbackModel,
    timeoutMinutes: Number(env.VERIFY_AGENT_TIMEOUT_MINUTES ?? 45),
  };
}

export function isLocalUp(models, localModel) {
  return Array.isArray(models?.data) && models.data.some((model) => model.id === localModel);
}

// Local first; the paid fallback goes through the night-runner's D-11 gate,
// which answers with the local route when the owner did not confirm it.
export async function chooseRoute(config, { localUp, ask }) {
  if (localUp) return { provider: config.provider, model: config.localModel };
  const paid = { ...config, provider: config.fallbackProvider, model: config.fallbackModel };
  const resolved = await resolveModel(paid, ask);
  return resolved.provider === config.fallbackProvider ? { provider: resolved.provider, model: resolved.model } : null;
}

export function verifyInvocation(config, route, root, target) {
  const prompt = [
    `You are the verification runner for the checkout at ${target}.`,
    "Read .agents/agents/verification-runner/agent.md there and follow it exactly.",
    "Your final answer is only the report it defines, starting with the `Verdict:` line.",
  ].join("\n");
  return agentInvocation({ ...config, ...route }, prompt, root);
}

export function exitCodeFor(report) {
  const verdict = /^Verdict:\s*(PASS|FAIL)\b/m.exec(report)?.[1];
  return verdict === "PASS" ? EXIT.pass : verdict === "FAIL" ? EXIT.fail : EXIT.agentFailed;
}

export function noModelReport(config) {
  const route = `${config.fallbackProvider}/${config.fallbackModel}`;
  return [
    `Verdict: UNAVAILABLE — ${config.localModel} is not served at ${config.lmStudioUrl} and ${route} was not confirmed for this run (D-11).`,
    "Claude Code: use the verification-runner subagent (Haiku).",
    `Other harnesses: ask the owner, then rerun with RUNNER_PAID_CONFIRMED=${route}.`,
  ].join("\n");
}

export function agentFailedReport(route, reason, stderrTail) {
  return [
    `Verdict: ERROR — the ${route.provider}/${route.model} agent run failed (${reason}); stop and tell the owner.`,
    stderrTail,
  ].filter(Boolean).join("\n");
}

async function fetchModels(url) {
  try {
    const response = await fetch(`${url}/models`, { signal: AbortSignal.timeout(3000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const target = process.cwd();
  const config = readVerifyConfig(process.env);
  const localUp = isLocalUp(await fetchModels(config.lmStudioUrl), config.localModel);
  const route = await chooseRoute(config, { localUp, ask: askOnTerminal(config.confirmTimeoutSeconds) });
  if (!route) {
    console.log(noModelReport(config));
    process.exit(EXIT.noModel);
  }
  console.error(`verify:agent using ${route.provider}/${route.model}`);
  const { cmd, args, env } = verifyInvocation(config, route, root, target);
  const result = spawnSync(cmd, args, {
    cwd: target,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: config.timeoutMinutes * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const report = (result.stdout ?? "").trim();
  const code = result.status === 0 ? exitCodeFor(report) : EXIT.agentFailed;
  if (code === EXIT.agentFailed) {
    const reason = result.error?.message ?? (result.status === 0 ? "no verdict line" : `exit ${result.status}`);
    const stderrTail = (result.stderr ?? "").trim().split("\n").slice(-10).join("\n");
    console.log(agentFailedReport(route, reason, stderrTail));
  }
  if (report) console.log(report);
  process.exit(code);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
