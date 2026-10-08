# Project Decisions

Binding decisions taken by the owner. Change them only with the owner's explicit
approval, and record the change here with its date.

## D-01 Identity and name (2026-10-08)

* Title: **Modern Conquest: Red Line**. Repository: `red-line`.
* Never use EA trademarks ("Command & Conquer", "Red Alert", "Generals",
  "Zero Hour") in names, UI or assets. "Inspired by Red Alert 2 and C&C
  Generals" is allowed in descriptions.
* Owner: Francisco G. Sarazá (`pikilon`, pikilon@gmail.com).

## D-02 Licensing (2026-10-09)

* Code: **AGPL-3.0-or-later** (`LICENSE`). Copyleft that also covers hosted web
  versions: whoever serves a modified version must publish its source.
* Assets (models, textures, audio, text): **CC BY-SA 4.0** (`LICENSE-ASSETS`).
* Attribution is mandatory and preserved through `NOTICE.md`.
* Original EA source (Red Alert 1, Generals/Zero Hour, GPL-3.0) may be studied
  and, if needed, reused: GPL-3.0 code is compatible with AGPL-3.0. EA assets,
  names and sounds are never used.

## D-03 Product (2026-10-08)

* Browser web app (PWA) that works fully offline once loaded.
* Single player vs computer, campaigns per army, and later LAN multiplayer via
  WebRTC with manual/QR signaling (no internet required) using deterministic
  lockstep.
* Real countries and real factions, as realistic as possible, including active
  conflicts. More violent than Red Alert 2, with a gore filter setting.
* No real public figures in the first versions. No official logos of
  organizations designated as terrorist: use recognizable inspired emblems.

## D-04 Factions (2026-10-08)

* Blocks: USA, Europe, Ukraine, Russia, China, Israel, Insurgency/Axis (Iran,
  Hamas, ...). Every country belongs to a block and has at least one unique unit
  or ability.
* First matchup: **Ukraine vs Russia**. Others are added incrementally.
* Balance is a hard requirement: every advantage is paid for with a weakness,
  verified by headless bot tournaments.

## D-05 Architecture (2026-10-08)

* **Simulation:** Rust (no game engine), deterministic fixed-point, compiled to
  WASM (runs in a Web Worker) and to native (headless tournaments, replays).
* **Client:** TypeScript + Three.js, 2.5D: real-time low-poly 3D with a fixed
  orthographic isometric camera. Optional pixel-art post-process.
* **Data:** YAML + JSON Schema for factions, units, weapons and AI.
* Bevy and Godot were rejected (unstable API for agents, heavy web builds).

## D-06 Computer AI (2026-10-08)

* Data-driven like Red Alert 2 (`ai.ini`): task forces, scripts, teams and
  weighted triggers, written in YAML, improved with influence maps.
* Kev/Jev decision models are **not** used.
* Balance is measured by bot-vs-bot tournaments with several AI personalities.

## D-07 Assets (2026-10-09)

* Models as code: hard-surface models (vehicles, buildings) are authored by the
  strongest model as procedural Blender Python scripts exporting glTF, so they
  are versioned, parametric and reproducible. Cheaper models produce variants
  and animations from those scripts.
* Organic models (infantry) may use local generators (Hunyuan3D-2) plus rigging.
* Local generation only (ComfyUI, ACE-Step, Kokoro/Piper, LM Studio). Check each
  model's license allows redistribution under CC BY-SA.

## D-08 Agent workflow (2026-10-09)

* Harnesses: Antigravity, Claude Code (>= 2.1.277, reads `AGENTS.md`),
  OpenCode, DeepSeek harness. All share `AGENTS.md` + `.agents/skills/`.
* Model tiers:
  * **S** (Opus): specs, failing tests, issue breakdown, PR review, 3D models.
  * **A** (Sonnet, DeepSeek): complex implementation.
  * **B** (Ornith via LM Studio + OpenCode, overnight): small, fully specified
    issues labelled `ready-local`.
  * **C** (Haiku): trivial edits.
* GitHub issues are the task queue; one branch/worktree per issue; PR + CI.
* Implementation PRs must not modify tests written in the spec phase.

## D-09 Hardware (2026-10-09)

* Owner machine: Apple M2 Max, 64 GB unified memory. Local LLMs up to ~30B
  quantized run well. LLM work and asset generation are not run concurrently.
