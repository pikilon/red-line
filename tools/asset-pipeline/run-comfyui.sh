#!/usr/bin/env bash
# Starts the machine-wide ComfyUI on http://127.0.0.1:8188 (loopback only).
# Usage: node --run assets:comfyui
set -euo pipefail

command -v comfyui >/dev/null 2>&1 || { echo "Run node --run assets:comfyui:setup first" >&2; exit 1; }
exec comfyui "$@"
