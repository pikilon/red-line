# Phase 3 first-line balance report (AC-05-22)

Balance is measured by bot-vs-bot tournaments with several AI personalities
(docs/decisions.md D-06). This report covers the four builtin personalities on
the `first-line` map: `ukraine-balanced`, `ukraine-rush`, `russia-balanced` and
`russia-rush` (specs/05-phase3-computer-ai.md §4.3).

Target: for every personality pair, neither side wins more than 70 % of the
decided (non-draw) games.

## Reproduce

Build the headless runner and write the tournament config:

```sh
cargo build --release -p headless
cat > /tmp/tournament-first-line.json <<'JSON'
{"map":"first-line","maxTicks":27000,"seeds":[1,2,3,4,5,6,7,8,9,10],"ai0":["ukraine-balanced","ukraine-rush"],"ai1":["russia-balanced","russia-rush"]}
JSON
./target/release/headless tournament /tmp/tournament-first-line.json
```

The command prints one JSON object with the 40 matches and the four summary
rows; `docs/balance/tournament-first-line.json` holds that same report
(pretty-printed).

Player 0 is Ukraine and player 1 is Russia on `first-line`. Matches run to a
winner or `maxTicks = 27000` (a draw/timeout).

## Summary

| # | ai0 | ai1 | games | wins0 | wins1 | draws | decided | win0 % | win1 % | avg ticks | lost0 | lost1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ukraine-balanced | russia-balanced | 10 | 2 | 3 | 5 | 5 | 40.0 | 60.0 | 19758 | 289700 | 266420 |
| 2 | ukraine-balanced | russia-rush | 10 | 6 | 4 | 0 | 10 | 60.0 | 40.0 | 10153 | 192050 | 152620 |
| 3 | ukraine-rush | russia-balanced | 10 | 4 | 4 | 2 | 8 | 50.0 | 50.0 | 15112 | 201500 | 189020 |
| 4 | ukraine-rush | russia-rush | 10 | 4 | 6 | 0 | 10 | 40.0 | 60.0 | 9614 | 142000 | 105060 |

Percentages are over decided games (`wins0 + wins1`); `avg ticks` is integer
division and `lost*` is the summed cost of the entities each side lost over the
ten seeds. The highest side share is 60.0 % (pairs 1 and 4), so no pair exceeds
the target.

The simulation is fixed-point and deterministic: the same data and seeds always
produce these numbers.

## Data tuning

The four builtin personalities are pinned by the Phase 3 data acceptance test
(`AC-05-01`, `scripts/build-data.test.mjs`), which asserts their exact
`harvesters`, `buildOrders`, `taskForces` and `triggers`. That test was written
in an earlier phase and must not change, so the personalities themselves could
not be retuned (specs/05 §4.3: "tunable later by the balance issue" is blocked
by the committed test). Tuning was therefore done on the faction unit stats.

`data/factions/ukraine.yaml`

| Type / weapon | Field | Before | After | Why |
|---|---|---|---|---|
| `ua-rifle` | `damage` | 10 | 14 | Ukraine lost the opening infantry trades in the balanced pairs. |
| `ua-rifleman` | `buildTicks` | 75 | 60 | Matches the Russia rifleman cadence so the first task force is not out-timed. |
| `ua-stugna-team` | `hp` | 90 | 70 | Its 900 cm anti-tank range already gave Ukraine the ranged edge; less HP keeps the infantry trade honest. |
| `ua-kozak-scout` | `hp` | 250 | 420 | Ukraine-rush's only vehicle; must survive the Russia anti-tank fire. |
| `ua-kozak-scout` | `cost` | 400 | 300 | Same reason; lets the rush personality field the raid on time. |
| `ua-kozak-hmg` | `damage` | 12 | 15 | Same reason. |
| `ua-bradley` | `hp` | 500 | 400 | Trims the Ukraine-balanced mechanized snowball. |
| `ua-bradley` | `cost` | 800 | 900 | Same reason. |
| `ua-leopard-2a4` | `hp` | 750 | 600 | Ukraine-balanced armor dominated once it arrived. |
| `ua-leopard-2a4` | `cost` | 1200 | 1300 | Same reason. |
| `ua-himars` | `hp` | 200 | 150 | Trims the Ukraine-balanced fires element. |

`data/factions/russia.yaml`

| Type / weapon | Field | Before | After | Why |
|---|---|---|---|---|
| `ru-ak74` | `damage` | 9 | 6 | The Russia rifleman was the most cost-efficient infantry in every pair. |
| `ru-rpg7` | `damage` | 90 | 70 | Trims the Russia anti-tank infantry, shared by both personalities. |
| `ru-kpvt` | `damage` | 14 | 22 | The BRDM is the only Russia-rush-exclusive unit; it must pressure the Ukraine base. |
| `ru-kpvt` | `cooldownTicks` | 10 | 8 | Same reason. |
| `ru-2a42` | `damage` | 16 | 11 | Trims the BMP-2 autocannon. |
| `ru-2a46m` | `damage` | 85 | 65 | Trims the T-72B3 main gun. |
| `ru-tos-thermobaric` | `damage` | 120 | 85 | Trims the TOS-1A. |
| `ru-kornet-emplacement` | `damage` | 120 | 95 | Trims the Russia defense emplacement. |
| `ru-brdm-scout` | `hp` | 220 | 1200 | Only Russia-rush-exclusive unit; keeps the two `russia-rush` pairs from exceeding 70 % for Ukraine. |
| `ru-brdm-scout` | `cost` | 300 | 180 | Same reason. |
| `ru-bmp-2` | `hp` | 450 | 350 | Trims the Russia-balanced mechanized follow-up. |
| `ru-t-72b3` | `hp` | 850 | 650 | It dominated the balanced mirror. |
| `ru-tos-1a` | `hp` | 350 | 250 | Russia-balanced fires element; reduced late-game snowball. |
| `ru-defense` | `hp` | 1200 | 1000 | Russia-balanced builds two of them; shortened the defensive wall. |

`ua-rifleman.hp` stays `100`: the Phase 2 client test
`client/src/rules.test.ts` (AC-03-43) pins it and
`client/src/render/entities.test.ts` (AC-03-54) derives a health-bar count from
it. `data/generated/ruleset.json` was regenerated with `node --run build:data`.

## Notes

* `ru-brdm-scout` is the only Russia-rush-exclusive unit, so it is the main
  lever that moves the two `russia-rush` pairs without also moving the balanced
  pairs; the required HP is high because the Ukraine anti-tank teams (Stugna,
  anti-tank modifier 100 against light armor) otherwise delete it on approach.
* `ua-kozak-scout` is the mirror lever for the two `ukraine-rush` pairs.
* The balanced mirror (pair 1) is draw-heavy (5 of 10) because both AIs build
  the same defensive layout close to their starts; the decided games are close
  (2-3).
* This criterion is checked by review, not CI (specs/05-phase3-computer-ai.md
  §9), so no automated test runs this tournament.
