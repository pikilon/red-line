#!/usr/bin/env bash
# Installs ComfyUI (local image generation, D-07) into tools/asset-pipeline/vendor.
# Nothing is committed: vendor/ and .venv/ are gitignored. Idempotent.
# Model weights are large: set RED_LINE_MODELS_DIR to a folder on an external
# disk (subfolders checkpoints/, unet/, vae/, clip/) and ComfyUI reads them there.
# Usage: [RED_LINE_MODELS_DIR=/path] node --run assets:comfyui:setup
set -euo pipefail

COMFYUI_TAG="v0.39.0"
PYTHON_VERSION="3.13"

here="$(cd "$(dirname "$0")" && pwd)"
vendor="$here/vendor"
venv="$here/.venv"

command -v uv >/dev/null 2>&1 || { echo "uv is required: brew install uv" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }

mkdir -p "$vendor"
if [ ! -d "$vendor/ComfyUI/.git" ]; then
  git clone --depth 1 --branch "$COMFYUI_TAG" https://github.com/comfyanonymous/ComfyUI.git "$vendor/ComfyUI"
else
  echo "ComfyUI already cloned at $vendor/ComfyUI ($(git -C "$vendor/ComfyUI" describe --tags --always))"
fi

if [ -n "${RED_LINE_MODELS_DIR:-}" ]; then
  mkdir -p "$RED_LINE_MODELS_DIR"/{checkpoints,unet,vae,clip}
  cat > "$vendor/ComfyUI/extra_model_paths.yaml" <<YAML
red_line_external:
  base_path: $RED_LINE_MODELS_DIR/
  checkpoints: checkpoints/
  unet: unet/
  diffusion_models: unet/
  vae: vae/
  clip: clip/
  text_encoders: clip/
YAML
fi

[ -d "$venv" ] || uv venv --python "$PYTHON_VERSION" "$venv"
# The default macOS arm64 PyTorch wheels include the MPS (Metal) backend.
uv pip install --python "$venv/bin/python" torch torchvision torchaudio
uv pip install --python "$venv/bin/python" -r "$vendor/ComfyUI/requirements.txt"

"$venv/bin/python" - <<'PY'
import torch
print(f"torch {torch.__version__}, MPS available: {torch.backends.mps.is_available()}")
raise SystemExit(0 if torch.backends.mps.is_available() else 1)
PY
echo "ComfyUI $COMFYUI_TAG ready. Start it with: node --run assets:comfyui"
