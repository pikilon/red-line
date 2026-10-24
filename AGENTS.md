# AGENTS.md

## Working Mode
* The owner describes use cases in product terms and never discusses tests, code, database or AI models. The agent owns every technical decision.
* Ask only when product behavior is genuinely ambiguous; otherwise choose the narrowest reasonable option and record it as an assumption in the spec (if the project keeps specs).
* For each use case: implement it, verify what the change touches, open a pull request and merge it once CI passes. A wrong merge is rolled back.
* Report the result in product terms: what a user can do now and how to try it.
* Keep token use low: read only what the task needs and leave the full suite to CI. Occasionally suggest a way to save usage.

## Project

Modern Conquest: Red Line, a browser 2.5D RTS in the style of Red Alert 2 and
C&C Generals. Behavior lives in `specs/*.md`; decisions in `docs/decisions.md`
(D-01...) are binding: flag a conflict instead of contradicting one.

* **How the original does it.** Before designing a mechanism (pathfinding,
  production, economy, damage, AI...), ask the `generals-precedent` subagent
  (`.agents/agents/generals-precedent/agent.md`) one question and copy what
  Zero Hour does; cite its note in the spec. Do not guess or reinvent.
* **Language.** Everything in the repository and GitHub is English;
  player-facing strings go through `client/src/i18n/`. Talk to the owner in
  Spanish, keeping identifiers and paths unchanged.
* **Determinism.** `crates/sim` is fixed-point Rust: no floats, wall-clock
  time, unseeded randomness or hash-order iteration (`check:rules` and clippy
  fail otherwise). The client only sends commands and renders; balance changes
  go in `data/`, not code.
* **Licensing (D-01, D-02).** Never use EA art, names or sounds as assets.
  Dependencies must be AGPL-3.0 compatible (code) or CC BY-SA 4.0 (assets).
* **AI cost (D-11).** A paid remote AI API needs the owner's confirmation for
  that run; code, tests, CI and the game never call one. In the ComfyUI MCP,
  `partner_*`, `auth_login` and model downloads need confirmation too.

## Commands

* Scripts run with `node --run <script>`, never `npm run`. Fresh clone or
  worktree: `node --run install:root && node --run install:client`.
* CI runs `node --run verify`. Shells may lack cargo: prefix
  `PATH="$HOME/.cargo/bin:$PATH"`; `scripts/doctor.sh` checks the toolchain.
* To let the owner try a situation, give a `?load=<id>` URL from an example
  save (`node --run saves:list`; spec 19).
* `node --run deploy:pages` publishes the game publicly: only when the owner
  asks.

## GitHub

* Act as `pikilon`; if `gh` or git uses another account, stop and tell the
  owner. Commits are authored `pikilon <pikilon@gmail.com>`; remote
  `git@github-pikilon:pikilon/red-line.git`.
* Commit messages: English, third person, one prefix (`feat`, `fix`, `chore`,
  `docs`, `refactor`, `test`, `build`, `ci`, `perf`, `style`), e.g.
  `feat: adds flow field integration pass`.
