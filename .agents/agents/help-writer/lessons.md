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
### 2026-11-25 Copy USA saves with a type map, not by hand
Problem: seven China cards need about 23 saves that differ from the USA ones only by unit ids, the `armies` line and the id; hand-writing each one costs many tokens.
Fix: copy each `data/saves/help-us-<x>.yaml` with a short Python script that renames the `id:` line, the comment and the USA type ids (`us-ranger` to `cn-rifle-squad`, `us-humvee` to `cn-mengshi`...) and sets `armies: [china, russia]`. Then grep `type:` for any leftover `us-` (a power plant hid in one save).
### 2026-11-25 Card test stops at the first missing image
Problem: `cards.test.ts` "backs every shot with a recipe, a save and an image" reports only the first shot without `client/public/help/<shot>.jpg`, so a new card looks broken even when its recipes and saves are right.
Fix: check recipes and saves yourself (every `shots` id in the card has a `data/help` recipe whose `save` file exists) and report the missing images as "left for the coordinator's render" instead of retrying.
### 2026-11-25 Subagents cannot call the plan tool
Problem: `mcp__ccd_turn__update_plan` refuses inside a subagent ("you are a subagent"), so the first call of a run fails.
Fix: skip the plan tool in help-writer runs; report to the launcher in the final message.
### 2026-11-25 build:data rewrites unrelated tracked audio files
Problem: `node --run build:data` regenerates `data/audio/*.yaml`, `client/public/audio/manifest.json` and `data/generated/audio.json` from the China voice lines, which are not part of a help card. The diff looks like the help work touched them.
Fix: after `build:data`, run `git checkout --` on those audio files and keep only `data/generated/saves.json` (it lists the help saves). Check the files you touched with `git status`.
### 2026-11-25 Batch the seven China cards with one generator script
Problem: writing 7 cards by hand (JSON, recipes, about 32 saves) costs many tool calls and copy errors.
Fix: write one Python script in the scratch directory with a dict per type (cards, recipe rows, save entities) and emit the JSON, yaml recipes and saves together. Then run `npx biome check --write` on the JSON and a Python check that every shot in a card has a recipe and every recipe's save exists.
### 2026-11-25 Card text must follow data, even where the spec disagrees
Problem: spec 56 says the Gattling nest fires at "low air", but `data/factions/china.yaml` gives `cn-gattling-post` no `antiAir` key, so the sim cannot hit aircraft. A card that claims air fire would be false.
Fix: write what the data does (no air fire, listed under weak) and report the spec/data conflict to the launcher so the owner can pick one.

### 2026-11-25 Order targets copied from a template save
Problem: China saves kept `order: { board: kozak }` from the template while the vehicle was labelled `mengshi`; the scene never got ready and help:shots timed out after 60 s.
Fix: after copying a save, make every order target (`board`, `garrison`, ...) match a `label:` in the same file; a shot timeout usually means a broken save, not broken tooling.
