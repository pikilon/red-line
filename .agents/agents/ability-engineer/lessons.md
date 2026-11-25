# ability-engineer lessons

Read before starting; append new entries last (format in `.agents/workflows/faction-assembly.md`).

### 2026-11-24 Zero Hour INI data is not mounted
Problem: `generals-precedent` cannot read INIZH.big (`GENERALS_GAME_DIR` unset), so its numbers come from memory.
Fix: copy the behaviour it describes, take numbers relative to our existing Ukraine/Russia data, and say so in the spec.

### 2026-11-24 Stop missiles, not shells: tag the weapon
Problem: Abrams shells and Javelins are both `antiTank`, so a damage-type filter would also stop shells.
Fix: weapon flag `interceptable` (missiles/rockets) plus the type filter `stops`; reuse `Entity::reload` as the countdown for non-sortie types. Tests of buildings need a powered owner (add a power plant).

### 2026-11-25 New order/command/entity field touches ~10 files
Problem: a new `Order`, `Command` or `Entity` field must be added to hash.rs, save.rs (both state enums plus both conversions, entity field with `skip_serializing_if`), world.rs, economy.rs and reload.rs order lists, wasm_api, and the client `SkirmishSimLike` mocks in workerHandler/combatSnapshot tests.
Fix: reuse `garrison_goal` for walk-to-building orders; grep `Order::Repair` to find every site. `skirmish_with` is crate-private, so garrison tests live in `garrison.rs`; put new impl blocks before `mod tests` (clippy).

### 2026-11-25 Passive per-unit bonus: flag on Entity, applied in rank_weapon
Problem: a group bonus (horde) needs state (rub-off hysteresis), so it cannot be derived on demand.
Fix: `Entity` bool recomputed each tick in its own module (before `update_combat`), hashed as an optional tagged byte, saved with `skip_serializing_if`, exposed as a snapshot flag bit (next free: 2048). Apply it to the cooldown in `veterancy::rank_weapon`; let upgrades scale it through a new `UpgradeDef` percent and `upgraded()`. Crate-private methods (`rank_weapon`, `entities`) are testable only from in-module tests. Tool sandbox rejects long compound shell commands: use Write for files and run python scripts from a file.
