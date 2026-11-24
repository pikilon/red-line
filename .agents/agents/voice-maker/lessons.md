# voice-maker lessons

Read before starting; append new entries last (format in `.agents/workflows/faction-assembly.md`).

### 2026-11-24 Generator scripts point at a Mac drive
Problem: `scripts/audio/gen/run_all.sh` defaults `AUDIO_GEN_ROOT` to `/Volumes/...` and venvs created there; this machine is Linux.
Fix: use the tools registered in `/mnt/ia/LEEME.md` (Kokoro `voz-rapida`), never create venvs or download models outside `/mnt/ia`.

### 2026-11-24 American English Kokoro needs the spaCy model and voice files
Problem: `voz-rapida` is Spanish (`lang_code="e"`); English (`lang_code="a"`) failed asking spaCy `en_core_web_sm`, and only ef_dora/em_alex were cached.
Fix: `uv pip install --python /mnt/ia/entornos/audio-kokoro/bin/python <en_core_web_sm wheel>` (UV_CACHE_DIR=/mnt/ia/cache/uv); voices af_heart, af_nicole, am_adam, am_michael, am_onyx, am_puck download into the HF cache under /mnt/ia on first use. Run with `HF_HOME=/mnt/ia/modelos/huggingface CUDA_VISIBLE_DEVICES=` from /mnt/ia/cache/tmp, calling `KPipeline` directly in one process (about 0.5 s/line on CPU).

### 2026-11-24 Do not run process.py on a partial raw folder; shared music needs symlinks
Problem: `process.py` rewrites `manifest.json` from only the files it finds in RAW, dropping every other event. `check:audio` also rejects two inventory entries with the same `target`.
Fix: encode only the new faction's files with ffmpeg (same filter chains as process.py) and merge them into the manifest by hand; when a faction reuses another's music or building clicks, add relative symlinks `calm.<faction>_1.webm -> calm.ukraine_1.webm` and give the inventory entry the symlink name.
