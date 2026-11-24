# help-writer lessons

Read before starting; append new entries last (format in `.agents/workflows/faction-assembly.md`).

### 2026-11-24 Save faction comes from the map, not the save
Problem: a help save with a USA unit as player 0 fails `build:data` ("not of player 0's faction") because `starts` is a boolean and player 0 takes the map's start faction (showcase is Ukraine vs Russia).
Fix: add a `<map>-usa` copy of the source map (id line and first start `faction: usa`), list it in `data/rules/globals.yaml` maps, and point the USA saves' `map:` at it. Russian saves stay on player 1 of showcase.
### 2026-11-24 help:shots readiness timeout on this machine
Problem: `node --run help:shots -- --type <id>` times out at `waitForFunction` (isReady) for every save, even the Ukrainian control `ua-leopard-2a4`, so the tool is broken here, not the new card.
Fix: run one known Ukrainian card first as a control. If it fails too, skip shots, remove `shots` from the JSON sections (the test allows sections without shots), keep the recipes in `data/help/`, and report it. Re-render later.
### 2026-11-24 Shared saves do not carry a type prefix
Problem: a section's save (e.g. `vehicle-repair`) has no `help-ua-` prefix, so a prefix-only copy misses it, and its `id:` line and types still say ua.
Fix: copy it to `help-<new-id>-<shot>.yaml`, rewrite its `id:` line to match the file name, and map every `ua-` type (leopard-2a4, bradley...) to its USA type.
