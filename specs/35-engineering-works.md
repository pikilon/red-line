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
* Client: left click a damaged bridge with infantry or dozers selected
  (`client/src/input/repair.ts`; spec 08 §3.9).

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
  it only while it is shallow and get no cover (see 5b.2).
* Rows past the map's (`placed_feature_count`) are dug rows: the feature table
  trails `placed, (x, y, rot, variant)...` so the client can draw them; saves keep them.
* **Shelters.** In a dug line every row created gets a running index `k`
  (blocked segments do not count); `k % 4 == 2` is a covered shelter
  (`variant` 1, `SHELTER_EVERY`), the rest open trenches. Single `Dig` trenches
  are open.
* **Setup.** `trenches: [{ at: [x, y], rot?, hpPercent? (1..=100), variant? }]`
  creates finished (or part-dug) trenches at tick 0; refused if the cells are
  not free. Example save `?load=trench-network` (straight line, L corner,
  staircase, shelters, half-dug and barely started pieces).
* Client: the "Dig trench" button arms the next left click (Shift turns the
  trench; a second press of the button cancels); `client/src/render/features/renderers/earthworks.ts`
  draws the floor, parapets that rise with the digging and sandbags when done.
  Example save `?load=trench-digging`; setup order `{ dig: [x, y] }`.

### 5b.2 Hard ground and wheels

* **Hard ground.** `trench.hardGround: [rock, asphalt, concrete]`
  (`data/features/earthworks.yaml`, compiled to ids of `layerNames.ground`)
  and every road cell refuse a trench: `dig_cells` fails if any of its cells
  has such a ground or a road. In a `DigLine` those segments are skipped like
  other blocked ones. The Dig ghost reads the same ruleset data
  (`undiggableCells`, `client/src/input/repair.ts`) and turns red there.
* **Wheels.** `trench.wheelsBlockedState: 1` (data): wheeled hulls
  (locomotor `kind: wheels`, the existing `LocoKind::Wheels`; no unit ids are
  named) cannot cross a trench whose damage state is at most 1, that is dug to
  half or more. A just-started trench (state 2) blocks nobody; tracks and
  infantry always cross. The sim keeps a fourth derived grid beside the foot
  and water ones (`terrain_wheels`/`nav_wheels`, `Layer::Wheels`, `None` while
  no trench is that deep) and rebuilds it through `refresh_feature_blocks`
  when a trench reaches half depth, so flow fields route wheels around it.
* **Caught under it.** A wheeled unit on cells that close under it may move
  within its cell and, with no flow value there, heads straight for the nearest
  open cell (`way_out`) and then follows its order. Buildings placed under
  units had no such rule; this one covers both.
* Assumptions: **A9** amphibious wheeled hulls keep the water grid and ignore
  trenches (no such unit exists). **A10** the saved flow-goal lists carry no
  wheels entry; those fields are derived and recomputed on demand. **A11**
  rock, asphalt and concrete are the hard materials; gravel, mud, sand, dirt
  and snow dig.

### 5b.1 Trench lines

* **Drawing.** With Dig armed, press-drag-release (mouse, or one finger)
  draws a line on the ground; a plain tap still digs one trench. Ghost
  trenches follow the line while dragging, red where the client sees closed
  terrain. One line per arming: Shift on release keeps Dig armed, the button
  again cancels (the right button is inert, spec 08 §3.9).
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

### 5b.3 Joining and continuing (owner request 2026-10-29)

* **Snap.** A drawn line end within `TRENCH_JOIN_REACH` (2) cells of a dug
  trench moves to the nearest free cell touching it (8-neighbour, the same
  rule the client uses to draw the network as one channel), so a new line
  joins instead of leaving a gap. With both ends snapping, the end cell that
  makes the line an even number of cells wins. An odd line adds its extra
  cell past the end, or before the start when only the end joins; never back
  over its own cells (`joinedTrenchLine`, `client/src/input/repair.ts`).
* **Continue.** An unfinished dug trench is a construction mark (stakes and
  tape): a left click on it with workers (infantry, dozers) selected sends
  `Repair` on that row, so they dig on (`unfinishedTrenchJobs`).
* **Look.** The client joins all pieces into smoothed centrelines
  (`render/features/trenchNetwork.ts`) and the terrain deformer carves them
  with a crater-like profile (flat floor, walls, spoil berm); finished
  stretches get sandbags and duckboards, `variant` 1 pieces a log-and-sandbag
  roof. Infantry stand on the carved floor, so they are drawn sunk.

## 5c. Trench garrison (owner request 2026-10-29)

* **Precedent.** Trenches have no Zero Hour precedent (D3); the garrison base
  copies spec 31 block 2 (`garrison.rs`: `Garrison`/`Unload`, `inside`,
  `GarrisonDef`). Everything below is Red Line's own.
