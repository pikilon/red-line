import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSpec, buildWorkflow } from "./asset-loop.mjs";

const config = {
  model: "sd_xl_base_1.0.safetensors",
  width: 1024,
  height: 1024,
  steps: 24,
  cfg: 6,
  default_negative: "bad things",
  mean_tolerance: 64,
};

const context = {
  kinds: {
    grass: { palette: { base: "#3f6b2a" } },
    dirt: { palette: { base: "#7a5f3e" } },
  },
};

test("AC-loop-01: buildWorkflow wires the checkpoint, prompt and seed", () => {
  const wf = buildWorkflow(
    { id: "grass", kind: "grass", prompt: "green grass", seed: 7 },
    config,
  );
  assert.equal(wf["4"].class_type, "CheckpointLoaderSimple");
  assert.equal(wf["4"].inputs.ckpt_name, "sd_xl_base_1.0.safetensors");
  assert.equal(wf["6"].inputs.text, "green grass");
  assert.equal(wf["7"].inputs.text, "bad things");
  assert.equal(wf["3"].inputs.seed, 7);
  assert.equal(wf["3"].inputs.steps, 24);
  assert.equal(wf["3"].inputs.cfg, 6);
  assert.equal(wf["9"].inputs.filename_prefix, "redline_grass");
  assert.deepEqual(wf["6"].inputs.clip, ["4", 1]);
});

test("AC-loop-02: buildWorkflow uses a per-resource negative when present", () => {
  const wf = buildWorkflow(
    { id: "dirt", prompt: "dirt", negative: "no dirt", seed: 1 },
    config,
  );
  assert.equal(wf["7"].inputs.text, "no dirt");
});

test("AC-loop-03: buildSpec maps the hex palette to rgb and inherits tolerances", () => {
  const spec = buildSpec({ id: "grass", kind: "grass" }, config, context);
  assert.deepEqual(spec.palette.base, [0x3f, 0x6b, 0x2a]);
  assert.equal(spec.meanTolerance, 64);
  assert.equal(spec.width, 1024);
  assert.equal(spec.height, 1024);
});

test("AC-loop-04: buildSpec rejects an unknown kind", () => {
  assert.throws(
    () => buildSpec({ id: "x", kind: "lava" }, config, context),
    /unknown kind lava/,
  );
});
