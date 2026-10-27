#!/usr/bin/env bash
# Whole local pipeline: setup -> transcripts -> scripts -> voices -> SFX -> music -> post-process.
# Every step skips what already exists, so it can be re-run after a failure.
set -uo pipefail
ROOT="${AUDIO_GEN_ROOT:-/Volumes/Externo Mac SSD/red-line-audio}"
export HF_HOME="$ROOT/hf" PYTORCH_ENABLE_MPS_FALLBACK=1
cd "$(dirname "$0")"
step() { echo "== $1 $(date +%T)"; shift; "$@" || echo "!! FAILED: $*"; }
step setup ./setup.sh
step transcribe "$ROOT/venv-voice/bin/python" transcribe.py
step lines "$ROOT/venv-voice/bin/python" write_lines.py
step voices "$ROOT/venv-voice/bin/python" gen_voice.py
step sfx "$ROOT/venv-sfx/bin/python" gen_sfx.py
CU="$HOME/.local/share/comfyui"
if ! curl -sf 127.0.0.1:8188/system_stats >/dev/null; then
  uv pip install -q -p "$CU/.venv/bin/python" -r "$CU/ComfyUI/requirements.txt"
  (cd "$CU/ComfyUI" && nohup "$CU/.venv/bin/python" main.py --listen 127.0.0.1 --port 8188 > "$ROOT/comfyui.log" 2>&1 &)
  for _ in $(seq 60); do curl -sf 127.0.0.1:8188/system_stats >/dev/null && break; sleep 5; done
fi
step music "$ROOT/venv-voice/bin/python" gen_music.py
step process "$ROOT/venv-voice/bin/python" process.py
echo "== DONE $(date +%T)"
