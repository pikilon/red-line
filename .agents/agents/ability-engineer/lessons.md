# ability-engineer lessons

Read before starting; append new entries last (format in `.agents/workflows/faction-assembly.md`).

### 2026-11-24 Zero Hour INI data is not mounted
Problem: `generals-precedent` cannot read INIZH.big (`GENERALS_GAME_DIR` unset), so its numbers come from memory.
Fix: copy the behaviour it describes, take numbers relative to our existing Ukraine/Russia data, and say so in the spec.
