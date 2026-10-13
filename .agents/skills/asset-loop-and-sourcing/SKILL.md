---
name: asset-loop-and-sourcing
description: Generate, validate and apply game textures asset by asset, or source licensed third-party ones. Use when adding or regenerating terrain or model textures, running the texture loop overnight, or checking where an asset comes from and under which licence.
---

# Asset Loop and Sourcing

Rule of the loop: one asset at a time, `generate -> validate -> apply to the game -> check in the game -> next`.
The owner approves the final pick; nothing is final until then. Generated and sourced assets stay
CC BY-SA compatible (D-02) and never reproduce EA assets, names or sounds (D-01, D-02).

## Generate (local ComfyUI, FLUX schnell)

* ComfyUI is machine-wide: `comfyui` starts it on 127.0.0.1:8188; models live on the external SSD
  (`RED_LINE_MODELS_DIR`). Setup: `node --run assets:comfyui:setup`. MCP for agents: `tools/asset-pipeline/MCP.md`
  (local workflows only; no `partner_*`, no model downloads without the owner).
* Resource list: `tools/asset-pipeline/textures.yaml` (id, context, rules, palette target).
* Loop with a cheap judge agent: `tools/asset-pipeline/TEXTURE_LOOP.md` and `texture_tool.py`
  (`generate`, `accept`, `apply`, `sheet`; run it with the ComfyUI venv). Outputs go to
  `/Volumes/Externo Mac SSD/red-line-textures/` with a `review.html` for the owner.
* Deterministic loop without an agent: `node --run assets:loop` (`scripts/asset-loop.mjs`,
  `tools/asset-pipeline/manifest.yaml`, `context.yaml`, README there). Its judge is
  `scripts/check-texture.mjs` (size, palette drift, seams, flat images).
* Several agents may queue images; ComfyUI runs one at a time. Use FLUX, never SDXL for new work.

## Apply and check in the game

* `texture_tool.py apply ID` writes the accepted texture as WebP into `client/public/textures/` (model materials as detail maps);
  `tools/asset-pipeline/ingame_shot.mjs` takes screenshots with the generated textures on or off.
* The game loads them by default; the Esc menu button switches back to procedural (spec 12).
  The e2e suite runs with procedural textures except `textures.spec.ts`.

## Source licensed third-party assets

* `node scripts/asset-source.mjs --index | --only <kind> | --prepare | --scores` indexes and scores the
  CC0 (Poly Haven, Kenney) and CC-BY-SA (0 A.D.) library kept outside the repository (`ASSET_LIBRARY`).
* Record every source and licence in `tools/asset-pipeline/LICENSES.md`; attribution goes through `NOTICE.md`.
* Never use `01_EA_GPL_Source_Releases` art, OpenRA bundles or freeware CD content as assets
  (see the "Do not use EA art" section of `tools/asset-pipeline/LICENSES.md`).

## Hand back

Open a PR with the verification report; self-test in the browser, merge, label the issue `needs-owner-test`
and comment the manual steps (AGENTS.md "Done Means Self-Tested, Then Owner-Confirmed").
