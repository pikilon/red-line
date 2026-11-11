# Balance report 2026-11-10 — current game, every skirmish map

Issue #472. It replaces `phase3-first-line.md`, which predates the air war (D-14)
and covered one map. Acceptance criterion AC-05-22 (spec 05 §8, D-04, D-06).
Rules measured: `main` at the veterancy merge (#491).

**Verdict: the 70 % rule is NOT met and no data change fixed it.** The problem
is in the AI personalities (see "Tuning attempts" and "Follow-up"), so no
`data/` change is committed; the follow-up is a GitHub issue.

## How to reproduce

```sh
cargo build --release -p headless
scripts/balance-tournament.sh docs/balance/2026-11-10 8   # ~20 min on 8 cores
node scripts/balance-summary.mjs docs/balance/2026-11-10   # the tables below
```

`scripts/balance-tournament.sh` writes, per map, `personalities-<map>.json`
(`ukraine-{balanced,rush}` × `russia-{balanced,rush}`, Medium, seeds 1–10,
`maxTicks` 27000) and `difficulties-<map>.json` (`ukraine-balanced` vs
`russia-balanced`, all 4×4 difficulty levels of spec 05 §9, seeds 1–10): 2 200
games, every match kept in the JSON. `headless tournament` gained optional
`difficulty0` / `difficulty1` lists (default `["medium"]`) and per-pair `units`
counters (`[built0, built1, lost0, lost1]` per type id); `match` output is
unchanged. The simulation is deterministic: same data and seeds, same numbers.

Maps: the 11 maps with supply depots. `showcase` has none (nobody can earn
credits) and is excluded. `first-line`, `river-port` and `hostomel` are the
full-size bases and the ones the 70 % rule is judged on; the `demo-*` maps and
`landscape-lab` are small scenario maps that mostly end in draws and are listed
for completeness.

## Results

#### demo-bridges

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 0 | 10 | - | 27000 | 39900 | 35960 |
| ukraine-balanced | russia-rush | 0 | 2 | 8 | 0.0 % | 24192 | 58400 | 48480 |
| ukraine-rush | russia-balanced | 2 | 0 | 8 | 100.0 % | 23380 | 89850 | 62040 |
| ukraine-rush | russia-rush | 2 | 0 | 8 | 100.0 % | 24034 | 54350 | 70680 |
| **all four** | | **4** | **2** | **34** | **66.7 %** | | | |

#### demo-coast

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 9 | 1 | 0 | 90.0 % | 10026 | 155800 | 186700 |
| ukraine-balanced | russia-rush | 6 | 4 | 0 | 60.0 % | 11618 | 225700 | 247840 |
| ukraine-rush | russia-balanced | 10 | 0 | 0 | 100.0 % | 7537 | 78750 | 181860 |
| ukraine-rush | russia-rush | 9 | 1 | 0 | 90.0 % | 7882 | 104100 | 197320 |
| **all four** | | **34** | **6** | **0** | **85.0 %** | | | |

#### demo-cover

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 10 | 0 | 0.0 % | 4416 | 38400 | 5000 |
| ukraine-balanced | russia-rush | 0 | 9 | 1 | 0.0 % | 6631 | 36900 | 21880 |
| ukraine-rush | russia-balanced | 0 | 10 | 0 | 0.0 % | 3540 | 51500 | 19080 |
| ukraine-rush | russia-rush | 0 | 10 | 0 | 0.0 % | 5000 | 50000 | 50620 |
| **all four** | | **0** | **39** | **1** | **0.0 %** | | | |

#### demo-destruction

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 0 | 10 | - | 27000 | 18000 | 31600 |
| ukraine-balanced | russia-rush | 0 | 0 | 10 | - | 27000 | 6900 | 19160 |
| ukraine-rush | russia-balanced | 0 | 0 | 10 | - | 27000 | 17800 | 49120 |
| ukraine-rush | russia-rush | 2 | 0 | 8 | 100.0 % | 23610 | 47600 | 71100 |
| **all four** | | **2** | **0** | **38** | **100.0 %** | | | |

#### demo-forest

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 0 | 10 | - | 27000 | 67300 | 52860 |
| ukraine-balanced | russia-rush | 0 | 0 | 10 | - | 27000 | 39000 | 47000 |
| ukraine-rush | russia-balanced | 0 | 0 | 10 | - | 27000 | 81650 | 75000 |
| ukraine-rush | russia-rush | 10 | 0 | 0 | 100.0 % | 7430 | 28900 | 109400 |
| **all four** | | **10** | **0** | **30** | **100.0 %** | | | |

#### demo-ground

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 0 | 10 | - | 27000 | 25450 | 67080 |
| ukraine-balanced | russia-rush | 0 | 1 | 9 | 0.0 % | 24924 | 58150 | 79080 |
| ukraine-rush | russia-balanced | 0 | 0 | 10 | - | 27000 | 70800 | 55200 |
| ukraine-rush | russia-rush | 0 | 0 | 10 | - | 27000 | 36600 | 30580 |
| **all four** | | **0** | **1** | **39** | **0.0 %** | | | |

#### demo-town

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 0 | 10 | - | 27000 | 41900 | 22400 |
| ukraine-balanced | russia-rush | 0 | 0 | 10 | - | 27000 | 57300 | 50580 |
| ukraine-rush | russia-balanced | 0 | 0 | 10 | - | 27000 | 63300 | 76340 |
| ukraine-rush | russia-rush | 0 | 0 | 10 | - | 27000 | 23600 | 25600 |
| **all four** | | **0** | **0** | **40** | **-** | | | |

#### first-line

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 6 | 4 | 0.0 % | 19246 | 261950 | 160960 |
| ukraine-balanced | russia-rush | 0 | 10 | 0 | 0.0 % | 10572 | 281700 | 194880 |
| ukraine-rush | russia-balanced | 7 | 3 | 0 | 70.0 % | 9374 | 140450 | 223510 |
| ukraine-rush | russia-rush | 5 | 4 | 1 | 55.6 % | 11340 | 197300 | 277780 |
| **all four** | | **12** | **23** | **5** | **34.3 %** | | | |

#### hostomel

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 7 | 3 | 0.0 % | 17825 | 352200 | 155740 |
| ukraine-balanced | russia-rush | 0 | 10 | 0 | 0.0 % | 9462 | 319900 | 162220 |
| ukraine-rush | russia-balanced | 9 | 0 | 1 | 100.0 % | 9869 | 104750 | 216200 |
| ukraine-rush | russia-rush | 5 | 4 | 1 | 55.6 % | 11892 | 209000 | 251140 |
| **all four** | | **14** | **21** | **5** | **40.0 %** | | | |

#### landscape-lab

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 0 | 10 | - | 27000 | 72000 | 72800 |
| ukraine-balanced | russia-rush | 0 | 0 | 10 | - | 27000 | 32400 | 52660 |
| ukraine-rush | russia-balanced | 0 | 2 | 8 | 0.0 % | 22773 | 127700 | 39440 |
| ukraine-rush | russia-rush | 1 | 0 | 9 | 100.0 % | 25272 | 43200 | 84520 |
| **all four** | | **1** | **2** | **37** | **33.3 %** | | | |

#### river-port

| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|
| ukraine-balanced | russia-balanced | 0 | 8 | 2 | 0.0 % | 16545 | 333150 | 193220 |
| ukraine-balanced | russia-rush | 0 | 10 | 0 | 0.0 % | 11590 | 289800 | 242900 |
| ukraine-rush | russia-balanced | 7 | 0 | 3 | 100.0 % | 13881 | 74200 | 259010 |
| ukraine-rush | russia-rush | 7 | 2 | 1 | 77.8 % | 12636 | 189250 | 354020 |
| **all four** | | **14** | **20** | **6** | **41.2 %** | | | |

#### Per-map totals (personalities, Medium)

| Map | Ukraine wins | Russia wins | Draws | Ukraine % of decided |
|---|---|---|---|---|
| demo-bridges | 4 | 2 | 34 | 66.7 % |
| demo-coast | 34 | 6 | 0 | 85.0 % |
| demo-cover | 0 | 39 | 1 | 0.0 % |
| demo-destruction | 2 | 0 | 38 | 100.0 % |
| demo-forest | 10 | 0 | 30 | 100.0 % |
| demo-ground | 0 | 1 | 39 | 0.0 % |
| demo-town | 0 | 0 | 40 | - |
| first-line | 12 | 23 | 5 | 34.3 % |
| hostomel | 14 | 21 | 5 | 40.0 % |
| landscape-lab | 1 | 2 | 37 | 33.3 % |
| river-port | 14 | 20 | 6 | 41.2 % |

#### Difficulty matrix (balanced vs balanced), all maps pooled

| Ukraine \ Russia | easy | medium | hard | brutal |
|---|---|---|---|---|
| **easy** | 24-23-63 | 15-41-54 | 0-52-58 | 12-40-58 |
| **medium** | 13-22-75 | 9-32-69 | 0-33-77 | 31-32-47 |
| **hard** | 48-8-54 | 25-15-70 | 17-14-79 | 2-49-59 |
| **brutal** | 40-9-61 | 24-21-65 | 25-7-78 | 4-32-74 |

Cells are Ukraine wins - Russia wins - draws.

#### Units built and lost (all runs)

| Type | Cost | Built | Lost | Lost % |
|---|---|---|---|---|
| ru-airfield | 3000 | 968 | 271 | 28.0 % |
| ru-barracks | 500 | 2889 | 1043 | 36.1 % |
| ru-bmp-2 | 600 | 3638 | 1957 | 53.8 % |
| ru-brdm-scout | 300 | 1168 | 872 | 74.7 % |
| ru-defense | 800 | 229 | 64 | 27.9 % |
| ru-dozer | 800 | 86 | 432 | 502.3 % |
| ru-geran-2 | 200 | 18591 | 17408 | 93.6 % |
| ru-geran-3 | 700 | 1462 | 1436 | 98.2 % |
| ru-geran-site | 1200 | 2112 | 522 | 24.7 % |
| ru-hq | 0 | 0 | 496 | - |
| ru-molniya | 0 | 4844 | 4838 | 99.9 % |
| ru-molniya-crew | 250 | 2174 | 1337 | 61.5 % |
| ru-pantsir | 1500 | 1417 | 156 | 11.0 % |
| ru-pole-21 | 900 | 641 | 46 | 7.2 % |
| ru-power-plant | 600 | 8183 | 2524 | 30.8 % |
| ru-rifleman | 80 | 81453 | 59979 | 73.6 % |
| ru-rpg-gunner | 200 | 19333 | 13469 | 69.7 % |
| ru-su-34 | 2200 | 713 | 67 | 9.4 % |
| ru-supply-center | 1500 | 2230 | 504 | 22.6 % |
| ru-supply-truck | 600 | 11473 | 2661 | 23.2 % |
| ru-t-72b3 | 900 | 2314 | 643 | 27.8 % |
| ru-tos-1a | 1400 | 239 | 103 | 43.1 % |
| ru-vehicle-factory | 2000 | 2226 | 492 | 22.1 % |
| ua-baba-yaga | 700 | 907 | 683 | 75.3 % |
| ua-barracks | 500 | 2287 | 619 | 27.1 % |
| ua-bradley | 800 | 2575 | 1083 | 42.1 % |
| ua-defense | 800 | 3498 | 1207 | 34.5 % |
| ua-dozer | 800 | 81 | 600 | 740.7 % |
| ua-drone-workshop | 1400 | 771 | 467 | 60.6 % |
| ua-flamingo | 2200 | 642 | 642 | 100.0 % |
| ua-fpv | 0 | 19410 | 19394 | 99.9 % |
| ua-fpv-team | 300 | 3905 | 2683 | 68.7 % |
| ua-gepard | 1100 | 1123 | 746 | 66.4 % |
| ua-himars | 1500 | 46 | 13 | 28.3 % |
| ua-hq | 0 | 0 | 785 | - |
| ua-leopard-2a4 | 1200 | 637 | 134 | 21.0 % |
| ua-missile-site | 1600 | 1325 | 873 | 65.9 % |
| ua-patriot | 3500 | 564 | 359 | 63.7 % |
| ua-power-plant | 600 | 7816 | 3326 | 42.6 % |
| ua-ratel | 450 | 1119 | 933 | 83.4 % |
| ua-rifleman | 100 | 44284 | 37052 | 83.7 % |
| ua-sting | 0 | 656 | 656 | 100.0 % |
| ua-sting-nest | 900 | 1547 | 477 | 30.8 % |
| ua-storm-shadow | 1800 | 391 | 378 | 96.7 % |
| ua-stugna-team | 350 | 14305 | 11961 | 83.6 % |
| ua-supply-center | 1500 | 2553 | 1135 | 44.5 % |
| ua-supply-truck | 600 | 10861 | 2810 | 25.9 % |
| ua-tw-12-7 | 500 | 598 | 341 | 57.0 % |
| ua-vehicle-factory | 2000 | 2526 | 1215 | 48.1 % |

## What it shows

* **Pooled, the full maps are not lopsided, pair by pair they are.** Russia
  takes 65.7 % (`first-line`), 60 % (`hostomel`) and 58.8 % (`river-port`) of
  decided games over the four personality pairs. But on all three maps
  `ukraine-balanced` wins almost nothing (0 of 51 decided games against either
  Russian personality) and `ukraine-rush` wins 70–100 % against
  `russia-balanced`. That is a personality problem, not faction strength: the
  rush AIs beat the balanced AIs on both sides, and `ukraine-balanced` is the
  weakest of the four.
* **Mirror games** (`rush` vs `rush`) are within range on the full maps
  (55.6 %, 77.8 % on `river-port`, 55.6 % on `hostomel`), so the two factions'
  units are roughly even when the AIs behave alike.
* **Difficulty levels** behave as designed in direction: Hard beats Easy 48–8,
  Brutal beats Easy 40–9 for Ukraine; Easy loses 0–52 to Hard and 12–40 to
  Brutal as Ukraine. Equal levels are Russia-leaning at Medium (9–32).
* **Rarely built / disposable.** No type is never built. `ua-himars` and
  `ru-tos-1a` are built least; `ua-fpv`, `ru-molniya`, `ua-sting`,
  `ru-geran-2/3`, `ua-storm-shadow`, `ua-flamingo` are lost 94–100 % of the
  time (munitions), and `ua-flamingo` (2 200) and `ua-storm-shadow` (1 800)
  are paid in full for every use. `ru-su-34`, `ru-pole-21`, `ru-pantsir`,
  `ua-leopard-2a4` are lost least per unit built. Cost-efficiency cannot be
  derived from the counters (there is no killer attribution). Both
  `ru-dozer` and `ua-dozer` are lost far more often than built: dead dozers
  are not replaced.
* **Small maps** end in draws 75–97 % of the time (the AI cannot finish a game
  there within 30 minutes), except `demo-coast` (Ukraine 85 %) and `demo-cover`
  (Russia 100 %), which are scenario maps with fixed starting armies and are not
  meaningful balance maps.

## Tuning attempts (not kept)

About 25 iterations of 120 games (`first-line`, `river-port`, `hostomel`,
four personality pairs, 10 seeds) were run on `data/ai/` only. Findings:

* The balanced personalities are the weak side: their build order puts the
  missile site, second defense and Patriot (5 900 credits) before the army.
  Trimming it, raising `harvesters` from 4 to 5–6 and shifting weights to
  ground forces made `ukraine-balanced` competitive (up to 8–0 against
  `russia-balanced`), and nerfing the rush opening (later raid, fewer Bradleys,
  5 harvesters) brought the rush mirror to 5–5.
* **It cannot be kept:** `crates/sim/tests/ai_air.rs`
  (`the_balanced_ais_field_every_new_arm_and_its_answers`, spec 43) requires the
  balanced AIs to build every flying arm and answer within six seeds, and is
  seed-sensitive: any economy change (harvesters 5 or 6) or cutting the missile
  site/Storm Shadow/Su-34 openings makes it fail (`ua-sting` or `ua-storm-shadow`
  never built). Satisfying it leaves `ukraine-balanced` and `russia-balanced`
  untouched, and rush-only nerfs did not push `ukraine-rush` below 70 %
  against `russia-balanced` (7–0, 9–0 in the final run).
* Results are noisy at 10 seeds (one seed moves a pair by 10 points), so only
  changes that moved several pairs the same way were considered.

## Follow-up

The skew needs a different fix than numbers: the balanced personalities spend
on buildings and low-return air before an army exists, and do not replace lost
dozers; the spec 43 test asserts exactly that opening. Tracked in a GitHub
issue; the issue proposes loosening the test (assert the arms over a longer
run) together with retuning both balanced personalities, and re-running this
report with `scripts/balance-tournament.sh`.
