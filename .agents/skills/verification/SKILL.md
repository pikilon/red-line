---
name: verification
description: Verify code or configuration changes, run checks or tests, edit test scripts, or prepare to declare implementation work complete.
---

# Repository Verification

## Close-out

Follow every applicable nested `AGENTS.md`, then run the checks for each layer
you touched. Run all of them when unsure.

| Layer | Command |
|---|---|
| Shell scripts | `shellcheck scripts/*.sh` (if installed) and run the script once |
| Simulation | `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo nextest run` |
| WASM build | `wasm-pack build crates/sim --target web` |
| Client | `node --run check && node --run typecheck && node --run test:unit && node --run test:e2e && node --run build` |
| Data | `node --run check:data` |

Commands for layers that do not exist yet are skipped; say so in the report.
The canonical full sequence will be `node --run verify` once task 0.6 lands;
when it exists, run it instead of the table.

`node --run` does not execute `pre`/`post` hooks: put every step inside the
script itself.

## Report

State which checks ran, which were skipped and why, and confirm that no test
was skipped or weakened.
