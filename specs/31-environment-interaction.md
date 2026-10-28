# 31 — Environment interaction: destruction, garrison and cover

Status: proposed (owner request 2026-10-28). Plan and base layer only in this
spec's first PR; each block ships its own PR and demo.
Depends on `26-map-features-plan.md` (features, terrain layers, bridges),
`28-vehicle-crush.md` (crush and shove), `29-weapon-ground-impacts.md` (impacts),
`30-terrain-elevation.md` (heights), `19-save-games.md` (saves and `?load=`),
`17-projectiles-and-combat-readability.md` (combat events).
Decisions: D-02 (fixed-point deterministic simulation), D-05 (data driven).

## 1. Context and goal

The map is scenery today. Features from spec 26 block cells when placed, but
nothing changes them during a match: a tank drives over a hedge as if it were
not there, a shot at a tree does nothing, a ruined block of flats stands
forever, infantry cannot use a house, and terrain gives no advantage. The owner
wants the environment to matter, in three blocks:

1. **Destruction.** Vehicles flatten bushes, hedges, fences and walls and fell
   trees (a stump stays). Shots damage trees, which burn and the fire spreads.
   Civilian buildings take damage, pass through damaged and wrecked states, and
   collapse into rubble that blocks or slows vehicles. Bridges can be destroyed.
2. **Garrison.** Infantry enter civilian buildings, fire from the windows, and
   leave when the building is wrecked. The player does it with commands; the AI
   uses it too.
3. **Cover and position.** High ground helps range or accuracy; a unit inside
   a crater, behind a wall or in a forest takes less damage.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; data: `INIZH.big`
(Zero Hour 1.04). Three questions were asked; the answers are below.

### 2.1 Destruction (fact)

* **Trees are client-only in Zero Hour.** Crushing topples or pushes the tree
  in `W3DTreeBuffer::unitMoved` (`GameEngineDevice/.../W3DTreeBuffer.cpp:1157`,
  crush near 1212). The sim never sees a tree, and no stump or pathing change
  happens. Stumps are a `StumpName` field that `W3DTreeDraw` parses and never
  reads.
* **Prop topple exists for sim objects.** Fences and streetlights use
  `ToppleUpdate` (`Update/ToppleUpdate.cpp:366`). Crusher level above 1
  topples them and `applyTopplingForce` (`ToppleUpdate.cpp:142`) spawns the
  `StumpName` object.
* **Damage states.** `ActiveBody::calcDamageState` (`Body/ActiveBody.cpp:~110`)
  maps the health ratio to pristine, damaged, really damaged or rubble.
  Thresholds: `UnitDamagedThreshold` 0.70 and `UnitReallyDamagedThreshold` 0.35
  (`GameData.ini:127-128`). Rubble height is `DefaultStructureRubbleHeight`
  10.0 (`GameData.ini:48`).
* **Rubble and pathing.** `setCorrectDamageState` (`ActiveBody.cpp:~213`)
  re-registers the object in the pathfind map. `setTypeAsObstacle`
  (`AI/AIPathfind.cpp:1452`) marks rubble cells `CELL_RUBBLE`. Whether ground
  units can cross rubble was **not verified**; see Assumption A2.
* **Collapse.** `StructureCollapseUpdate` (`Update/StructureCollapseUpdate.cpp:132`,
  `update` at 170) runs a timed collapse on GameLogic RNG and spawns debris.

### 2.2 Garrison (fact)

* **Entry.** Only empty buildings accept riders, and structures and immobiles
  never garrison (`ActionManager::canEnterObject`, `Common/RTS/ActionManager.cpp`).
  Relationship gates are `AllowNeutralInside` (default true),
  `AllowEnemiesInside` and `AllowAlliesInside` (`OpenContain.cpp:880`).
  `GarrisonContain::isValidContainerFor` adds a health check, a
  really-damaged check and `KINDOF_NO_GARRISON` (`GarrisonContain.cpp:553`).
