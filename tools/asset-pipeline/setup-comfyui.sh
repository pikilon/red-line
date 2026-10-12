#!/usr/bin/env bash
# Installs ComfyUI (local image generation, D-07) machine-wide, outside the
# repository, so other projects and agents can use it too:
#   $COMFYUI_HOME  (default ~/.local/share/comfyui)  code + Python venv
#   ~/.local/bin/comfyui                               launcher (on PATH)
# Model weights are large: set RED_LINE_MODELS_DIR to a folder on an external
# disk (subfolders checkpoints/, unet/, vae/, clip/) and ComfyUI reads them there.
# Idempotent. Usage: [RED_LINE_MODELS_DIR=/path] node --run assets:comfyui:setup
set -euo pipefail

COMFYUI_TAG="v0.39.0"
PYTHON_VERSION="3.13"
home="${COMFYUI_HOME:-$HOME/.local/share/comfyui}"
bin_dir="$HOME/.local/bin"

command -v uv >/dev/null 2>&1 || { echo "uv is required: brew install uv" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }

mkdir -p "$home" "$bin_dir"
if [ ! -d "$home/ComfyUI/.git" ]; then
  git clone --depth 1 --branch "$COMFYUI_TAG" https://github.com/comfyanonymous/ComfyUI.git "$home/ComfyUI"
else
  echo "ComfyUI already cloned at $home/ComfyUI ($(git -C "$home/ComfyUI" describe --tags --always))"
fi

if [ -n "${RED_LINE_MODELS_DIR:-}" ]; then
  mkdir -p "$RED_LINE_MODELS_DIR"/{checkpoints,unet,vae,clip}
  cat > "$home/ComfyUI/extra_model_paths.yaml" <<YAML
external_models:
  base_path: $RED_LINE_MODELS_DIR/
  checkpoints: checkpoints/
  unet: unet/
  diffusion_models: unet/
  vae: vae/
  clip: clip/
  text_encoders: clip/
YAML
fi

[ -d "$home/.venv" ] || uv venv --python "$PYTHON_VERSION" "$home/.venv"
# The default macOS arm64 PyTorch wheels include the MPS (Metal) backend.
uv pip install --python "$home/.venv/bin/python" torch torchvision torchaudio
uv pip install --python "$home/.venv/bin/python" -r "$home/ComfyUI/requirements.txt"

"$home/.venv/bin/python" - <<'PY'
import torch
print(f"torch {torch.__version__}, MPS available: {torch.backends.mps.is_available()}")
raise SystemExit(0 if torch.backends.mps.is_available() else 1)
PY

# MCP bridge for agents (see MCP.md): comfy-cli drives the install, comfy-mcp serves it.
uv tool install "comfy-cli>=1.14.0"
uv tool install comfy-mcp
DO_NOT_TRACK=1 "$bin_dir/comfy" tracking disable >/dev/null
DO_NOT_TRACK=1 "$bin_dir/comfy" set-default "$home/ComfyUI" >/dev/null

cat > "$bin_dir/comfyui" <<LAUNCHER
#!/usr/bin/env bash
# Starts ComfyUI on http://127.0.0.1:8188 (loopback only). Extra arguments go to ComfyUI.
cd "$home/ComfyUI"
exec "$home/.venv/bin/python" main.py --listen 127.0.0.1 --port 8188 "\$@"
LAUNCHER
chmod +x "$bin_dir/comfyui"
echo "ComfyUI $COMFYUI_TAG ready in $home. Start it with: comfyui"
