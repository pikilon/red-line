# unit-animator lessons

Read before starting; append new entries last (format in `.agents/workflows/faction-assembly.md`).

### 2026-11-24 Infantry import runs the per-type script
Problem: `meshy_import.py` for a foot type only copies the raw GLBs to `models/meshy/` and runs `tools/models/<id>.py`; the script slices the Meshy soldier found by `_find_meshy_glb`.
Fix: write the script first (copy `ua-rifleman.py`; palette `usa`), then import with --walk/--run/--combat. No rig.ts override was needed when reusing the rifle/rpg poses. Combat clip used: action 690 (Walk Forward While Shooting inplace); 11 credits per type after the mesh.

### 2026-11-24 Render box too narrow for one launcher soldier
Problem: `assets:check` failed `x extent 0.205 < 0.7 x 0.4` for a single-soldier launcher type with a 40 cm wide box.
Fix: model gunner plus spotter like `ru-rpg-gunner.py` (rifleman as spotter) so the box fills.

### 2026-11-25 China infantry (cn-rifle-squad, cn-hj-team)
Problem: `meshy_rig`/`meshy_animate` take `input_task_id`/`rig_task_id`, and rig/animation outputs are not saved by `meshy_download_model`; only URLs come back.
Fix: curl the walking/running/animation GLB URLs from `meshy_get_task_status` (json) into `.tmp/meshy/<id>-{walk,run,combat}.glb`. Rig finishes in seconds. Unknown faction "china" falls back to the neutral palette in `infantry.py`/`lib.py` (no edit needed). RIGS entries for both types already existed. 16 credits per type pair of calls: rig 5 + animate 3 (action 690) = 8 each.
