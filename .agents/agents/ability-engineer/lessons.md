# ability-engineer lessons

Read before starting; append new entries last (format in `.agents/workflows/faction-assembly.md`).

### 2026-11-24 Zero Hour INI data is not mounted
Problem: `generals-precedent` cannot read INIZH.big (`GENERALS_GAME_DIR` unset), so its numbers come from memory.
Fix: copy the behaviour it describes, take numbers relative to our existing Ukraine/Russia data, and say so in the spec.

### 2026-11-24 Stop missiles, not shells: tag the weapon
Problem: Abrams shells and Javelins are both `antiTank`, so a damage-type filter would also stop shells.
Fix: weapon flag `interceptable` (missiles/rockets) plus the type filter `stops`; reuse `Entity::reload` as the countdown for non-sortie types. Tests of buildings need a powered owner (add a power plant).
