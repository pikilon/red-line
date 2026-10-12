# AGENTS.md

Modern Conquest: Red Line is an open-source, browser-based 2.5D RTS (Red Alert 2
/ C&C Generals style, modern real-world conflicts). The owner does not write
code: agents implement, the owner reviews quality hands-on.

## Sources of Truth

* `specs/*.md` defines behavior. Functional changes are test-first: write the
  failing test and see it fail because the behavior is missing, then implement.
  Never edit, skip or weaken a test written in the spec phase; if one looks
  wrong, stop and report it on the issue with the `needs-pro` label.
* `docs/decisions.md` (D-01, D-02...) holds architecture, licensing, faction and
  model-tier decisions. Never contradict it; flag conflicts instead.
* Work comes from GitHub issues. State lives in the repository and GitHub,
  never only in a chat.
* Unsure how the original game behaves (pathfinding, production, economy,
  damage, AI...)? Do not guess: follow
  `.agents/agents/generals-precedent/agent.md`, in a subagent or separate
  session when your harness has one, and cite its note in the spec or issue.

## Language

* Everything in the repository and GitHub is English. Player-facing strings go
  through i18n files, never hardcoded.
* Chat with the owner in Spanish, quoting identifiers and paths unchanged.

## Architecture

* `crates/sim`: deterministic Rust simulation (WASM and native). No rendering,
  time, I/O or browser. Fixed-point only: no floats, wall-clock time, unseeded
  randomness or hash-order iteration.
* `client/`: strict TypeScript + Three.js + Vite. Sends commands and renders
  state; never decides game outcomes.
* `data/`: YAML validated by JSON Schema. Balance changes touch data, not code.
* Layers talk only through the documented WASM API and data schemas.
* TypeScript: no `switch` (use a constant object dictionary) and no `enum` (use
  `as const` objects with derived types). `node --run check:rules`, Biome and
  clippy enforce these rules.

## Commands

* Scripts run with `node --run <script>`, never `npm run`. `node --run` skips
  pre/post hooks, so every step lives inside the script itself.
* Fresh clone or worktree: `node --run install:root && node --run install:client`.
* Before declaring any change done, verify on a cheap model outside your
  context: delegate to the `verification-runner` subagent
  (`.agents/agents/verification-runner/agent.md`; Flash in Antigravity, Haiku
  in Claude Code), which tries the local model first. Harnesses without
  file-defined subagents run `node --run verify:agent` themselves: it uses the
  local model, or DeepSeek Flash only with the owner's confirmation (D-11), and
  prints a report starting with `Verdict:`. `UNAVAILABLE` means no cheap model:
  ask the owner. `ERROR`: stop and tell the owner. `node --run verify` is the
  same check sequence CI runs.
* Non-interactive shells may lack cargo: prefix commands with
  `PATH="$HOME/.cargo/bin:$PATH"`. When a tool seems missing, run
  `scripts/doctor.sh`.

## Done Means Owner-Tested

* A player-facing change is not done, and its PR is not merged, until the owner
  has tested it. First test it yourself with real mouse input: synthetic or
  one-frame clicks have hidden broken UI before. Then give the owner numbered
  steps with the expected result, each with a working localhost URL from a dev
  server started in the PR's worktree on its own port. Unattended agents open
  the PR and leave these steps in its body instead of merging.

## AI Providers (D-11)

* Agents may start local models (LM Studio on `http://127.0.0.1:1234/v1`,
  through `dsh` or OpenCode) whenever useful, never at game runtime. If a local
  model or harness fails, stop and tell the owner instead of working around it.
* A paid remote AI API needs the owner's confirmation for that run: agents ask
  in chat, scripts ask interactively and fall back to local models. Code,
  tests, CI and the game never call one.

## Instruction Files

* Read the nearest `AGENTS.md` before editing under `crates/` or `client/`.
* Each rule lives in one place: `AGENTS.md` files, `.agents/skills/<name>/SKILL.md`
  or `.agents/agents/<name>/agent.md` (subagent frontmatter in Antigravity
  format). `.claude/` only holds a symlink to the skills and thin subagent
  wrappers with Claude Code frontmatter. Never create `CLAUDE.md`, `GEMINI.md`, `.cursor/`
  or other agent-specific rule files.
