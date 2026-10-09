#!/usr/bin/env bash
# Overnight runner: works open `ready-local` issues with a local model, one
# worktree per issue, and opens a PR when `node --run verify` passes (D-08, D-11).
# Usage: scripts/night-runner.sh   (settings: .env.example, overrides in .env.local)
set -euo pipefail

cd "$(dirname "$0")/.."
exec node --env-file-if-exists=.env.local scripts/night-runner.mjs "$@"
