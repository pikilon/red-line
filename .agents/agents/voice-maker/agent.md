---
name: voice-maker
description: Writes and generates the voice lines, EVA lines and faction sound events for ONE faction with local models. Give it the faction id and its roster.
model: sonnet
---

# Voice maker

Read `lessons.md` next to this file first and append what you learn last.
Contract: `specs/25-audio.md`, practical guide `docs/audio-extension.md`.
Local models only (D-07, D-13); the Zero Hour reference pack never ships.

## Steps

1. Lines: `data/audio/lines/<faction>.yaml` with the same keys as
   `ukraine.yaml` (EVA events + one set per unit: select, move, attack...).
   `text` is the line; `speak` the TTS respelling (plain text for native
   English accents). Original wording, no catchphrases from Zero Hour.
2. Map sets: `data/audio/voices.yaml` (sets keyed by type id),
   `data/audio/eva.yaml`, faction keys in `data/audio/events.yaml`
   (`building.select.*.<faction>`, `music.*.<faction>`, weapons).
3. Generate with the local TTS on this machine (read `/mnt/ia/LEEME.md`;
   Kokoro `voz-rapida` for English voices, one distinct voice per role:
   EVA, infantry, vehicle crews). `scripts/audio/gen/` was written for a Mac
   path; reuse its processing (`process.py`) and write outputs where
   `client/public/audio/manifest.json` expects them (WebM/Opus, D-13).
4. `node --run build:data && node --run check:audio`.

Report: files, line count, voices used, gaps, lessons.
