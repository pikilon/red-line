# Phase 3 first balance report — `first-line`

Issue P3-09 (#152), acceptance criterion **AC-05-22** (spec
`specs/05-phase3-computer-ai.md` §8, §10). Balance is measured by headless
bot-vs-bot tournaments with the four builtin personalities (D-06). AC-05-22 is
checked by review, not CI (spec 05 §8).

## How to reproduce

From the repository root, build the headless runner, write the tournament
config and run it:

```sh
cargo build --release -p headless
cat > /tmp/tournament-first-line.json <<'JSON'
{"map":"first-line","maxTicks":27000,"seeds":[1,2,3,4,5,6,7,8,9,10],"ai0":["ukraine-balanced","ukraine-rush"],"ai1":["russia-balanced","russia-rush"]}
JSON
./target/release/headless tournament /tmp/tournament-first-line.json
```

The command prints one JSON object with the 40 matches and the four summary
rows; `docs/balance/tournament-first-line.json` holds that same report
(pretty-printed). The configuration is:

```json
{
  "map": "first-line",
  "maxTicks": 27000,
  "seeds": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  "ai0": ["ukraine-balanced", "ukraine-rush"],
  "ai1": ["russia-balanced", "russia-rush"]
}
```

`ai0` is Ukraine (player 0), `ai1` is Russia (player 1). The tournament plays
every `ai0 × ai1 × seeds` combination: **10 seeds over all four personality
pairs** (40 matches). "Non-draws" is `wins0 + wins1`; a percentage is a side's
wins divided by the non-draw games of that pair.

## Summary (final data)

| Pair (ai0 vs ai1) | Games | W0 | W1 | Draws | Decided | Win0 % | Win1 % | Avg ticks | Lost0 | Lost1 |
|---|---|---|---|---|---|---|---|---|---|---|
| `ukraine-balanced` vs `russia-balanced` | 10 | 3 | 4 | 3 | 7 | 42.9 % | 57.1 % | 16633 | 239450 | 257920 |
| `ukraine-balanced` vs `russia-rush` | 10 | 5 | 5 | 0 | 10 | 50.0 % | 50.0 % | 11779 | 237000 | 252760 |
| `ukraine-rush` vs `russia-balanced` | 10 | 4 | 2 | 4 | 6 | 66.7 % | 33.3 % | 16169 | 240000 | 140280 |
| `ukraine-rush` vs `russia-rush` | 10 | 6 | 3 | 1 | 9 | 66.7 % | 33.3 % | 10477 | 168250 | 219700 |

`Decided = W0 + W1`; `Win0 %`/`Win1 %` are over the decided games. `Avg ticks`
is integer division and `Lost*` is the summed `cost` of the entities each side
lost over the ten seeds. No pair has a side winning more than 70 % of its
decided games.

The simulation is fixed-point and deterministic: the same data and seeds always
produce these numbers.

## Baseline and tuning

The untuned Phase 2/3 data (the numbers in spec 05 §4.3) produced a strongly
Russia-favoured field:

| Pair | Ukraine wins | Russia wins | Draws | Non-draw winner |
|---|---|---|---|---|
| `ukraine-balanced` vs `russia-balanced` | 1 | 9 | 0 | Russia 90.0 % |
| `ukraine-balanced` vs `russia-rush` | 8 | 2 | 0 | Ukraine 80.0 % |
| `ukraine-rush` vs `russia-balanced` | 0 | 8 | 2 | Russia 100 % |
| `ukraine-rush` vs `russia-rush` | 0 | 10 | 0 | Russia 100 % |

Following the AC-05-22 tuning rules, **the four personalities were tuned
first** (harvesters, build orders, task forces and triggers). Personality
tuning alone reached a fully balanced field for the committed 10-seed
tournament. One further weapon-range change was needed to satisfy the D-10
identity (see "Unit/weapon stat changes"); because no personality task force
contains the Kozak scout, the tournament table is identical with or without it.

### `data/ai/ukraine-balanced.yaml`

* `taskForces.mechanized`: `{ua-bradley: 2, ua-rifleman: 3}` →
  `{ua-bradley: 3, ua-rifleman: 4}`.
* `taskForces.armor`: `{ua-leopard-2a4: 2, ua-bradley: 1}` →
  `{ua-leopard-2a4: 3, ua-bradley: 2}`.
* `taskForces.fires`: `{ua-himars: 1, ua-leopard-2a4: 1, ua-stugna-team: 2}` →
  `{ua-himars: 2, ua-leopard-2a4: 2, ua-stugna-team: 3}`.

Reason: the balanced build lost the attrition war against `russia-balanced`.
Larger mid- and late-game task forces let it assemble a comparable force before
committing instead of feeding units piecemeal. `infantry` (the first task
force, pinned by AC-05-03) is unchanged.

### `data/ai/ukraine-rush.yaml`

* `harvesters`: `2` → `6`.
* `buildOrder`: `[ua-power-plant, ua-barracks, ua-supply-center,
  ua-vehicle-factory, ua-power-plant]` → `[ua-power-plant, ua-barracks,
  ua-supply-center, ua-vehicle-factory, ua-barracks, ua-power-plant]` (a second
  barracks for parallel infantry production).
* `taskForces.rifles`: `{ua-rifleman: 5}` → `{ua-rifleman: 8}`.
* `taskForces.raid`: `{ua-kozak-scout: 2, ua-rifleman: 2}` →
  `{ua-bradley: 3, ua-rifleman: 4}` (scouts replaced by an armoured IFV core).
* `taskForces.hunters`: `{ua-stugna-team: 2, ua-kozak-scout: 1}` →
  `{ua-stugna-team: 3, ua-rifleman: 4}`.