* **Occupants.** They get `DISABLED_HELD` and the `GARRISONED` weapon bonus,
  and the building gains `CAN_ATTACK` (`GarrisonContain.cpp:~1620`).
* **Ownership.** A neutral building takes the team of its first rider and
  reverts when emptied (`GarrisonContain::recalcApparentControllingPlayer`).
* **Firing.** Occupants fire through the building (`isPassengerAllowedToFire`,
  `GarrisonContain.cpp:1715`). The bonus is damage 125% and range 133%
  (`GameData.ini:324-325`).
* **Ruined.** At really-damaged, occupants are ordered out unless the
  building is `GARRISONABLE_UNTIL_DESTROYED`
  (`GarrisonContain::onBodyDamageStateChange`).
* **Destroyed.** `OpenContain::onDie` kills riders that cannot exit and
  `removeAllContained` scatters the rest.
* **Values.** Civilian buildings use `ContainMax = 10` (`CivilianBuilding.ini:848`).

### 2.3 Height and cover (fact, with a gap)

* **Range ignores height.** Range is a 2D bounding-sphere distance, so Z is
  ignored (`Weapon.cpp:83`, `Weapon::isWithinAttackRange` at `:2159`).
* **No terrain cover.** Weapon and armor code never reads elevation or terrain
  type.
* **Walls and trees reduce damage through armor, not cover.** `TreeArmor`
  (flame and particle beam 100%, `NatureProp.ini:43`), `WallArmor` (small
  arms 6%, `FactionBuilding.ini:27970`). Applied in `ArmorTemplate::adjustDamage`
  (`Armor.cpp:67`).
* **Craters** flatten terrain for pathfinding only (`TerrainLogic::createCraterInTerrain`,
  `TerrainLogic.cpp:2862`) and have no combat effect.
* **Accuracy** is scatter only (`ScatterRadius`, `Weapon.cpp:977-1010`).

**Gap:** Zero Hour has no height advantage and no terrain or crater cover. Those
are owner requests, marked as Differences below.

## 3. Differences from Zero Hour (owner requests)

**Difference 1 — trees are simulated.** Zero Hour topples trees on the client
only. Here a tree has hit points, burns and spreads fire, and its death changes
the sim (stump, passability, vision). Reason: the owner asked for shot trees
that burn and spread. Trees keep the Zero Hour look: the client fells them.

**Difference 2 — height and cover affect combat.** Zero Hour ignores height and
terrain cover. Here a unit on high ground gets a range bonus. A unit in a crater,
behind a wall or in a forest takes less damage. Reason: owner request. The
values are data (section 6) and all of them are fixed-point.

