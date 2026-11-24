# unit-animator lessons

Read before starting; append new entries last (format in `.agents/workflows/faction-assembly.md`).

### 2026-11-24 Infantry import runs the per-type script
Problem: `meshy_import.py` for a foot type only copies the raw GLBs to `models/meshy/` and runs `tools/models/<id>.py`; the script slices the Meshy soldier found by `_find_meshy_glb`.
Fix: write the script first (copy `ua-rifleman.py`; palette `usa`), then import with --walk/--run/--combat. No rig.ts override was needed when reusing the rifle/rpg poses. Combat clip used: action 690 (Walk Forward While Shooting inplace); 11 credits per type after the mesh.

### 2026-11-24 Render box too narrow for one launcher soldier
Problem: `assets:check` failed `x extent 0.205 < 0.7 x 0.4` for a single-soldier launcher type with a 40 cm wide box.
Fix: model gunner plus spotter like `ru-rpg-gunner.py` (rifleman as spotter) so the box fills.
