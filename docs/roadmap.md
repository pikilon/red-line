# Roadmap

Each phase ends with a verifiable exit criterion. Specs for a phase are written
(tier S) before any implementation issue of that phase is opened.

## Phase 0 — Tooling and bootstrap

Goal: any agent in any harness can take an issue and deliver it with verifiable
quality.

| # | Task | Status |
|---|---|---|
| 0.1 | Repository, licenses, notice, decisions log | done |
| 0.2 | Root `AGENTS.md` and core skills | done |
| 0.3 | `scripts/gh.sh` identity wrapper and `scripts/doctor.sh` | done |
| 0.4 | Install core toolchain (Rust wasm target, wasm-pack, nextest, Blender, ffmpeg) | done |
| 0.5 | Public GitHub repository, labels, issue/PR templates, project board | done |
| 0.6 | Toolchain skeleton: Cargo workspace (`crates/sim`, `crates/headless`), `client/` (Vite + TS + Three.js), Biome, Vitest, Playwright, empty green CI | done |
| 0.7 | Specs: `00-vision`, `01-architecture`, `02-phase1-tech-slice` | done |
| 0.8 | Harness smoke test (Antigravity, Claude Code, OpenCode, DeepSeek) | todo |
| 0.9 | Overnight runner: DeepSeek Harness headless (or OpenCode) + LM Studio (Ornith) + worktrees, dry run on a trivial issue | done |
| 0.10 | Local AI asset tooling: ComfyUI, Hunyuan3D-2 (MPS), ACE-Step, Kokoro/Piper; Blender procedural model pipeline proof (one tank) | todo |
| 0.11 | Break spec 02 into Phase 1 issues (#10..#26) | done |

Exit: CI green, every harness passes the smoke test, the overnight runner closed
one trivial issue, and a Phase 1 issue queue exists.

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

## Phase 5+ — Content and multiplayer

Campaigns, more blocks and countries, LAN multiplayer (WebRTC lockstep),
offline PWA release on GitHub Pages.