**Difference 3 — rubble blocks vehicles.** Zero Hour's rubble passability was not
confirmed. Here wrecked buildings leave rubble that blocks vehicles and slows
infantry to 60%. Reason: owner request ("escombros que bloquean o frenan
vehículos"), and `rubble-large` already carries this in `data/features/props.yaml`.

**Difference 4 — garrisoned civilian buildings do not capture the map.** Zero
Hour gives a neutral building to the rider's team. Here a civilian building is
captured by its first garrison, as in Zero Hour, but an empty garrison hands it
back to neutral, as in Zero Hour. The difference: there is no capture
progress, only occupancy.

## 4. Architecture: the base layer

Shared by all three blocks. Merged first, in one PR (`feat: adds runtime
state to map features`), before any block starts.

### 4.1 Sim (`crates/sim`)

* **Runtime feature table (base layer, built).** `World.features: Vec<FeatureState>`
  holds one row per map feature in map order; rows are never removed, so an index
  is stable. A row holds `kind` (feature type index), origin, `rot`, `variant`,
  `state` (0 intact, 1 damaged, 2 wrecked; 3 abandoned is kept as placed), `hp`
  and `alive`. Built by `features::from_map`.
* **Base terrain.** `World.terrain_base` is the map terrain without feature
  footprints. `World.terrain` is `features::with_blocks(terrain_base, features)`.
  Every change of blocking calls `refresh_feature_blocks`, which rebuilds
  `terrain` and then `nav` (clearing the flow fields). Nothing else writes
  feature blocking at runtime.
* **Hit points and states (built).** A feature type has `hp` (0 means
  indestructible, the default for every type today), `states` (percent
  thresholds, defaults 70 and 35, as Zero Hour) and `destroy.becomes` (a feature
  type id, or absent to disappear). `World::damage_feature(index, amount)`
  lowers `hp`, raises `state` (states only get worse), and at zero hp replaces
  the row's type at full hit points or marks it dead. It returns whether the row
  changed.
* **Block 1 (built).** `World::step` runs `features_step` after `run_over`: vehicle
  crush (`crush_features`, geometry of `crush.rs`), fire (`burn_features`) and
  collapse timers (`collapse_features`). Rows also hold `burn` (fire ticks
  left), `collapse` (ticks to rubble) and, for bridges, `to`. Shots call
  `hit_features` at their impact. The snapshot carries the table through
  `features_for` (`[count, then index, kind, state, flags, hp permille]`, empty
  when unchanged). `CombatEvent` has no feature event; the client reads states
  from the table.
* **Hash and save (built).** `state_hash` writes the feature rows (kind, origin,
  rot, state, alive, variant, hp) after the entities, only when the map has
  features, so worlds without features keep the AC-03-08 layout. `save_state`
  writes `features` (feature type id per row) with `#[serde(default)]`; a save
  without rows loads from the map at full hit points, and `format_version`
  stays 1.

### 4.2 Data (`data/features/*.yaml`)

New optional keys on feature types, read by the schema in `data/schema/`:

```yaml
- id: pine
  hp: 50                     # 0 means indestructible (decor)
  flammable: { dps: 2, spreadRadius: 1, burnTicks: 300 }
  destroy: { becomes: stump }   # or nothing / rubble-large
- id: apartment-block
  hp: 2000
  states: { damaged: 70, wrecked: 35 }
  destroy: { becomes: rubble-large, collapseTicks: 60 }
  garrison: { slots: 10, fireFromWindows: true, evictOnWrecked: true, coverPct: 50 }
```

### 4.3 Client (`client/`)

Only receives and draws. Feature renderers read the snapshot section and show
the state (damaged and wrecked models, fire, rubble, stump). Renderer files stay
under `client/src/render/features/renderers/` with **no test files there**
(owner request: the game loads that folder in the browser). Tests go in
`client/tests/` or `crates/sim`.

## 5. Mechanics per block

### Block 1 — Destruction

* **Crush.** Tracked vehicles (crusher level above 1) flatten `blocks: none`
  decor (bushes, hedges, fences, walls: `hp` and `destroy: nothing`) and fell
  trees (`destroy: stump`). Wheeled vehicles shove decor and damage it.
  Reuses `run_over`'s geometry (spec 28).
* **Shots.** A projectile whose impact cell holds a feature with hp damages it
  (armor from data). Trees burn: `flammable.dps` per tick while burning, fire
  spreads to adjacent flammable features with a chance from the seeded RNG,
  and it burns out after `burnTicks`.
* **Buildings.** Damage states at 70% and 35%. At zero, the building collapses
  over `collapseTicks` into rubble. Rubble changes blocking (Difference 3).
* **Bridges.** A bridge is a feature (spec 26). It has states and hp; at
  "broken" its deck cells are blocked (`apply_obstruction_change`). Repair is
  spec 26 phase 4, not this block.

### Block 2 — Garrison

* **Entry.** Infantry get a `garrison` command with a building target. It walks
  to the building, enters if `slots` allow and the relationship allows
  (Zero Hour gates, section 2.2), and is hidden in the sim (`DISABLED_HELD`).
* **Fire.** Occupants fire from the building with range 133% and damage 125%
  (data, section 2.2). They use the building's position.
* **Exit.** An `unload` command, or automatic when the building is wrecked
  (`evictOnWrecked`). Occupants are placed on free cells around the footprint;
  if none is free and the building is destroyed, they die (Zero Hour).
* **AI.** The AI garrisons near contested buildings when enemy infantry are
  close (spec 05 gets a rule, data in `data/ai/`).
* **Interface.** A garrison button on the selection when infantry and a valid
  building are selected; an "evacuate" button on a garrisoned building. Strings
  go in `client/src/i18n/` (AGENTS.md).

**Built (PR for block 2).** `crates/sim/src/garrison.rs`; commands `Garrison`
and `Unload`; order `Order::Garrison`; `Entity.inside` (feature row index) is
hashed and saved (`inside`, serde default). Occupants stay in `entities`,
hidden from other players' snapshots (`FLAG_INSIDE` for the owner), skipped by
targeting, splash, crushing, separation and movement. The building's team is
derived from its occupants, so a neutral building is captured by the first
rider and reverts when emptied (nothing else is stored). Data lives in
`garrison: { slots, rangePct, damagePct, evictOnWrecked, allowNeutral?,
allowEnemies? }` on the feature type; the AI reads `garrisonRadiusCenti` from
`data/ai/*.yaml`. Example save: `?load=environment-garrison`.

* **A9 — riders.** Only free infantry (foot locomotor) enter. A building held
  by one player refuses riders of another unless `allowEnemies`; allies do not
  exist in the sim yet, so `allowAllies` is not read.
* **A10 — eviction.** Occupants leave onto the first free passable cell of the
  rings (up to 3) around the old footprint, in `(y, x)` order. A wrecked
  building with no room keeps them inside; a destroyed one kills them. A
  building that starts to collapse (block 1, zero hit points) counts as
  destroyed: it empties at once, before it turns into rubble.
* **A11 — interface.** Right click on a garrisonable building with infantry
  selected, or the Garrison button (nearest valid building within 14 tiles),
  garrisons; a left click on an own garrisoned building selects its occupants,
  which shows the Evacuate button. The feature table of the snapshot carries
  each building's holder (`NEUTRAL` when empty) and occupant count, so the
  client offers only what the sim accepts: not a wrecked, collapsing or
  destroyed building, not a full one and not one another player holds. The
  holder is public, as in Zero Hour, where a garrisoned building shows its
  team colour.
* **A12 — attacking a garrison.** Occupants cannot be targeted. Enemies clear
  a building by damaging it (force fire or splash, block 1): at the wrecked
  state the occupants are thrown out. Units do not pick a held building as an
  automatic target yet (Zero Hour does); see open question 3.

### Block 3 — Cover and position

* **High ground (Difference 2).** A shooter whose cell is at least
  `highGroundMinTiles` above the target gets `highGroundRangePct` range
  (fixed-point, from `corner_height`, spec 30). No accuracy change.
* **Cover (Difference 2).** A target standing in a cover cell takes
  `coverPct` less damage. Cover cells are: a crater (spec 24), a forest or
  bush cell with `coverPct` from data, and a wall or building footprint the
  shot crosses (`line_passable` check). Multiple covers do not stack; the
  best one applies.
* **Scatter.** Unchanged (Zero Hour scatter).

**Built (PR for block 3).** `crates/sim/src/environment.rs`, values in
`data/balance/environment.yaml`. `effective_range` scales a weapon's range by
`highGround.rangePct` when the ground under the shooter is at least
`highGround.minTiles` above the target's; it is used for both the attack and
the target pick. `cover_pct` applies the best of forest and wall cover to the
damage of direct hits and splash (`reduce_damage`, at least 1).
Example save: `?load=environment-cover`.

* **A13 — what covers.** Forest: a living tree or hedge (vegetation that
  blocks movement) on or next to the target's cell; stumps and bushes give
  none. Wall: the line of fire crosses a living wall or building footprint,
  except a footprint that holds the shooter (a garrison fires out of its own
  building) or the target. Splash is shielded by walls between the impact and
  the target, not between the shooter and the target. Craters are not in the
  sim (spec 24 draws them in the client), so `cover.crater` is not read yet.
* **A14 — walls reduce, they do not stop shots.** The owner's request is
  "takes less damage" behind a wall, so a wall cuts damage by `wall.pct` and
  the shot still lands (open question 2 stays open for a stronger rule).

## 6. Data sketch

```yaml
# data/balance/environment.yaml (new; one file)
highGround: { minTiles: 2, rangePct: 115 }
cover:
  crater:  { pct: 30 }
  forest:  { pct: 25 }
  wall:    { pct: 40, blocksShots: true }
garrison: { rangePct: 133, damagePct: 125 }   # Zero Hour values
rubble:   { infantrySlowPct: 60 }
```

## 7. Phases and PRs

| PR | Scope | Owner-visible demo |
| --- | --- | --- |
| 1. Base layer | 4.1 and 4.2 (sim rows, damage API, states, blocking refresh, save, hash); snapshot and tick step follow in block 1 | none yet; sim tests |
| 2. Block 1 | Crush decor and trees, burn and fire spread, building damage states and rubble, bridge break | `?load=environment-destruction` |
| 3. Block 2 | Garrison command, fire from windows, eviction, AI garrison, buttons | `?load=environment-garrison` |
| 4. Block 3 | High ground range, cover, scatter unchanged | `?load=environment-cover` |

Blocks 2 and 3 depend on PR 1 only (and on block 1's snapshot and tick step). Blocks 2 and 3 both touch
`data/balance/` and `en.json`, so they merge one at a time and regenerate
`data/generated` (owner rule; see the PR workflow in AGENTS.md).

## 8. Assumptions (narrowest choices)

* **A1 — trees in the sim.** Trees have hp and burn in the sim; the client fells
  them. Stumps are decor (`blocks: none`).
* **A2 — rubble.** Zero Hour's rubble passability is unverified. Here rubble
  blocks vehicles and slows infantry to 60%. Revisit if the owner tests a
  different expectation.
* **A3 — cover does not stack.** The best cover applies, not the sum.
* **A4 — garrison capacity.** `slots` is per building type; civilian values as
  in section 2.2 (10 for the apartment block).
* **A5 — fire spread** uses the seeded RNG, one roll per burning neighbour per
  tick.
* **A6 — crusher level (block 1).** Tracked hulls have `crusherLevel: 1` in the
  data, so a feature's `crushLevel: 1` is what they flatten (the spec text said
  "above 1"). A hull flattens a feature within its radius plus a quarter tile
  and ahead of it (45 degree cone), so a tank felling a tree must drive at it.
  Wheeled hulls damage only the ones that do not block (`shoveDamage` a tick).
* **A7 — rubble (block 1).** The nav grid has one layer, so `blocks: vehicles`
  blocks infantry too: rubble stops everybody and the 60% infantry slowdown of
  Difference 3 waits for the layer split. A collapsed building becomes the
  `rubble-<w>x<h>` type of its footprint.
* **A8 — bridges (block 1).** A bridge at the wrecked state (35% hp) or lower
  blocks its deep-water deck cells and the client stops drawing it; units on
  the deck at that moment are not harmed.

## 9. Open questions for the owner

1. The "Pending: interaction with the environment" section named in the
   request is not in `specs/26-map-features-plan.md`, `specs/` or `docs/`. This
   spec is built from the three block descriptions in the request. Send the
   missing text if it had more requirements.
2. Should a shot that crosses a wall stop the shot (Difference 2 `blocksShots`)
   or only reduce the damage? This spec assumes "reduce".
3. Should units attack an enemy-held building on their own, as in Zero Hour
   (A12)? Today the player has to force fire on it.

## 10. Acceptance criteria

* The base layer keeps every old map and save loading: a save without `features`
  loads and hashes the same as before the change.
* `state_hash` changes when a feature takes damage, and is identical across two
  runs of the same inputs.
* Blocking changes at runtime go through `apply_obstruction_change` and clear
  the flow cache.
* Each block's demo save loads with `?load=<id>` and shows the behaviour named
  in its row of section 7.
