#!/usr/bin/env bash
# Runs the GitHub CLI as the project owner account, whatever account is active.
# Usage: scripts/gh.sh <gh arguments>   e.g. scripts/gh.sh issue list
set -euo pipefail

readonly GH_ACCOUNT="pikilon"

# Only attempt a switch if the target account is not already active. Newer gh
# versions fail to move tokens in the macOS keyring ("exit status 161") even
# when the account is already active, which would make this script unusable.
if ! gh auth status --hostname github.com 2>/dev/null | grep -qi "Logged in to github.com account .*${GH_ACCOUNT}"; then
  gh auth switch --hostname github.com --user "$GH_ACCOUNT" >/dev/null 2>&1 || {
    echo "scripts/gh.sh: account '$GH_ACCOUNT' is not logged in. Ask the owner to run: gh auth login" >&2
    exit 1
  }
fi

exec gh "$@"
