#!/usr/bin/env bash
# Local-only audio generation toolchain (spec 25 §4.5). Never runs in CI.
# Installs everything under $AUDIO_GEN_ROOT (default: the owner's external SSD).
set -euo pipefail
ROOT="${AUDIO_GEN_ROOT:-/Volumes/Externo Mac SSD/red-line-audio}"
export HF_HOME="$ROOT/hf"
mkdir -p "$ROOT"/{models,raw,hf,lines}
cd "$ROOT"

# SFX, UI, ambient: TangoFlux (text-to-audio, 44.1 kHz, ungated weights).
[ -x venv-sfx/bin/python ] || uv venv -q -p 3.11 venv-sfx
uv pip install -q -p venv-sfx/bin/python torch torchaudio transformers accelerate \
  sentencepiece soundfile pyyaml "git+https://github.com/declare-lab/TangoFlux"
venv-sfx/bin/python -c "from huggingface_hub import snapshot_download as s; s('declare-lab/TangoFlux'); s('google/flan-t5-large')"

# Voices: Piper TTS (uk_UA, ru_RU) + mlx-whisper to transcribe the reference lines.
[ -x venv-voice/bin/python ] || uv venv -q -p 3.11 venv-voice
uv pip install -q -p venv-voice/bin/python piper-tts mlx-whisper pyyaml huggingface_hub
venv-voice/bin/python - <<'PY'
from huggingface_hub import hf_hub_download as d
voices = ["uk/uk_UA/ukrainian_tts/medium/uk_UA-ukrainian_tts-medium",
          "ru/ru_RU/denis/medium/ru_RU-denis-medium", "ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium",
          "ru/ru_RU/ruslan/medium/ru_RU-ruslan-medium", "ru/ru_RU/irina/medium/ru_RU-irina-medium"]
for v in voices:
    for ext in (".onnx", ".onnx.json"):
        d("rhasspy/piper-voices", v + ext, local_dir="models/piper")
d("mlx-community/whisper-large-v3-turbo", "weights.safetensors")
d("mlx-community/whisper-large-v3-turbo", "config.json")
PY

# Music: ACE-Step v1 3.5B through the local ComfyUI.
CK="$ROOT/models/ace_step_v1_3.5b.safetensors"
[ -f "$CK" ] || venv-voice/bin/python -c "
from huggingface_hub import hf_hub_download as d; import shutil, os
p=d('Comfy-Org/ACE-Step_ComfyUI_repackaged','all_in_one/ace_step_v1_3.5b.safetensors'); shutil.move(os.path.realpath(p),'$CK')"
ln -sf "$CK" "$HOME/.local/share/comfyui/ComfyUI/models/checkpoints/ace_step_v1_3.5b.safetensors"
echo SETUP_OK
