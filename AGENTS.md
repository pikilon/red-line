# AGENTS.md

Modern Conquest: Red Line is an open-source, browser-based 2.5D RTS inspired by
Red Alert 2 and C&C Generals, set in modern real-world conflicts. The owner does
not write code: agents implement, the owner reviews quality.

## Core Principles

* **Spec-Driven Development:** `specs/*.md` is the absolute source of truth and
  no production code is written without a test that failed first. For any
  functional change, load and execute `.agents/skills/sdd-workflow/SKILL.md`.
* **Project decisions** (architecture, factions, licensing, model tiers) live in
  `docs/decisions.md`. Read it before proposing anything that contradicts it.
* **Doubts about how the original game behaves** (pathfinding, production,
  economy, damage, AI...): do not guess; delegate to the subagent
  defined in `.agents/agents/generals-precedent/agent.md` and cite its note in
  the spec or issue. Never read the original source in the main conversation.
* **State lives in the repository and GitHub, never in a chat.** Work is taken
  from GitHub issues; see `.agents/skills/task-intake/SKILL.md`.

## Repository Language

* Every message, text, comment, commit, issue and PR must be in English.
  Player-facing strings go through i18n files, never hardcoded.

## GitHub Identity

* Never call `gh` directly: use `scripts/gh.sh <args>`. It switches to the
  `pikilon` account before running, so do not check the account yourself.
* Before any commit or push, load `.agents/skills/repository-delivery/SKILL.md`.

## Architecture Boundaries

* `crates/sim` — deterministic simulation in Rust, compiled to WASM and native.
  It knows nothing about rendering, time, I/O or the browser.
* `client/` — TypeScript + Three.js renderer, UI, input, audio and networking.
  It never decides game outcomes; it sends commands and renders state.
* `data/` — factions, units, weapons and AI scripts in YAML validated by JSON
  Schema. Balance changes touch data, not code.
* Communication between layers only happens through the documented WASM API
  and data schemas.

## Code Rules (all languages)

* In JS/TS never use `switch`: use a constant object dictionary.
* Never use TypeScript `enum`: use `as const` objects with derived types.
* The simulation is deterministic: no floats in game logic (fixed-point only),
  no wall-clock time, no unseeded randomness, no hash-order iteration.

## AI Providers and Tokens

* Default to local models (LM Studio on `http://127.0.0.1:1234/v1`, ComfyUI,
  Blender), run through an agent harness (DeepSeek Harness `dsh`, OpenCode).
  Never at game runtime.
* A paid remote AI API (e.g. official DeepSeek) is used only after the owner
  confirms it for that run: agents ask in chat, scripts ask interactively and
  fall back to local models when nobody answers. Code, tests, CI and the game
  never call one (D-11).

## Instruction Subtrees

Before reading or editing files under a subtree, read its `AGENTS.md` if present
(`crates/`, `client/`, `data/`, `tools/`).

## Configuration Portability

* Rules live only in `AGENTS.md` files and `.agents/skills/<name>/SKILL.md`.
  Subagent definitions live in `.agents/agents/<name>/agent.md`.
* Creating `CLAUDE.md`, `GEMINI.md`, `.cursor/`, `copilot-instructions.md` or
  any agent-specific rule file is forbidden. A `CLAUDE.md` would make Claude
  Code ignore this file.

## Runtime and Completion

* Run `scripts/doctor.sh` when a tool seems missing.
* Package scripts run with `node --run <script>`, never `npm run`.
* Before completing any change, load and execute
  `.agents/skills/verification/SKILL.md`.
