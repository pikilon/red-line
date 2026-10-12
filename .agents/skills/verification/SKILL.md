---
name: verification
description: Verify code or configuration changes, run checks or tests, edit test scripts, or prepare to declare implementation work complete.
---

# Repository Verification

* The canonical sequence is the `verify` script in the root `package.json`
  (the same one CI runs): `node --run verify`. Its steps are also separate
  scripts (`check:rust`, `build:wasm`, `check:rules`, `test:scripts`, `check`,
  `typecheck`, `test:unit`, `build`, `test:e2e`, `check:data`, `assets:check`)
  for iterating on one layer. CI runs the full `verify` on every PR.
* `node --run verify:plan` lists the steps a change can break (none for
  documentation and agent configuration); local verification runs those.
* To keep logs and tokens out of an expensive session, `node --run verify:agent`
  runs the whole verification on the local model and prints only the report
  (the `verification-runner` subagent calls it first; see `AGENTS.md`).
* Shell scripts: `shellcheck scripts/*.sh` (if installed) and run the script once.
* Fresh clone or worktree: `node --run install:root` and
  `node --run install:client` first.
* Non-interactive shells may lack cargo: `PATH="$HOME/.cargo/bin:$PATH"`. Run
  `scripts/doctor.sh` when a tool seems missing.

## Report

State which checks ran, which failed (first failing `path:line` and message)
and which were skipped and why. Search the diff for `.skip`, `.only`,
`#[ignore]`, `test.fixme` and removed assertions, and confirm that no test was
skipped or weakened. Never hide a first failure that passed on a rerun.
