# Roadmap

Each phase ends with a verifiable exit criterion.

## Phase 0 — Tooling and bootstrap

Goal: any agent in any harness can take an issue and deliver it with verifiable
quality.

| # | Task | Status |
|---|---|---|
| 0.1 | Repository, licenses, notice, decisions log | done |
| 0.2 | Root `AGENTS.md` | done |
| 0.3 | `scripts/doctor.sh` (the `scripts/gh.sh` identity wrapper was removed in #157) | done |
| 0.4 | Install core toolchain (Rust wasm target, wasm-pack, nextest, Blender, ffmpeg) | done |
| 0.5 | Public GitHub repository, labels, issue/PR templates, project board | done |
| 0.6 | Toolchain skeleton: Cargo workspace (`crates/sim`, `crates/headless`), `client/` (Vite + TS + Three.js), Biome, Vitest, Playwright, empty green CI | done |
| 0.7 | Specs: `00-vision`, `01-architecture`, `02-phase1-tech-slice` | done |
| 0.8 | Harness smoke test (Antigravity, Claude Code, OpenCode, DeepSeek) | obsolete (2026-10-24) |
| 0.9 | Overnight runner and local verification runner | removed (2026-10-24) |
| 0.10 | Local asset tooling: Blender procedural model pipeline (phase 4a, done) and ComfyUI texture loop; Hunyuan3D-2 infantry, ACE-Step music and Kokoro/Piper voices not started | partial |
| 0.11 | Break spec 02 into Phase 1 issues (#10..#26) | done |

Exit: CI green and a Phase 1 issue queue exists. The harness smoke test and the
overnight runner were dropped on 2026-10-24 with the workflow they belonged to
(D-08); `AGENTS.md` replaced that workflow and no runner is planned.

## Phase 1 — Tech slice

Isometric map, selection, movement with flow-field pathfinding, deterministic
WASM simulation in a Web Worker, 500 placeholder units at 60 fps, identical
state hash in native and WASM.

## Phase 2 — Core RTS loop

Resources and harvesting, power, construction, production, combat, fog of war.
Ukraine vs Russia with six combat units each. Spec:
`specs/03-phase2-core-loop.md` (design decisions D-10); issue queue P2-01..P2-25
(#55..#79, label `phase:2`).

Exit: every criterion of spec 03 green in CI (AC-03-63 on the reference
machine), and the owner builds a base, harvests, produces and wins a hot-seat
skirmish by destroying every enemy building.

## Phase 3 — Computer AI and balance

Data-driven RA2-style skirmish AI with several personalities; headless
tournaments with win-rate and cost-efficiency reports.

## Phase 4 — Art and audio

Procedural Blender models, infantry pipeline, effects and gore filter, music and
voices, final visual style.

Slices: 4a procedural models (`specs/06-phase4a-procedural-models.md`, P4-01..05,
done: every unit and building is built procedurally from `tools/models`), 4b
combat effects and gore filter (`specs/07-phase4b-combat-effects.md`, P4-06,
done), 4c animation and visual finish
(`specs/09-phase4c-animation-and-finish.md`, P4-07..09, #186..#188, done).
P4-10 (#189), the classic pixelated mode toggled with `V`, is postponed
indefinitely by owner decision (2026-10-25); its spec is kept, not deleted.
Still to specify: Hunyuan3D infantry. Audio: `specs/25-audio.md` (phase 1 clones Zero Hour audio behaviour with a local reference pack; phase 3 generates our own sounds).
4d Remastered look (`specs/10-phase4d-remastered-look.md`): style reference
*Red Alert Remastered*; terrain textures, lighting and shadows, model detail
and building death are done. The classic mode (§7) shares the P4-10
postponement.

## Phase 5+ — Content and multiplayer

Campaigns, more blocks and countries, LAN multiplayer (WebRTC lockstep),
offline PWA release on GitHub Pages.

## Backlog — mechanics beyond Zero Hour (owner ideas, 2026-10-28)

Owner order: build 1-3, then 4-7; keep drones in the pool for later.

1. **Infantry transport.** Infantry board vehicles, ride, fire from some of
   them and unload (spec 34).
2. **Engineering works.** Infantry dig trenches and repair destroyed bridges;
   dozers help; more workers finish faster (spec 35).
3. **Ports and amphibious vehicles.** Ports pay supply trucks; some vehicles
   cross water (spec 36).

4. **Sell buildings.** The owner sells a building for part of its cost (spec 37).
5. **Repair buildings.** Dozers repair damaged buildings (spec 38).
6. **Repair vehicles.** Damaged vehicles repair at their vehicle factory (spec 39).
7. **Heal infantry.** Infantry heal at the barracks (owner unsure: follow
   the Zero Hour precedent before deciding).

### Pool: drones (not scheduled)

Core idea: a drone is ammunition, not a produced unit. A soldier or vehicle
carries drone charges, launching one spawns a short-lived drone, and charges
refill at the base, a supply truck or a carrier vehicle (Zero Hour precedent:
the American vehicle drones). Kinds and their counters:

| Kind | Role | Counter |
|---|---|---|
| Radio FPV | Cheap kamikaze, strong against armour | Jammer area: it crashes or drifts |
| Fibre-optic FPV | Immune to jamming | Short tether; the operator stays exposed |
| Recon | Reveals the map, no attack | Light anti-air, infantry fire |
| Repeater | Extends radio FPV control range | Priority target: its FPVs drop |
| Shahed | Slow base-to-base strike from a launcher building | Anti-air, interceptor drones, net balloons |
| Interceptor | Automatic base defence against slow drones | Saturation |
| Net zeppelin | Static zone that catches slow drones | Artillery, routing around it |

Counter loop: FPV beats tanks, jammer beats radio FPV, fibre beats the jammer
but has short reach, infantry and anti-air beat fibre. First slice when
scheduled: radio FPV charges plus the jammer.
