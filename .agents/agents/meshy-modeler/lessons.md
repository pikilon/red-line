# meshy-modeler lessons

Read before starting; append new entries last (format in `.agents/workflows/faction-assembly.md`).

### 2026-11-24 No prompt history from the first Meshy pass
Problem: the Ukraine/Russia models (PR #494) were generated without recording prompts or task ids, so they cannot be reproduced.
Fix: the brief lives in the faction spec; report task ids and the exact prompt so the coordinator stores them next to the brief.

### 2026-11-24 Known render issues of Meshy assets
Problem: `docs/meshy-issues.md` lists buildings visible through fog and black grass after the first pass.
Fix: check those two in the preview/game before blaming a new model.

- Model tooling is faction-agnostic: turreted/infantry/faction come from `data/generated/ruleset.json` (turretTurnRateDeg, locomotor kind foot, faction index). A new faction only needs a row in `lib.FACTION_BODY`, `infantry.UNIFORM`/`MARK` (unknown ones fall back to neutral) and `FACTION_PREFIXES` in `scripts/audio/reference.mjs`. Biome does not cover `scripts/` or `tools/`: do not run `biome --write` there (it reformats whole files).

### 2026-11-24 Meshy queue holds 5 tasks
Problem: launching 6 image-to-3d tasks at once failed on the sixth (queue full), uncharged.
Fix: start at most 5, then launch the rest once any finishes; meshy-t2 at 5000 triangles finishes in under a minute.

### 2026-11-24 Meshy queue holds only about 3 tasks
Problem: with several modelers in parallel, creating 6 image/mesh tasks at once fails with "task queue is full" or "input task is not succeeded".
Fix: start at most 3-4 tasks, wait for them, then start the rest; check the image task succeeded before image_to_3d.

### 2026-11-24 Infantry cost and params
Reference image nano-banana with pose_mode a-pose (3 credits), image_to_3d from input_task_id with model_type smart-topology, meshy-t2.5, texture meshy-n1, target_polycount 3000, pose_mode a-pose (15 credits). The rest of the batch can run in parallel; URLs from rig/animate results are signed and short-lived, download right away with curl.

### 2026-11-24 Grey previews
Problem: `preview.py` rendered materials flat grey, so texture problems were invisible.
Fix: it now renders with `color_type = "TEXTURE"`; check colours in the preview.

### 2026-11-25 Building batch pipeline and preview framing
Problem: `preview.py` at the default spacing crops buildings to a zoomed corner, so the silhouette is unreadable.
Fix: set `PREVIEW_SPACING=3` to `4` for buildings. Image tasks finish in about 11 s and meshy-t2 5000 buildings in about 20 s, so two image tasks, then two mesh tasks, then two downloads and imports fits a 2-task limit. Use `target_formats: ["glb"]` and `save_to` straight into `.tmp/meshy/<id>.glb`. The Blender "MeshOptimizer not available" line is harmless. Meshy drew the Gattling nest with a twin barrel pointing away from the camera, not seven barrels toward the lower-left; ask for more orientation emphasis if it matters.

### 2026-11-25 Vehicle batch of 6 runs in about 6 minutes
Fast path for vehicles: nano-banana image (3) then image_to_3d meshy-t2 smart-topology, meshy-n1, 3000, target_formats ["glb"] (15) = 18 per type; both finish in under 40 s. Run 2 at a time (image pair, mesh pair), download with save_to straight to .tmp/meshy/<id>.glb, import and preview in one bash loop. Turreted types (turretTurnRateDeg > 0) split the turret automatically ("Extracting primitive: turret"); put "gun pointing toward the lower-left" in the brief for them.

### 2026-11-25 Infantry batch of 2 takes about 2 minutes
Fast path: two nano-banana a-pose images (3 each), then two image_to_3d meshy-t2.5 smart-topology, meshy-n1, 3000, a-pose, target_formats ["glb"] (15 each); both stages finish in under 35 s. 36 credits for two types; download with save_to into .tmp/meshy/<id>.glb and stop (unit-animator imports).
