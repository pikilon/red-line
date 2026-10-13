# Asset generation loop

Generates C&C-style terrain textures one by one with the local ComfyUI (SDXL),
validates each deterministically, and saves the results for the owner's review.

## Run

```bash
node scripts/asset-loop.mjs                 # every resource, in order
node scripts/asset-loop.mjs --only grass    # a single resource
node scripts/asset-loop.mjs --dry-run       # build workflows, generate nothing
# or, via the root script:
node --run assets:loop
node --run assets:loop -- --only grass
```

Set `ASSET_LOOP_TIMEOUT_MS` to raise the per-job wait (default 1 h); use it when
the ComfyUI queue is congested.

## Pipeline

```
for each resource in manifest.yaml:
  generate (ComfyUI SDXL, HTTP API)
  -> makeSeamless (crossfade edges so it tiles)
  -> checkTexture (deterministic judge)
  -> retry with a new seed (up to max_retries)
  -> save the first valid result
```

## Inputs

- [`manifest.yaml`](manifest.yaml) — order, prompts, negative, seeds, model,
  steps, tolerances.
- [`context.yaml`](context.yaml) — per-kind palette, role and neighbour/blend
  rules (adjacency). The client renderer does not read this yet.

## Outputs

- `client/public/textures/terrain/<id>.png` — seamless, validated texture.
- `client/public/textures/terrain/REVIEW.md` — human-readable summary.
- `tools/asset-pipeline/results.json` — machine-readable verdict per resource.

## Deterministic judge (what "valid" means today)

`scripts/check-texture.mjs` rejects a texture when it fails any of:

1. size is not the manifest width/height;
2. mean colour drifts from the kind's palette by more than `mean_tolerance`;
3. the two opposite edge pairs differ by more than `seam_tolerance`
   (i.e. it does not tile) — `makeSeamless` runs first, so this is the guard;
4. a channel's variance is below `min_variance` (a flat/solid image).

A cheap LLM judge for style/context (local/Flash) is planned but not wired yet;
the deterministic checks carry validation until a vision model is chosen.

## Review

Open `REVIEW.md` and the PNGs. Approve or reject each one; approved textures are
then wired into `client/src/render/terrainTexture.ts` (part by part).
