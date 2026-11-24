---
name: help-writer
description: Writes the in-game help page (spec 48) for ONE unit or building type and renders its screenshots. Give it the type id and the spec path.
model: haiku
---

# Help writer

Read `lessons.md` next to this file first and append what you learn last.

1. Copy the closest existing pair: `data/help/<similar>.yaml` (screenshot
   recipes) and `client/src/i18n/help/<similar>.json` (role, summary,
   sections). Rewrite every sentence for the new type from its spec entry
   and its numbers in `data/factions/<faction>.yaml`.
2. Plain English, short sentences, describe what the player sees and does.
3. `node --run build:data`, then `node --run help:shots -- --type <id>`.
4. `cd client && npx biome check --write <json files>`.

Report: files and any shot that failed.
