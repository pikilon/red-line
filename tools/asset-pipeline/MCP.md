# ComfyUI MCP (local image generation for agents)

`comfy-mcp` (official, Comfy-Org, AGPL-3.0-or-later) exposes the machine-wide
ComfyUI (`~/.local/share/comfyui`, see `setup-comfyui.sh`) as MCP tools:
`generate_image`, `run_workflow`, `run_template`, `fetch_outputs`, `system_stats`,
`validate_workflow`, `search_models`... It is a stdio server and does not start
ComfyUI: run `comfyui` first (http://127.0.0.1:8188).

Install (once per machine): `node --run assets:comfyui:setup`, which also runs
`uv tool install comfy-cli comfy-mcp`, points `comfy` at the install and disables
its telemetry.

## Register it in a harness

The server entry is always the same: command `~/.local/bin/comfy-mcp`, env
`COMFY_BIN=~/.local/bin/comfy` and `DO_NOT_TRACK=1`.

* Claude Code: the repository's `.mcp.json` already has it (approve it on first use).
* OpenCode: add the same command and env under `mcp` in `~/.config/opencode/opencode.json`
  (`{"comfyui": {"type": "local", "command": ["/Users/<you>/.local/bin/comfy-mcp"], "environment": {...}}}`).
* DeepSeek Harness, Antigravity and others: register a stdio server with the same command and env
  in their own user-level MCP settings; do not add agent-specific files to the repository.

## Rules for agents (D-07, D-11)

* Local workflows only. Never call `partner_generate`, `list_partner_models`, `auth_login`
  or any partner-API node: they spend Comfy credits on remote infrastructure (D-11 needs the
  owner's confirmation for that run).
* Do not use `download_model` / `download` / `install_node` / `update_comfyui` without asking the
  owner: weights live on the external SSD (`RED_LINE_MODELS_DIR`), never in the Mac's disk or the repo.
* Output goes to `~/.local/share/comfyui/ComfyUI/output/`; copy only what a task needs into `assets/`
  and keep the model licence in `LICENSES.md` valid (CC BY-SA redistribution).
