---
name: test-saves
description: Create, run or import example saves (prepared test scenes) and use them in tests and owner test steps. Use when a feature needs a specific situation to test, when writing e2e or sim tests, when writing needs-owner-test steps, or when the owner pastes a save.
---

# Example Saves

Spec: `specs/19-save-games.md`. Example saves are prepared matches the game
opens with `?load=<id>`. They are listed in `data/rules/globals.yaml`
(`saves:`) and named in `client/src/i18n/en.json`
(`saves.<id>.name` and `.description`).

## Commands (one short line per save, any harness)

* `node --run saves:list`: id, map, form, entity count and the `?load=` URL.
* `node --run saves:run -- <id|path> [ticks]`: runs the save headless
  (default 900 ticks) and prints one JSON line: tick, outcome, state hash
  and, per player, credits, units, buildings and power.
* `node --run saves:import -- <file|-> <id> [--force]`: imports a save the
  owner copied with the Copy button of the save manager (paste it into a
  file, or pipe it on stdin with `-`).

## Writing a setup-form example (`data/saves/<id>.yaml`)

```yaml
id: tank-column            # equals the file name; never "slot-*"
map: showcase              # showcase (100x40, open) or first-line (128x128)
victory: false
debug: true
starts: false              # true: each start's HQ and dozer (labels hq-0, dozer-0...)
credits: [20000, 20000]    # optional
ai: []                     # [{ player: 1, personality: russia-rush, active: true }]
client: { controlled: 0, revealed: true, camera: { x: 45, y: 20, zoom: 1 } }
entities:
  - { player: 0, type: ua-leopard-2a4, atCenti: [4450, 2050], label: leo }
  - { player: 1, type: ru-t-72b3, atCenti: [5050, 2050], order: { attack: leo } }
  - { player: 0, type: ua-barracks, origin: [10, 4], buildPercent: 40, hpPercent: 60 }
```

* Units take `atCenti` (centi-tiles); buildings take `origin` (cell).
* Orders: `attack: <label>`, `moveCenti: [x, y]`, `harvest: depot-<i>`.
* Map depots have the labels `depot-0`, `depot-1`, and so on.
* Units fire at any visible enemy in range, even while moving. An attack
  order on a target the attacker cannot see is dropped. Keep attackers
  within sight, or use `moveCenti` and let them engage.
* Then: add the id to `saves:` in `globals.yaml`, add the two i18n keys, run
  `node --run build:data`, and add a native contract to
  `crates/sim/tests/example_saves.rs` (`ac_19_14_<id>`).

## Rules

* E2E tests that need a prepared situation load an example
  (`page.goto("/?load=<id>")`) instead of issuing `debugSpawn` commands.
* Rust tests load one with `crates/sim/tests/common/saves.rs::load_example`.
* Each manual step of a `needs-owner-test` comment that needs more than a
  fresh skirmish uses a `?load=<id>` URL. When no example fits, the PR adds
  one.
* A pasted save goes through `saves:import`. Then write its description in
  `en.json`, and add a contract test when a test depends on it.
