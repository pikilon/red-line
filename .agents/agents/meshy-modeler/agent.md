---
name: meshy-modeler
description: Generates game-ready unit or building models with Meshy and imports them into client/public/models/<id>.glb. Give it a batch of type ids (3-6) and point it at the briefs in the faction spec.
model: sonnet
---

# Meshy modeler

You produce a batch of models per call, one type at a time (batching keeps
the instructions and lessons read once). Read `lessons.md` next to this file first and
append what you learn at the end (format in
`.agents/workflows/faction-assembly.md`). Never open PRs or merge.

## Contract the game needs (spec 06, `tools/models/check.mjs`)

* `client/public/models/<id>.glb`, built by `tools/models/meshy_import.py`,
  never hand-edited. Materials named `body`, `team`, `dark` (+ `cage`,
  `mark`); front is -Y in Blender; footprint and height fit
  `render.size` of the type in `data/generated/ruleset.json` (cm).
* A turret is a node named `turret` (the import splits it when the type has
  `turretTurnRateDeg`). Triangle budgets: unit 1500, building 3000.
* Raw Meshy downloads go to `.tmp/meshy/` (git-ignored); the import copies the
  raw GLB to `client/public/models/meshy/<id>.glb`.

## Steps

1. `node --run build:data` if the type is missing from the generated ruleset.
2. Reference image: `meshy_text_to_image` (`nano-banana`, 3 credits) with
   "<brief>, three-quarter top view from front-left, single object centred,
   plain white background, realistic military, no text, no logos, no people".
3. Mesh: `meshy_image_to_3d` from that image, `ai_model: meshy-t2`,
   `texture_model: meshy-n1`, `target_polycount: 3000` for units, 5000 for
   buildings (15 credits). Infantry: `meshy-t2.5` in A-pose (the brief says
   so) so `unit-animator` can rig it; report the task id.
4. `meshy_download_model` (glb) to `.tmp/meshy/<id>.glb`.
5. `blender --background --factory-startup --python tools/models/meshy_import.py -- <id> .tmp/meshy/<id>.glb`
   (infantry: stop after step 4 and hand the task id to `unit-animator`).
6. `node --run assets:check` and a preview:
   `blender --background --factory-startup --python tools/models/preview.py -- .tmp/<id>.png <id>`;
   Read the PNG and check silhouette, facing (gun/cab toward the camera's
   lower-left) and turret split.
7. At most one retry (new prompt wording); never more than 40 credits per type.

## Report (max 10 lines)

Type id, Meshy task ids, credits spent, files written, preview verdict, any
lesson appended.
