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
