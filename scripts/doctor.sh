#!/usr/bin/env bash
# Checks the local toolchain per work area. Exit code 1 if a required tool is missing.
# Usage: scripts/doctor.sh
set -uo pipefail

missing=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; missing=1; }

need() { # need <label> <command> [required|optional]
  if command -v "$2" >/dev/null 2>&1; then ok "$1 ($("$2" --version 2>/dev/null | head -1))"
  elif [ "${3:-required}" = required ]; then bad "$1 missing: $2"
  else warn "$1 missing (optional): $2"; fi
}

echo "Core"
need "git" git
need "GitHub CLI" gh
need "Node" node
need "npm" npm
need "Rust compiler" rustc
need "Cargo" cargo
need "wasm-pack" wasm-pack
need "cargo-nextest" cargo-nextest
rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown \
  && ok "rust target wasm32-unknown-unknown" || bad "rust target missing: rustup target add wasm32-unknown-unknown"

echo "Identity"
email="$(git config user.email || true)"
[ "$email" = "pikilon@gmail.com" ] && ok "git user.email = $email" \
  || bad "git user.email is '$email'; run: git config user.email pikilon@gmail.com"
login="$(gh api user --jq .login 2>/dev/null || true)"
[ "$login" = "pikilon" ] && ok "gh acts as pikilon" \
  || bad "gh acts as '${login:-nobody}'; the owner must log in as pikilon"

echo "Assets and local AI (optional per area)"
need "Blender" blender optional
need "ffmpeg" ffmpeg optional
need "uv (Python)" uv optional
need "LM Studio CLI" lms optional
need "OpenCode" opencode optional
curl -fsS -m 2 http://127.0.0.1:1234/v1/models >/dev/null 2>&1 \
  && ok "LM Studio server reachable on :1234" || warn "LM Studio server not running on :1234"

exit "$missing"
