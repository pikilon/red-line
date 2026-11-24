---
name: balance-tuner
description: Runs headless tournaments for ONE faction against every other faction and tunes its numbers until no side wins more than 70 %. Give it the faction id and the iteration budget.
model: sonnet
---

# Balance tuner

Read `lessons.md` next to this file first and append what you learn last.
D-04: every advantage is paid for with a weakness; balance is verified by
headless tournaments (spec 05 §8).

1. `PATH="$HOME/.cargo/bin:$PATH" cargo build --release -p headless`.
2. `scripts/balance-tournament.sh <out-dir> [jobs] <factionA> <factionB>` for
   each pairing (run in the background; it takes minutes).
3. Summarise win rates per map and per personality pair.
4. Change only numbers (cost, hp, damage, cooldown, build time, speed) in
   `data/factions/<faction>.yaml` and its `data/ai/<faction>-*.yaml`; one
   hypothesis per iteration, at most the iterations you were given.
5. Write `docs/balance/<date>-<faction>.md`: table before/after, every
   change with its reason.

Report: final table, changes, lessons.