* New `taskForces.armor`: `{ua-leopard-2a4: 2, ua-bradley: 2}`.
* New trigger `{taskForce: armor, weight: 40, minTick: 3600}`.

Reason: the rush AI won 0 of 10 games against both Russian personalities. It
had the smallest economy (2 trucks) and a light scout wave that was attrited
before it could do damage. More trucks, a second barracks and an armoured
follow-up wave give it a real mid-game instead of a single throwaway attack.
`raid`/`hunters` `minTick` values are unchanged.

### `data/ai/russia-balanced.yaml`

* `buildOrder`: `[ru-power-plant, ru-supply-center, ru-barracks,
  ru-power-plant, ru-vehicle-factory, ru-defense, ru-power-plant,
  ru-defense]` → `[ru-power-plant, ru-supply-center, ru-barracks,
  ru-power-plant, ru-vehicle-factory, ru-power-plant]` (both static
  `ru-defense` emplacements removed).

Reason: the AI plays by the same rules as a human and only attacks with mobile
forces; the two powered Kornet emplacements (1100 centi range) turned the
Russian base into a fortress the AI could neither flank nor out-range, and the
matches became one-sided attrition in Russia's favour. Spending those credits
and power on mobile production instead lets `russia-balanced` be evaluated on
its task forces. The building is still exercised by the tournament: the
`russia-rush` build below keeps one `ru-defense`.

### `data/ai/russia-rush.yaml`

* `harvesters`: `2` → `4`.
* `buildOrder`: `[ru-power-plant, ru-barracks, ru-supply-center,
  ru-vehicle-factory, ru-power-plant]` → `[ru-power-plant, ru-barracks,
  ru-supply-center, ru-vehicle-factory, ru-power-plant, ru-defense,
  ru-power-plant]` (a defensive emplacement and a third power plant for it).
* `taskForces.rifles`: `{ru-rifleman: 6}` → `{ru-rifleman: 8}`.
* `taskForces.raid`: `{ru-brdm-scout: 2, ru-rifleman: 3}` →
  `{ru-brdm-scout: 3, ru-rifleman: 4}`.
* `taskForces.hunters`: `{ru-rpg-gunner: 3, ru-brdm-scout: 1}` →
  `{ru-rpg-gunner: 4, ru-brdm-scout: 2}`.
* New `taskForces.armor`: `{ru-t-72b3: 3, ru-bmp-2: 1, ru-rifleman: 3}`.
* Triggers `raid` and `hunters`: `minTick` `1800` → `2400` and `2700` → `3000`;
  new trigger `{taskForce: armor, weight: 40, minTick: 4200}`.

Reason: `russia-rush` won only 2 of 10 games against `ukraine-balanced`. It
needed a real economy and a heavier follow-up; the later trigger times let the
larger waves assemble before attacking instead of trickling in.

## Unit/weapon stat changes

One weapon field changed, entirely within the AC-05-22 ±25 % bound:

| File | Weapon | Field | Phase 2 value | New value | Change | Reason |
|---|---|---|---|---|---|---|
| `data/factions/ukraine.yaml` | `ua-kozak-hmg` | `rangeCenti` | 500 | 550 | +10 % | D-10 identity: the Ukrainian scout tied the Russian `ru-kpvt` at 500 centi and dealt less damage (12 vs 14), so it neither outranged nor out-damaged its counterpart. +10 % range restores the "outrange or out-damage" clause. |

No other unit or weapon field in `data/factions/ukraine.yaml` or
`data/factions/russia.yaml` changed. No builtin personality task force contains
`ua-kozak-scout`, so this change leaves the tournament table above identical.

## D-10 identity

After the one weapon change above, the identity holds:

* Ukraine combat units cost more than their Russian counterparts and outrange
  or out-damage them (cost / weapon damage / weapon range, centi):
  * `ua-rifleman` 100 / 10 / 450 vs `ru-rifleman` 80 / 9 / 420.
  * `ua-stugna-team` 350 / 120 / 900 vs `ru-rpg-gunner` 200 / 90 / 450.
  * `ua-kozak-scout` 400 / 12 / 550 vs `ru-brdm-scout` 300 / 14 / 500
    (outranges; this is the change above).
  * `ua-bradley` 800 / 18 / 600 vs `ru-bmp-2` 600 / 16 / 600 (out-damages).
  * `ua-leopard-2a4` 1200 / 100 / 700 vs `ru-t-72b3` 900 / 85 / 650.
  * `ua-himars` 1500 / 250 / 2400 vs `ru-tos-1a` 1400 / 120 / 1000.
* Russia is cheaper with equal or more hit points per credit:
  `ru-rifleman` 1.125 hp/credit vs `ua-rifleman` 1.0; `ru-rpg-gunner` 0.45 vs
  `ua-stugna-team` 0.257; `ru-brdm-scout` 0.733 vs `ua-kozak-scout` 0.625;
  `ru-bmp-2` 0.75 vs `ua-bradley` 0.625; `ru-t-72b3` 0.944 vs
  `ua-leopard-2a4` 0.625; `ru-tos-1a` 0.25 vs `ua-himars` 0.133.
* A scout never has more hit points than its faction's IFV:
  `ua-kozak-scout` 250 ≤ `ua-bradley` 500, and `ru-brdm-scout` 220 ≤
  `ru-bmp-2` 450.

## Verification note

AC-05-22 is a review criterion (spec 05 §8, traceability §9 lists `review` with
no test), so no automated balance test exists or is added here. The Rust and
data test suites are unaffected by the personality values: AC-05-01 compares
the generated `ai` array against the YAML sources, and AC-05-03/AC-05-12 pin
`ukraine-balanced`'s first build-order item and first task force, both of which
are preserved.
