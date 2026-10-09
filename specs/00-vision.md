# 00 — Vision

Status: approved for Phase 1. Source of truth for product intent. Binding
decisions are in `docs/decisions.md` (D-01..D-09); this spec elaborates them and
never contradicts them.

## 1. Pitch

**Modern Conquest: Red Line** is an open-source, browser-based 2.5D real-time
strategy game inspired by Red Alert 2 and C&C Generals, set in modern
real-world conflicts: drones, electronic warfare, artillery, armour and
asymmetric armies. It runs fully offline in the browser once loaded (D-03).

## 2. Pillars

| # | Pillar | What it means in practice |
|---|---|---|
| P1 | Classic RTS feel | Base building, harvesting, production queues, box selection, right-click orders, fast pace. Readability over realism when they conflict on screen. |
| P2 | Modern, real factions | Real countries grouped into blocks (D-04). Every country has at least one unique unit or ability. First matchup: Ukraine vs Russia. |
| P3 | Fair by construction | Every advantage is paid for with a weakness. Balance is measured, not argued: headless bot-vs-bot tournaments (D-04, D-06). |
| P4 | Deterministic core | One Rust simulation, fixed-point, identical results in the browser (WASM) and natively (headless, replays, tournaments). This enables lockstep multiplayer and reproducible balance (D-05). |
| P5 | Web-native and offline | PWA, no install, no server, no account. LAN multiplayer later via WebRTC with manual/QR signalling (D-03). |
| P6 | Open and reproducible | Code AGPL-3.0-or-later, assets CC BY-SA 4.0 (D-02). Assets are generated locally from versioned scripts (D-07). |

## 3. Audience

* Players who loved Red Alert 2 / Generals and want a modern-setting successor
  that runs in a browser tab.
* Modders: units, factions and AI live in YAML validated by JSON Schema.
* Contributors (human or agent): every behaviour is specified and tested.

## 4. Experience targets

* Camera: fixed orthographic isometric view (2.5D), low-poly real-time 3D, with
  an optional pixel-art post-process (D-05).
* Performance: 60 fps with at least 500 units on screen on the owner's
  reference machine (Apple M2 Max, D-09) in a current Chromium browser.
* Simulation runs off the main thread (Web Worker) so input and rendering never
  stall on game logic.
* Tone: more violent than Red Alert 2, with a gore filter setting (D-03).
* All player-facing text is localisable (i18n files); English first.

## 5. Content principles

* Real countries and factions, including active conflicts, depicted as
  realistically as feasible (D-03).
* No real public figures in the first versions. No official logos of
  organisations designated as terrorist: use recognisable inspired emblems.
* Never use EA trademarks in names, UI or assets; "inspired by Red Alert 2 and
  C&C Generals" is allowed in descriptions (D-01).

## 6. Non-goals (for the foreseeable future)

* Online matchmaking, accounts, servers, telemetry or monetisation.
* A general-purpose game engine (Bevy and Godot were rejected, D-05).
* Kev/Jev-style decision models for the AI (D-06).
* Calling paid remote AI APIs from code, tests, CI or the game runtime; agent
  tooling only with the owner's confirmation (D-11).
* Photorealistic graphics.

## 7. Phased delivery

The roadmap (`docs/roadmap.md`) is authoritative. Summary:

| Phase | Outcome | Spec |
|---|---|---|
| 0 | Tooling, agent workflow, specs | this file, `01-architecture.md` |
| 1 | Tech slice: isometric map, selection, flow-field movement, deterministic WASM sim in a Web Worker, 500 placeholder units at 60 fps, identical state hash native vs WASM | `02-phase1-tech-slice.md` |
| 2 | Core RTS loop: resources, power, construction, production, combat, fog of war; Ukraine vs Russia with ~6 units each | future `03-*` |
| 3 | Data-driven skirmish AI and balance tournaments | future |
| 4 | Art and audio | future |
| 5+ | Campaigns, more blocks, LAN multiplayer, PWA release | future |

## 8. Success criteria for the vision

The vision is realised when a player can open the game offline in a browser,
play Ukraine vs Russia against a computer opponent, and a tournament report
shows no faction with a win rate outside 45–55 % across AI personalities. These
are product goals, not Phase 0/1 acceptance criteria; each phase spec turns its
part into testable criteria.
