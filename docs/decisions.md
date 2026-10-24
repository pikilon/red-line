# Project Decisions

Binding decisions taken by the owner. Change them only with the owner's explicit
approval, and record the change here with its date.

## D-01 Identity and name (2026-10-08; amended 2026-10-13)

* Title: **Modern Conquest: Red Line**. Repository: `red-line`.
* Do not use EA trademarks ("Command & Conquer", "Red Alert", "Generals",
  "Zero Hour") as this game's own name, in UI text or as asset titles.
  "Inspired by Red Alert 2 and C&C Generals" is allowed in descriptions, and
  original assets that evoke their look and feel (a style homage) are welcome.
* Owner: Francisco G. Sarazá (`pikilon`, pikilon@gmail.com).

## D-02 Licensing (2026-10-09; amended 2026-10-13)

* Code: **AGPL-3.0-or-later** (`LICENSE`). Copyleft that also covers hosted web
  versions: whoever serves a modified version must publish its source.
* Assets (models, textures, audio, text): **CC BY-SA 4.0** (`LICENSE-ASSETS`).
* Attribution is mandatory and preserved through `NOTICE.md`.
* Original EA source (Red Alert 1, Generals/Zero Hour, GPL-3.0) may be studied
  and, if needed, reused: GPL-3.0 code is compatible with AGPL-3.0.
* Visual direction (D-07, spec 10): generating original assets *in the style
  of* Red Alert 2 / C&C Generals is an explicit goal — a style homage is fine.
  What stays off-limits is reproducing EA's own assets, names or sounds
  verbatim: a screenshot or reference is used to study the style, never traced
  or copied pixel-for-pixel.

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

## D-08 Agent workflow (2026-10-09; replaced 2026-10-24)

* `AGENTS.md` at the root is the only agent instruction file; there are no
  skills, subfolder `AGENTS.md` files or tool-specific rule files. The only
  file-defined subagent is `generals-precedent` (`.agents/agents/`, with a
  thin Claude Code wrapper in `.claude/agents/`).
* The owner describes use cases in product terms; the agent owns every
  technical decision, including tests and model choice, verifies what the
  change touches, opens a PR and merges it once CI passes.
* The earlier workflow (tier S/A/B/C models, test-first spec phase,
  traceability tables, `ready-local`/`ready-pro` issue queue, overnight runner
  and local verification runner) was removed on 2026-10-24.

## D-09 Hardware (2026-10-09)

* Owner machine: Apple M2 Max, 64 GB unified memory. Local LLMs up to ~30B
  quantized run well. LLM work and asset generation are not run concurrently.

## D-10 Phase 2 game design (2026-10-09)

Owner answers to the Phase 2 design questions; elaborated in
`specs/03-phase2-core-loop.md`.

* Economy: Generals-style finite supply depots on the map, harvested by supply
  trucks that unload at a supply center. A completed supply center comes with a
  free truck.
* Construction: a dozer (engineering vehicle) is ordered to place a building
  anywhere on explored, free ground; it drives there and the building rises
  over time, vulnerable while under construction. No build radius, no
  sidebar-and-place.
* Power: plants produce, other buildings consume. A deficit slows production
  and construction in proportion to the shortfall (25 % to 75 % speed) and
  switches off buildings that require power (defenses).
* Fog of war: black shroud on unexplored ground, grey fog on explored ground
  without vision, enemy buildings remembered as last seen; enemy units only
  visible in vision.
* Phase 2 is ground only: drones, aircraft and anti-air come later. No unit
  crushing in Phase 2.
* Victory: a player is defeated when it has no buildings left; units do not
  count.
* Opponent in Phase 2: no AI. With `?debug=1` the player can switch control
  between both sides (hot-seat) and reveal the map.
* Roster per faction: six combat units (rifleman, AT infantry, scout, IFV, main
  battle tank, unique artillery: HIMARS for Ukraine, TOS-1A for Russia), plus
  dozer and supply truck; six buildings (HQ, power plant, supply center,
  barracks, vehicle factory, powered AT defense). Ukraine is expensive and
  precise; Russia is cheaper, tougher and saturating.

## D-11 Paid AI APIs need confirmation (2026-10-09)

* Local models are the default for agent work: LM Studio (Ornith) through an
  agent harness, preferably DeepSeek Harness (`npx @deepseek-ai/dsh`, headless
  mode for unattended runs), with OpenCode as an alternative.
* A paid remote API (for example DeepSeek V4 Flash on the official API) may be
  used by agent tooling only after the owner confirms it for that run. An agent
  asks in chat; a script asks interactively and uses local models when there is
  no answer (unattended runs never spend money).
* Code, tests, CI and the game runtime never call a paid AI API.

## D-12 Production queue and Phase 1 test amendment (2026-10-10)

* Production queues work as in C&C Generals: each production building has one
  queue of up to nine items (`QUEUE_SLOTS = 9`, builtin `maxQueue: 9`), any mix
  of the types it produces, each paid in full when queued. More parallel
  production needs more buildings.
* Phase 2 entities hold a growable production queue, so `Entity` is `Clone` but
  not `Copy`. When P2-04 lands, the Phase 1 test `ac_02_15_units_route_through_the_gap` in `crates/sim/tests/movement.rs`
  clones the unit instead of copying it; the assertions are unchanged.
