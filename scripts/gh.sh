#!/usr/bin/env bash
# Runs the GitHub CLI as the project owner account, whatever account is active.
# Usage: scripts/gh.sh <gh arguments>   e.g. scripts/gh.sh issue list
set -euo pipefail

readonly GH_ACCOUNT="pikilon"

# Export the owner's token: every `gh` call then acts as that account without
# moving the active token. `gh auth switch` is not used because it fails when the
# active token lives in the macOS keyring ("failed to move active token in
# keyring: exit status 161"), which left the tool unusable even with the owner
# already logged in.
token="$(gh auth token --hostname github.com --user "$GH_ACCOUNT" 2>/dev/null)" || token=""
if [ -z "$token" ]; then
  echo "scripts/gh.sh: account '$GH_ACCOUNT' is not logged in. Ask the owner to run: gh auth login" >&2
  exit 1
fi
export GH_TOKEN="$token"

exec gh "$@"
