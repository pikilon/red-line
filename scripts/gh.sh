#!/usr/bin/env bash
# Runs the GitHub CLI as the project owner account, whatever account is active.
# Usage: scripts/gh.sh <gh arguments>   e.g. scripts/gh.sh issue list
set -euo pipefail

readonly GH_ACCOUNT="pikilon"

gh auth switch --hostname github.com --user "$GH_ACCOUNT" >/dev/null 2>&1 || {
  echo "scripts/gh.sh: account '$GH_ACCOUNT' is not logged in. Ask the owner to run: gh auth login" >&2
  exit 1
}

exec gh "$@"