* **Data.** `trench` in `data/features/earthworks.yaml` gets a `garrison:` block
  (3 slots, range and damage 100 percent, `evictOnWrecked: false`, neutral
  allowed, enemies not) and `trench: { smallDamagePct: 10, breaksWith:
  [highExplosive, thermobaric], shelterSlots: 2, advanceTicks: 15 }`. Unit types
  may name a `trenchWeapon`; both factions get a weak `smallArms` sidearm (4
  damage, 3 tiles, 20 ticks) set on every infantry type whose main weapon is
  `antiTank` (Stugna team, RPG gunner).
* **Entry.** Only a finished (full hit points) piece takes riders. Riders that
  do not fit go to the nearest connected piece that is empty or held by the same
  player. The network is the pieces whose cells are 8-adjacent, transitively
  (breadth first, neighbours in ascending feature index). A rider that finds its
  piece full on arrival moves on to the next one. Vehicles never enter.
* **Visible.** Occupants keep `FLAG_INSIDE` but are not hidden from other
  players' snapshots. They stand at slot points of the piece (slot `i` of `n` at
  `(2i+1)/2n` of the long axis, on the centre line).
* **Damage.** A shot or splash reaching a piece (`hit_features`) goes through
  `hit_trench`. Damage types in `breaksWith` wear the trench down; going below
  zero destroys the row and the overflow hits every exposed occupant, who are
  then put out on the piece's own cells or around it. Any other type leaves the
  trench alone and hurts the lowest-id exposed occupant for `smallDamagePct`
  percent (at least 1). In a `variant` 1 piece the first `shelterSlots`
  occupants by id take nothing. Empty trenches break the same way.
* **Advance to contact.** Every `advanceTicks`, in a network holding two or more
  players, an occupant whose piece does not touch an enemy-held piece moves one
  piece along the shortest path to the nearest enemy-held one, if the next piece
  has room and is not enemy-held. An occupant in a piece touching an enemy-held
  one shoots the lowest-id enemy occupant there directly (no trench or cover
  reduction), with its `trenchWeapon` or, lacking one, its main weapon; never an
  `antiTank` one.
* **Outward fire.** Otherwise occupants fire out like building garrisons do
  (range and damage 100 percent), launchers with their normal weapon.
* **Evacuate.** `Unload` puts the occupants out; the piece's own cells count as
  free for them.
* **State.** Nothing new is stored: occupants are `inside` and their slot
  position is the entity position, both already hashed and saved.
* Example save `?load=trench-assault`.

## 6. Assumptions

* **A1** Only bridges are jobs for now; building repair by dozers is backlog
  item 5 and will reuse this module.
* **A2** Any player's workers may repair any bridge (bridges are neutral).
* **A3** No repair animation or scaffolding yet; workers stand by the bank.
* **A4** The AI does not repair bridges or dig trenches yet.
* **A5** Trenches cannot be filled in; there is no limit on how many a player
  digs. (Damage: see A12 to A17.)
* **A12** Trench garrison has no Zero Hour precedent (D3); it copies spec 31
  block 2 and the numbers are owner decisions (§5c).
* **A13** Only breaking damage types (`breaksWith`) wear a trench down; the rest
  only graze one exposed occupant. Armour modifiers do not apply to either.
* **A14** A shot that takes exactly the trench's remaining hit points leaves it
  standing at zero; only more than that destroys it.
* **A15** Contact fights ignore weapon range (the pieces touch) and the soldiers
  stay put until one side is dead or leaves; there is no retreat.
* **A16** The AI garrisons finished trenches next to approaching infantry like
  any garrisonable building, and does not advance on purpose.
* **A17** Soldiers of a destroyed or unloaded piece go to its own cells first;
  those with no room left stand around it.

## 7. Acceptance criteria

AC-35-01..04 in `crates/sim/tests/repair.rs`: infantry reopen a broken
bridge; more workers and dozers finish faster, the cap holds; tanks and whole
bridges take no work; repair survives a save. Trench unit tests in
`crates/sim/src/repair.rs` (line: `a_dug_line_skips_blocked_cells_and_is_dug_in_order`): a dug trench covers infantry only once finished,
needs free open cells, trails the feature table and survives a save.

## Addendum: trench depth (owner request 2026-10-29)

Infantry standing in a finished trench are drawn sunk 0.2 tiles (client only,
`render/features/trenchDepth.ts`): the ground and trench floor hide their legs,
so they read as inside it, like a garrisoned soldier. Finished parapets are
taller (0.26 tiles plus sandbags). Assumption: no sim container; the soldier
still walks in with a normal move order and keeps the trench cover.
