# voice-maker lessons

Read before starting; append new entries last (format in `.agents/workflows/faction-assembly.md`).

### 2026-11-24 Generator scripts point at a Mac drive
Problem: `scripts/audio/gen/run_all.sh` defaults `AUDIO_GEN_ROOT` to `/Volumes/...` and venvs created there; this machine is Linux.
Fix: use the tools registered in `/mnt/ia/LEEME.md` (Kokoro `voz-rapida`), never create venvs or download models outside `/mnt/ia`.
