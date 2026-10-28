# 35 — Engineering works: bridge repair

Status: bridge repair built (owner request 2026-10-28, backlog item 2 in
`docs/roadmap.md`); trenches are the next PR of this spec.
Depends on `31-environment-interaction.md` (broken bridges, block 1),
`26-map-features-plan.md` (bridges), `19-save-games.md`.
Decisions: D-02 (fixed-point deterministic simulation), D-05 (data driven).

## 1. Goal

Infantry and dozers repair damaged or broken bridges. More workers finish
faster; a dozer works harder than a soldier.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; data: `INIZH.big` 1.04.

* **Bridges cannot be repaired.** `ActionManager::canRepairObject` refuses
  `KINDOF_BRIDGE` and `KINDOF_BRIDGE_TOWER` ("cut 12/12/02",
  `ActionManager.cpp:409`); the dozer bridge-repair code is unreachable.
* **Repair rate.** Dozers and the GLA Worker heal
  `RepairHealthPercentPerSecond = 2` percent of maximum health per second
  (`AmericaVehicle.ini:1739`, `DozerAIUpdate.cpp:719`), to full health.
* **One healer at a time.** `Object::attemptHealingFromSoleBenefactor`
  (`Object.cpp:1907-1925`) refuses a second dozer.
* **No trenches** exist; the closest fortification is the dozer-built China
  Bunker (400, 5 s, 5 slots).

## 3. Differences from Zero Hour (owner requests)

* **D1 — bridges are repairable**, by infantry as well as dozers.
* **D2 — workers add up.** Each worker in range brings its work points; at
  most `maxWorkers` workers count (lowest ids first).

## 4. Rules

`data/balance/environment.yaml`, `repair`:

| Field | Value | Meaning |
|---|---|---|
| `permillePerSecondPerPoint` | 7 | Max hp permille one work point restores per second |
| `infantryPoints` | 1 | A foot soldier |
| `dozerPoints` | 3 | A dozer (any unit type that builds): 2.1 %/s, Zero Hour's 2 % |
| `maxWorkers` | 6 | Workers counted per job |

Work is applied once a second (every 15 ticks). The bridge's damage state
follows its hit points back up, so a broken bridge (wrecked, 35 %) opens again
once repaired above that threshold, and the client draws it again.

## 5. Architecture

* `crates/sim/src/repair.rs`: `Command::Repair { units, feature }`, order
  `Repair`; a worker walks to the passable cell nearest the deck (its own
  layer) and stands within 1.5 tiles; `repair_works` runs after
  `features_step`. The order ends when the bridge is whole.
* Example saves may damage features at tick 0: `features: [{ at, hpPercent }]`;
  setup order `{ repair: [x, y] }` (a deck cell). `?load=bridge-repair`.
* Client: right click a damaged bridge with infantry or dozers selected
  (`client/src/input/repair.ts`).

## 6. Assumptions

* **A1** Only bridges are jobs for now; building repair by dozers is backlog
  item 5 and will reuse this module.
* **A2** Any player's workers may repair any bridge (bridges are neutral).
* **A3** No repair animation or scaffolding yet; workers stand by the bank.
* **A4** The AI does not repair bridges yet.

## 7. Acceptance criteria

AC-35-01..04 in `crates/sim/tests/repair.rs`: infantry reopen a broken
bridge; more workers and dozers finish faster, the cap holds; tanks and whole
bridges take no work; repair survives a save.
