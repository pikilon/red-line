// Verification on the cheapest model, outside the caller's context (D-08, D-11):
// runs .agents/agents/verification-runner/agent.md through the agent harness on
// the local LM Studio model and prints only its report. Without a local model it
// falls back to a paid route (default DeepSeek Flash) only with the owner's
// confirmation for this run. The first stdout line is the verdict: PASS, FAIL,
// UNAVAILABLE (no cheap model: the verification-runner subagent, on Haiku or
// Flash, runs the checks itself; harnesses without it ask the owner) or ERROR
// (the agent run failed: stop and tell the owner). Exit codes 0/1/3/4 match
// them, but `node --run` reports every non-zero code as 1.
// Entry point: node --run verify:agent
import { spawnSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentInvocation, askOnTerminal, readConfig, resolveModel } from "./night-runner.mjs";
import { plan } from "./verify-plan.mjs";

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

export function verifyInvocation(config, route, root, target, steps) {
  const prompt = [
    `You are the verification runner for the checkout at ${target}.`,
    "Read .agents/agents/verification-runner/agent.md there and follow it.",
    "Do not run `node --run verify:agent`: you are already that local runner, so run the checks yourself.",
    steps && `Run only these verify steps: ${steps.map((step) => `\`node --run ${step}\``).join(", ")}.`,
    "Your final answer is only the report it defines, starting with the `Verdict:` line.",
  ].filter(Boolean).join("\n");
  const invocation = agentInvocation({ ...config, ...route }, prompt, root);
  return { ...invocation, env: { ...invocation.env, WASM_PACK_CACHE: sandboxWasmPackCache(target) } };
}

// The dsh sandbox only writes inside the checkout, where wasm-pack would have
// to reinstall its tools; a copy of the global cache under target/ avoids it.
function sandboxWasmPackCache(target) {
  return join(target, "target", "wasm-pack-cache");
}

const CACHE_HOMES = {
  darwin: ({ home }) => join(home, "Library", "Caches"),
  linux: ({ home, env }) => env.XDG_CACHE_HOME ?? join(home, ".cache"),
};

export function globalWasmPackCache({ platform, home, env }) {
  if (env.WASM_PACK_CACHE) return env.WASM_PACK_CACHE;
  const cacheHome = CACHE_HOMES[platform];
  return cacheHome ? join(cacheHome({ home, env }), ".wasm-pack") : null;
}

function seedWasmPackCache(target) {
  const local = sandboxWasmPackCache(target);
  const global = globalWasmPackCache({ platform: process.platform, home: homedir(), env: process.env });
  if (!existsSync(local) && global && existsSync(global)) cpSync(global, local, { recursive: true });
}

export function extractReport(stdout) {
  const lines = stdout.split("\n");
  const start = lines.findIndex((line) => /^Verdict:/.test(line));
  if (start === -1) return stdout.trim();
  return lines.slice(start).filter((line) => !/^```/.test(line)).join("\n").trim();
}

export function exitCodeFor(report) {
  const verdict = /^Verdict:\s*(PASS|FAIL)\b/m.exec(report)?.[1];
  return verdict === "PASS" ? EXIT.pass : verdict === "FAIL" ? EXIT.fail : EXIT.agentFailed;
}

export function skippedReport(files) {
  return [
    "Verdict: PASS",
    "",
    "Commands:",
    "* no verify step needed — only documentation and agent configuration changed",
    "",
    `Notes: changed files: ${files.join(", ") || "none"}. CI runs the full \`node --run verify\` on the PR.`,
  ].join("\n");
}

export function noModelReport(config) {
  const route = `${config.fallbackProvider}/${config.fallbackModel}`;
  return [
    `Verdict: UNAVAILABLE — ${config.localModel} is not served at ${config.lmStudioUrl} and ${route} was not confirmed for this run (D-11).`,
    "If you are the verification-runner subagent: run the checks yourself.",
    `Otherwise ask the owner, then rerun with RUNNER_PAID_CONFIRMED=${route}.`,
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
  const { files, steps } = plan(target, root);
  if (steps.length === 0) {
    console.log(skippedReport(files));
    process.exit(EXIT.pass);
  }
  const localUp = isLocalUp(await fetchModels(config.lmStudioUrl), config.localModel);
  const route = await chooseRoute(config, { localUp, ask: askOnTerminal(config.confirmTimeoutSeconds) });
  if (!route) {
    console.log(noModelReport(config));
    process.exit(EXIT.noModel);
  }
  console.error(`verify:agent using ${route.provider}/${route.model}`);
  seedWasmPackCache(target);
  const { cmd, args, env } = verifyInvocation(config, route, root, target, steps);
  const result = spawnSync(cmd, args, {
    cwd: target,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: config.timeoutMinutes * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const report = extractReport(result.stdout ?? "");
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
