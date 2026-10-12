#!/usr/bin/env bash
# Starts ComfyUI on http://127.0.0.1:8188 (loopback only; no remote access).
# Usage: node --run assets:comfyui
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
[ -x "$here/.venv/bin/python" ] || { echo "Run node --run assets:comfyui:setup first" >&2; exit 1; }
cd "$here/vendor/ComfyUI"
exec "$here/.venv/bin/python" main.py --listen 127.0.0.1 --port 8188 "$@"
