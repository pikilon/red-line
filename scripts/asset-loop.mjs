// scripts/asset-loop.mjs
// Generates terrain textures one by one: ComfyUI (SDXL) -> makeSeamless ->
// checkTexture -> retry with a new seed -> save the first valid result plus a
// review report. Reads tools/asset-pipeline/{context,manifest}.yaml.
//
// Usage:
//   node scripts/asset-loop.mjs                # every resource in order
//   node scripts/asset-loop.mjs --only grass   # a single resource
//   node scripts/asset-loop.mjs --dry-run      # build workflows, generate nothing
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  checkDistinctKinds,
  checkTexture,
  decodePng,
  encodePng,
  makeSeamless,
  meanColor,
  readPngFile,
} from "./check-texture.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contextPath = join(root, "tools", "asset-pipeline", "context.yaml");
const manifestPath = join(root, "tools", "asset-pipeline", "manifest.yaml");
const outDir = join(root, "client", "public", "textures", "terrain");
const resultsPath = join(root, "tools", "asset-pipeline", "results.json");
const COMFY_URL = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

function parseArgs(argv) {
  const args = { only: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") args.only = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

/** API-format SDXL text-to-image workflow for one resource. */
export function buildWorkflow(resource, config) {
  const negative = resource.negative ?? config.default_negative;
  const { width, height, steps, cfg, model } = config;
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: resource.seed,
        steps,
        cfg,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model } },
    "5": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: resource.prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: `redline_${resource.id}`, images: ["8", 0] },
    },
  };
}

/** Check spec for a resource: palette from context, tolerances from manifest. */
export function buildSpec(resource, config, context) {
  const kind = context.kinds[resource.kind];
  if (!kind) throw new Error(`unknown kind ${resource.kind} for ${resource.id}`);
  return {
    width: config.width,
    height: config.height,
    palette: { base: hexToRgb(kind.palette.base) },
    meanTolerance: resource.mean_tolerance ?? config.mean_tolerance,
    seamTolerance: resource.seam_tolerance ?? config.seam_tolerance,
    minVariance: resource.min_variance ?? config.min_variance,
  };
}

async function postPrompt(workflow) {
  const res = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) throw new Error(`/prompt ${res.status}: ${await res.text()}`);
  return (await res.json()).prompt_id;
}

async function waitForOutput(promptId) {
  const timeoutMs = Number.parseInt(
    process.env.ASSET_LOOP_TIMEOUT_MS ?? "3600000",
    10,
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${COMFY_URL}/history/${promptId}`);
    if (!res.ok) throw new Error(`/history ${res.status}`);
    const entry = (await res.json())[promptId];
    if (entry?.status?.status_str === "error") throw new Error("ComfyUI run error");
    if (entry?.outputs) {
      for (const node of Object.values(entry.outputs)) {
        const image = node.images?.[0];
        if (image) return image;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`timeout waiting for ${promptId}`);
}

async function fetchImage(image) {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  const res = await fetch(`${COMFY_URL}/view?${params}`);
  if (!res.ok) throw new Error(`/view ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateOnce(workflow) {
  const promptId = await postPrompt(workflow);
  const image = await waitForOutput(promptId);
  return fetchImage(image);
}

/** Generates each resource, validates it, saves the first valid result. */
export async function run(config, context, args, log = console.log) {
  const results = [];
  for (const resource of config.resources) {
    if (args.only && resource.id !== args.only) continue;
    const spec = buildSpec(resource, config, context);
    log(`[${resource.id}] start`);
    let accepted = false;
    let reasons = [];
    for (let attempt = 0; attempt < config.max_retries && !accepted; attempt++) {
      const attemptResource = { ...resource, seed: resource.seed + attempt };
      if (args.dryRun) {
        log(`[${resource.id}] dry-run: seed ${attemptResource.seed}`);
        accepted = true;
        break;
      }
      try {
        const workflow = buildWorkflow(attemptResource, config);
        const png = await generateOnce(workflow);
        const decoded = decodePng(png);
        const seamless = makeSeamless(decoded.rgba, decoded.width, decoded.height);
        const verdict = checkTexture(seamless, decoded.width, decoded.height, spec);
        reasons = verdict.reasons;
        if (verdict.valid) {
          mkdirSync(outDir, { recursive: true });
          writeFileSync(
            join(outDir, `${resource.id}.png`),
            encodePng(seamless, decoded.width, decoded.height),
          );
          log(`[${resource.id}] accepted on attempt ${attempt + 1}`);
          accepted = true;
        } else {
          log(`[${resource.id}] attempt ${attempt + 1} rejected: ${verdict.reasons.join("; ")}`);
        }
      } catch (error) {
        reasons = [error instanceof Error ? error.message : String(error)];
        log(`[${resource.id}] attempt ${attempt + 1} error: ${reasons[0]}`);
      }
    }
    results.push({ id: resource.id, kind: resource.kind, accepted, reasons });
  }
  return results;
}

/** Human-readable summary for the owner's morning review. */
function writeReview(results, contextWarnings = []) {
  const lines = ["# Asset generation review", ""];
  for (const r of results) {
    lines.push(`- **${r.id}** (${r.kind}): ${r.accepted ? "accepted" : "rejected"}`);
    if (r.reasons.length) lines.push(`  - ${r.reasons.join("; ")}`);
  }
  if (contextWarnings.length) {
    lines.push("", "## Context / adjacency", "");
    for (const w of contextWarnings) lines.push(`- ${w}`);
  }
  lines.push("", `_Generated ${new Date().toISOString()}_`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const context = parseYaml(readFileSync(contextPath, "utf8"));
  const manifest = parseYaml(readFileSync(manifestPath, "utf8"));
  const args = parseArgs(process.argv.slice(2));
  const results = await run(manifest, context, args);
  if (args.dryRun) {
    console.log("asset-loop: dry run, nothing written");
    return;
  }
  const means = {};
  for (const r of results) {
    if (!r.accepted) continue;
    try {
      const decoded = readPngFile(join(outDir, `${r.id}.png`));
      means[r.kind] = meanColor(decoded.rgba, decoded.width, decoded.height);
    } catch {
      // missing file: skip the cross-kind check for it
    }
  }
  const contextWarnings = checkDistinctKinds(means, context.kinds);
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "REVIEW.md"), writeReview(results, contextWarnings));
  const ok = results.filter((r) => r.accepted).length;
  console.log(`asset-loop: ${ok}/${results.length} accepted -> ${resultsPath}`);
  if (ok !== results.length) process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`asset-loop: ${error.message}`);
    process.exit(1);
  });
}
