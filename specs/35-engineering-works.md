# 35 — Engineering works: bridge repair and trenches

Status: built (owner request 2026-10-28, backlog item 2 in `docs/roadmap.md`).
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

## 5b. Trenches

* **D3 — soldiers dig trenches** (no Zero Hour precedent; its dozer FORTIFY
  task is an empty stub, `DozerAIUpdate.cpp:749-755`).
* `Command::Dig { units, origin, rot }` appends a `trench` feature
  (`data/features/earthworks.yaml`, family `earthwork`, 2x1, `blocks: none`)
  at one hit point and orders the workers to repair it: digging *is* the
  repair from empty, so workers add up the same way. `repairPct: 400` makes a
  trench four times faster than a bridge (one soldier about 36 s, three or a
  dozer about 12 s). Refused unless every cell is on the map, open to infantry
  and free of features.
* A finished trench gives foot units on its cells `cover.trench.pct` (50,
  `data/balance/environment.yaml`); the best cover applies. Vehicles drive over
  it and get no cover.
* Rows past the map's (`placed_feature_count`) are dug rows: the feature table
  trails `placed, (x, y, rot)...` so the client can draw them; saves keep them.
* Client: the "Dig trench" button arms the next left click (Shift turns the
  trench, right click cancels); `client/src/render/features/renderers/earthworks.ts`
  draws the floor, parapets that rise with the digging and sandbags when done.
  Example save `?load=trench-digging`; setup order `{ dig: [x, y] }`.

### 5b.1 Trench lines

* **Drawing.** With Dig armed, press-drag-release (mouse, or one finger)
  draws a line on the ground; a plain tap still digs one trench. Ghost
  trenches follow the line while dragging, red where the client sees closed
  terrain. One line per arming: Shift on release keeps Dig armed, right click
  or the button again cancels.
* **Split** (`trenchLineSegments`, `client/src/input/repair.ts`): the line
  runs along its longer axis, snapped to cells, cut into consecutive 2-cell
  trenches in drawing order; turn 0 along x, 1 along y; the cross coordinate
  follows the line.
* `Command::DigLine { units, segments: Vec<(Cell, u8)> }`: every segment whose
  cells are free becomes an empty trench row in order (blocked ones, water,
  buildings, features, existing trenches, are skipped: a gap, no detour), at
  most 64. The squad digs the first; a worker that finishes a trench moves to
  the lowest-numbered unfinished trench within 8 cells (`next_trench`), so the
  line is dug in order with no extra saved state. Saves hold the command.
* Assumptions: **A6** the whole squad digs one segment at a time (no
  splitting across segments). **A7** the client preview checks terrain only;
  buildings and features are decided by the sim. **A8** the hand-on rule also
  lets a finished digger help any unfinished trench within 8 cells.

## 6. Assumptions

* **A1** Only bridges are jobs for now; building repair by dozers is backlog
  item 5 and will reuse this module.
* **A2** Any player's workers may repair any bridge (bridges are neutral).
* **A3** No repair animation or scaffolding yet; workers stand by the bank.
* **A4** The AI does not repair bridges or dig trenches yet.
* **A5** Trenches cannot be damaged or filled in; there is no limit on how
  many a player digs.

## 7. Acceptance criteria

AC-35-01..04 in `crates/sim/tests/repair.rs`: infantry reopen a broken
bridge; more workers and dozers finish faster, the cap holds; tanks and whole
bridges take no work; repair survives a save. Trench unit tests in
`crates/sim/src/repair.rs` (line: `a_dug_line_skips_blocked_cells_and_is_dug_in_order`): a dug trench covers infantry only once finished,
needs free open cells, trails the feature table and survives a save.
