# 25 — Map features plan (civilian structures, roads, rivers, bridges, vegetation, props)

Status: proposed (owner request 2026-10-25). Plan only: no code, no data, no
art lands with this document.
Depends on `06-phase4a-procedural-models.md` (models as code),
`12-generated-textures.md` and `16-building-facades-and-flags.md` (textures),
`22-snow.md` (climate), `24-terrain-relief.md` (visual height relief),
`19-save-games.md` (saves and world hash), `01-architecture.md` (sim vs client).
Decisions: D-02 (no EA art), D-05 (data driven, deterministic sim), D-07
(procedural models).

## 1. Context and goal

Today a map is `width`, `height`, `blocked` rectangles, `depots` and two
`starts` (`data/schema/map.schema.json`); the sim sees one `MapGrid` of
passable or blocked cells (`crates/sim/src/map.rs`). The owner wants maps that
look and play like Red Alert 2 / Generals: towns with garrisonable buildings,
roads, rivers with bridges, forests and clutter, all with damaged, destroyed
and snowy variants and real interaction with infantry and vehicles.

Goal of this plan: one coherent architecture so each feature is a data entry
plus a small, reusable mechanism, instead of one-off code per building. Each
phase is shippable and visible on its own.

## 2. Precedent (`generals-precedent` research, Zero Hour) and Differences

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; data: `INIZH.big`
(Zero Hour 1.04) read with `node --run generals:ini`.

### 2.1 Civilian and tech buildings (fact)

* Civilian buildings are ordinary `Object`s in
  `Data\INI\Object\CivilianBuilding.ini` (apartments `StanApartment01` line
  2654, shops `StanConvenienceStore01` line 3007, houses `GermanTownHouse1`
  line 1059, `GasStation` line 13618, `TechHospital` line 24487,
  `TechOilDerrick` line 24882, `CivilianBunker01` line 8237). No separate
  "civilian" system: one set of modules per object.
* Garrison: `Behavior = GarrisonContain` with `ContainMax` (10 for the
  apartment and the gas station); 239 `GarrisonContain` uses in that file. Art
  has a `GARRISONED` condition state (`GasStation`), which is how the building
  shows fire from windows.
* Damage states: art `ConditionState`s `NONE`, `DAMAGED`, `REALLYDAMAGED`,
  `RUBBLE`, each combined with `NIGHT` and `SNOW` (24 combinations on
  `GasStation`; `TechHospital` lines 24495-24700 has `SNOW`, `SNOW DAMAGED`,
  `SNOW REALLYDAMAGED`, `SNOW RUBBLE`). Thresholds from `GameData.ini:127-128`:
  `UnitDamagedThreshold = 0.7`, `UnitReallyDamagedThreshold = 0.35` (health
  ratio); rubble at death (`ActiveBody.cpp`, `BODY_RUBBLE`).
  `TransitionDamageFX` spawns smoke, explosion and shockwave per state change.
* Destruction: `FXListDie` (113 uses) for the death effect;
  `StructureCollapseUpdate` (6 uses; INITIAL/DELAY/BURST/FINAL FX and OCLs) for
  the collapse animation; `DestroyDie` removes the object. Rubble is a body
  state and the pathfinder marks rubble cells `CELL_RUBBLE`
  (`AIPathfind.cpp:1452-1458`), traversable only for infantry and crushers
  (`:1795-1799`).
* Fire: `FlammableUpdate` (catches fire after `FlameDamageLimit` fire damage
  within `FlameDamageExpiration` ms, then takes `AflameDamageAmount` every
  `AflameDamageDelay`). The gas station has no special explosion module in the
  fields read: its blast comes from the generic death FX (`FX_BuildingDie`) and
  the fire chain [inference], so a damaging blast needs an explicit weapon on
  death (see 6.4).
* Hospital and tech buildings: `KindOf = ... CAPTURABLE TECH_BUILDING`,
  `TechBuildingBehavior`, `AutoHealBehavior` (`HealingAmount = 2` every
  `HealingDelay = 1000` ms, `KindOf = INFANTRY`, `StartsActive = Yes`): heals
  infantry near the building. The oil derrick is capturable and pays cash to
  its owner (`TechOilDerrick`).
* Footprint is a `Geometry` box (`GeometryMajorRadius/MinorRadius/Height`), so
  the pathfinder blocks exactly the footprint.

### 2.2 Roads and bridges (fact)

* Roads are **rendering only**. `TerrainRoadType` (`TerrainRoads.h:64`) holds
  texture, `RoadWidth`, `RoadWidthInTexture` and radar colour; `Roads.ini` has
  no speed field, and `Locomotor.cpp` and `AIPathfind.cpp` never mention roads.
  So Zero Hour gives **no speed bonus on roads**; the bonus is an **owner
  Difference** (2.4).
* Bridges are `Bridge` entries in the same file (`Roads.ini:83`): four models
  (pristine, `_d`, `_e` really damaged, `_r` broken) with matching textures,
  towers (`TowerObjectNameFromLeft/Right/ToLeft/ToRight`) and scaffold objects
  for repair (`ScaffoldObjectName`, `ScaffoldSupportObjectName`).
  `BridgeBehavior.cpp` swaps the model per body damage state, runs damage and
  repair OCL/FX lists per state and animates the scaffold
  (`LateralScaffoldSpeed`, `VerticalScaffoldSpeed`). `BridgeTowerBehavior`
  forwards damage from the towers to the bridge: towers are the targetable
  part (`KINDOF_BRIDGE_TOWER`).
* A bridge is its own pathfind **layer** (`PathfindLayer`): when destroyed its
  cells become `CELL_BRIDGE_IMPASSABLE` and the ground cells that connected to
  it are disconnected (`AIPathfind.cpp:3541, 3707-3743`). Repair reverses it.
* Repair: dozers and engineers right-click a damaged bridge or tower
  (`ActionManager.cpp:409, 1792`); the bridge improves one body state at a time
  with repair FX. Turrets auto-target bridges (`TurretAI.cpp:1026`) and the AI
  attacks them (`AIPlayer.cpp:2288`).
* Water: pathfind cells have `CELL_WATER`; only locomotors whose surface mask
  includes `WATER` enter it (`AIPathfind.cpp:1780-1784, 2076`). How shallow
  versus deep is decided lives in the map's water data, not in `INIZH.big`
  [inference, not found].

### 2.3 Vegetation and props (fact)

* Trees and bushes carry `KindOf = SHRUBBERY IMMOBILE IGNORED_IN_GUI`
  (`NatureProp.ini:47, 121, 151`), `CrushableLevel = 1` ("0 infantry, 1 trees,
  2 general vehicles"), `ArmorSet = TreeArmor`, 50 hit points and
  `HighlanderBody` (can be damaged but not killed).
* Tanks crush trees: `ToppleUpdate` (`ToppleFX`, `BounceFX`, `StumpName` swaps
  in a stump) then `SlowDeathBehavior` with the `TOPPLED` death type (sinks
  after `SinkDelay`, gone after `DestructionDelay`). The pathfinder treats an
  object as passable to a crusher when its `CrushableLevel` is below the
  crusher level (`AIPathfind.cpp:6762-6766`).
* Fire: trees have `FlammableUpdate` (`AflameDuration = 3500`, `BurnedDelay =
  2500`) and `FireSpreadUpdate` (spread range 50 world units, 1-2 s), ending in
  the `BURNED` model (black trunk).
* `SHRUBBERY` is excluded from selection and targeting (`CommandXlat.cpp:1439,
  1508`) unless forced; weapons list `SHRUBBERY` in `ProjectileCollidesWith`
  (`Weapon.ini:455` and many more) so shells hit trees. I found **no code where
  trees block line of sight or fog vision** [not found, search not
  exhaustive]; trees only stop projectiles.
* Fences and walls (`ChainLinkFence01`, `StoneWall01`, `BrickWall01`,
  `WoodWall01`, `SandbagPile01`): `FenceWidth` (editor spacing),
  `CrushableLevel = 1`, a small health pool, `FX_*WallTopple` on death, a
  `RUBBLE` model state and sink-and-vanish `SlowDeathBehavior`
  (`CivilianProp.ini:6855+`).
* Snow in art: every building has `SNOW` condition states, selected by the
  map's weather; most props do not.

### 2.4 Differences (owner requests beyond Zero Hour)

1. **Roads give a speed bonus.** Zero Hour has none.
2. **Procedural snow variants** instead of hand-made `SNOW` models (no EA art,
   D-02): snow is a material overlay on generated assets (5.4), not a second
   model per state.
3. **Engineers can build new bridges** across gaps and water. Zero Hour only
   repairs map-placed bridges.
4. **Repair may cost money** (data; Zero Hour repairs bridges for free).
5. Trees do not block vision at first (as in Zero Hour); an owner option is in
   the open questions.

## 3. Architecture overview

One concept: a **map feature** is a placed instance of a **feature type**.
Everything below is a feature type with a different set of optional
components, driven from `data/`, rendered by the client from snapshots.

| Concept | Where it lives | Notes |
| --- | --- | --- |
| Feature type | `data/features/*.yaml` (+ JSON Schema) | one file per family; compiled into `ruleset.json` like units |
| Feature instance | map file `features:` list | `{ type, at, rot, variant }` |
| Terrain layers | map file `terrain:` (new, grids) | ground class, road, water depth, vegetation density |
| Sim state | `crates/sim` entities and per-cell grids | in the world hash and saves |
| Visuals | `client/src/render/features/*` | procedural models, damage states, snow, rubble |

The existing `blocked` list stays valid (legacy maps load unchanged); it is
internally one more way to fill the same obstruction grid.

### 3.1 Sim vs client responsibilities

* **Sim (`crates/sim`)** owns everything that changes outcomes: hit points and
  damage state, garrison occupancy, healing, capture and income, fire and
  explosion damage, destruction and the rubble it leaves, bridge state,
  per-cell passability and speed multiplier, crush, repair and build orders.
  Every gameplay number is data.
* **Client** owns everything visual: models, damage-state materials, snow
  overlay, rubble props, collapse animation, smoke and fire particles, road
  and river rendering, tree sway, scaffold animation, sounds. It reads
  snapshot fields (`type`, `damageState`, `garrisoned`, `variant`, `hpRatio`)
  and the per-map climate (spec 22). It never decides state. Pure decoration
  with no gameplay (grass tufts, litter) is client-only, seeded from the map
  id so it looks the same for everyone, and is not in the hash.

### 3.2 Determinism notes

* Feature instances live in a `Vec` sorted by id; iteration is by id, never
  hash order. Spatial lookups use the existing grid (`BTreeMap` or sorted
  `Vec` only).
* All numbers fixed-point (`Fx`) or integers: hit points, heal per tick, speed
  multipliers (integer percent, applied as `speed * pct / 100`), blast radii.
* Randomness (variant, rubble pieces, tree fall direction, fire spread) uses
  the sim's seeded RNG drawn in a fixed order per tick, or an integer hash of
  `(feature id, tick)`; never wall clock or unseeded RNG.
* Procedural placement of vegetation for generated maps happens in a **map
  generator tool** at build time (any seeded RNG) and writes explicit
  instances into the map file, so the sim never generates.
* New state enters `hash.rs` and `data/schema/save.schema.json` (spec 19):
  feature list, runtime overlay changes (destroyed bridge, rubble, felled
  trees), garrison lists. Maps are static input; saves store only deltas.
* Runtime passability changes (building collapses, bridge falls, tree crushed)
  go through one `apply_obstruction_change(cells)` path that updates the nav
  grid and invalidates the flow-field cache in a fixed order, the same way
  buildings already do when placed and destroyed.

## 4. Data model sketch

Illustrative, not final. Naming follows `data/factions/`.

```yaml
# data/features/buildings.yaml
apartment-block:
  family: building       # building | bunker | tech | prop | vegetation | wall | bridge
  footprint: [3, 2]      # tiles, blocks pathing
  hp: 2000
  armor: structure       # reuses the armor table
  states: { damaged: 70, wrecked: 35 }   # percent thresholds (Zero Hour 0.7 / 0.35)
  garrison: { slots: 10, fireFromWindows: true, coverPct: 50, evictOnWrecked: true }
  destroy: { effect: collapse, rubble: rubble-large, rubbleBlocks: infantry-only }
  flammable: { limit: 20, windowMs: 2000, dps: 25 }
  render: { model: apt-block, variants: 3, snow: true }
gas-station:
  extends: shop
  explodes: { radius: 3, damage: 300, fireMs: 6000 }
hospital:
  family: tech
  capture: engineer
  heal: { radius: 5, perSecond: 2, kinds: [infantry] }
oil-derrick:
  family: tech
  capture: infantry
  income: { amount: 50, intervalS: 10 }
```

```yaml
# data/features/terrain.yaml
road:
  asphalt: { speedPct: 130, width: 2 }
  dirt:    { speedPct: 115, width: 1 }
water:
  deep:    { passable: [naval, air] }
  shallow: { passable: [infantry, wheeled, tracked], speedPct: 60 }
bridge:
  steel-2lane:
    width: 2
    hp: 3000
    states: [intact, damaged, broken]     # broken = deck cells impassable
    repair: { by: [engineer, dozer], costPct: 25, secondsPerState: 8 }
    build:  { by: [engineer], cost: 400, seconds: 25 }
vegetation:
  pine: { crushLevel: 1, hp: 50, burn: true, blocksVision: false, blocksProjectiles: true }
prop:
  fence-chainlink: { crushLevel: 1, hp: 80, linear: true }
  rubble-large:    { crushLevel: 2, passable: infantry, slowdownPct: 60 }
```

```yaml
# data/maps/<id>.yaml  (all additions optional: existing maps still load)
terrain:
  ground: [...]   # one string per row, one char per cell: grass, dirt, sand, rock
  roads:  [ { type: asphalt, path: [[10,4],[20,4],[20,18]] } ]   # rasterised at load
  water:  [ { kind: river, path: [[0,20],[40,22]], width: 4, ford: [[18,21,3]] } ]
features:
  - { type: apartment-block, at: [30, 12], rot: 0, variant: 1 }
  - { type: steel-2lane, from: [20,19], to: [20,25] }            # bridge
  - { type: pine, area: [10,2,16,8], density: 60, seed: 7 }      # expanded by the loader
```

Per-cell sim layers (new `MapGrid` companion, one byte each): `surface`
(ground class and water depth), `road` (type id or 0), `cover` (vegetation
density), next to the existing passability. A unit's speed multiplier is the
minimum of the cell multipliers along its step, in integer math.

## 5. Client rendering plan

### 5.1 Procedural buildings

As with unit models (spec 06) and facades (spec 16): a TypeScript builder per
family (box-based blocks with generated windows, doors, roof types, chimneys,
signs), parameterised by `variant` so three apartment blocks differ. Textures
come from the generated-texture pipeline (specs 12 and 16: brick, plaster, roof
metal, concrete); new ids join `GENERATED_TEXTURE_IDS`. Neutral buildings have
no team colour; a flag appears once captured.

### 5.2 Damage states and destruction

Three visual states from the sim `damageState` (intact, damaged at 70 %,
wrecked at 35 %) as a **material layer** over the same mesh, not three models:
crack and soot mask, dark broken-window quads, roof holes by discarding
fragments through a noise mask, smoke emitters (spec 07 particles) on damaged
and wrecked, fire on wrecked. On death the client plays a collapse (mesh sinks
and tilts with dust bursts over about 2 s, using the easing helpers of spec 24)
then swaps in a **rubble prop** sized to the footprint, variant taken from the
snapshot. Rubble stays; scorch decals and relief craters (specs 24) work on
top.

### 5.3 Roads, rivers, bridges, vegetation

* Roads: mesh strip built from the rasterised `road` layer with generated
  asphalt and dirt textures, edge wear and lane dashes; blended over the
  terrain like Zero Hour's terrain-road quads (`TerrainRoads.cpp`).
* Rivers: one water plane per body with a scrolling generated normal map and a
  shallow-to-deep colour ramp from the `surface` layer; shore foam from the
  depth gradient; frozen edges in snow climates.
* Bridges: procedural deck, rails and supports with four visuals mirroring
  Zero Hour (`BridgeModelName`, `_d`, `_e`, `_r`): intact, damaged (missing
  rails), really damaged (holes), broken (deck gone, stumps remain). Scaffold
  animated from sim progress while repairing or building.
* Vegetation: instanced meshes (a few pine, oak and bush variants) with sway
  in the vertex shader. Forests are dense instances sampled from the `cover`
  layer, with a draw budget and billboard LOD when zoomed out. Crushed trees
  topple and leave a stump; burning trees blacken (Zero Hour `BURNED`).

### 5.4 Snow variants

Snow is a **material overlay**, not extra assets (Difference 2): a shared
`snowAmount` uniform (0..1, from the climate and the progressive cover of spec
22) blends a white noise-masked layer by surface normal (roofs, bridge decks
and branches take snow; walls a little). Damage cracks stay visible above the
snow; rubble whitens after a delay. Roads dim their dashes, rivers freeze at
the edges, trees whiten. Per-asset `snow: false` opt-out and the Snow off
setting of spec 22 apply. Spec 22's cover plane must follow relief and road
height (its "follow `heightAt`" assumption); shared follow-up.

## 6. Mechanics

### 6.1 Roads: speed bonus

Each cell has a road type; movement speed is base times `speedPct / 100` of the
road under the unit (infantry too, a lower bonus by data). Steering and
flow-field costs use the same multiplier (cost = `base_cost * 100 / speedPct`),
integers only, so groups prefer roads. Tuning is data plus the existing
locomotor (spec 11); no new locomotor type. Roads never change passability.

### 6.2 Garrison (civilian buildings, bunkers)

Follows Zero Hour `GarrisonContain` (`ContainMax`, `GARRISONED` visual state).
Infantry enter through a door cell (`approach_cell`/`exit_cell` already exist
in `nav.rs` for production buildings), up to `slots`. Occupants are hidden,
protected by cover (they take a data percentage of the damage the building
takes) and fire from inside with their weapons (range bonus in data). They are
ejected when the building is wrecked or destroyed, taking collapse damage if
data says so. Only infantry garrison. Needs: `Enter` and `Evacuate` commands, a
garrison list per entity in hash and saves, AI rules (the computer garrisons
nearby buildings under threat), selection UI (occupant count, eject button).
This is the largest mechanism and gets its own spec when phase 5 starts.

### 6.3 Hospital, tech buildings, oil derrick

* Hospital: heals friendly infantry inside `radius` at `perSecond` (Zero Hour:
  2 hp per 1000 ms, infantry only, `AutoHealBehavior`), an area aura evaluated
  each sim tick in id order. Needs capture first (`CAPTURABLE TECH_BUILDING`).
* Oil derrick: capture, then periodic income (`income` data), reusing the hook
  in `economy.rs`.
* Other tech buildings are composed from data components (`capture`, `heal`,
  `income`, `reveal`, `repair aura`); no per-building code.

### 6.4 Explosive and flammable buildings

Generic `flammable` component (Zero Hour `FlammableUpdate`: fire damage over a
window ignites, burn damage per interval) plus `explodes` (a data weapon fired
at the building centre on death, hitting neighbours, units and other
flammables, so a gas station beside an apartment can chain). Fixed-point,
chain order by entity id.

### 6.5 Rivers, fords, bridges

* Surface layer: `deep` (impassable to ground), `shallow` (passable, slowed,
  vehicles more than infantry, data), `ford` a shallow stripe in a river.
  Amphibious and naval units are a later locomotor (spec 11 extension). Zero
  Hour: the locomotor surface mask decides entry (`AIPathfind.cpp:2076`); we
  mirror it with a `surfaces` mask per locomotor.
* Bridge as an entity: hp, `intact/damaged/broken`, deck cells on a separate
  nav layer so units on the deck are not on the water below (Zero Hour
  `PathfindLayer`). Broken: deck cells impassable and entries disconnected;
  units on the deck at that moment take fall damage (data, assumption).
* Repair: engineer or dozer `Repair` order on a damaged or broken bridge,
  restoring one state per `secondsPerState`, costing a data percentage of the
  build price (Difference 4).
* Build: engineer `BuildBridge` order between two bank cells within range. It
  starts as an attackable scaffold (like buildings under construction in D-10)
  and becomes a normal bridge (Difference 3).

### 6.6 Trees, fences, props, rubble

* Trees block movement unless crushed: feature `crushLevel` against the unit
  `crusher` level (Zero Hour 0/1/2). A crushing tank topples the tree, leaving
  a stump and then nothing. The crush rules come from the crush task now in
  flight; this plan reuses them and only adds `crushLevel` data.
* Forests are dense tree cells: units path around, tanks may drive through
  (crushing) at reduced speed.
* Vision: Zero Hour trees do not block vision (2.3); default is no block.
* Projectiles: direct-fire shells collide with trees (Zero Hour
  `ProjectileCollidesWith SHRUBBERY`); artillery arcs over.
* Fences and walls: linear props that block pathing, crushable by vehicles and
  destroyed by weapons into a rubble segment passable to infantry.
* Rubble: left by destroyed buildings; passable to infantry, slows or blocks
  vehicles (data), crushable by heavy tanks, cleared by decay or engineers
  (open question).

## 7. Phases

Each phase ends with an example save (spec 19) and an owner-visible demo.

| Phase | Deliverable | Sim | Client | Data |
| --- | --- | --- | --- | --- |
| 1. Foundations | Feature schema, map `features:` and `terrain:` layers, per-cell overlay with hash and saves, neutral static features that block cells, legacy maps unchanged | feature entities, overlay grids, `apply_obstruction_change` | feature renderer scaffold, instancing, debug overlay | `data/features/` + schema, features in the showcase map |
| 2. Civilian buildings | Apartments, houses, shops, factory, church, park with variants, damage states, destruction, rubble, fire and smoke | hp, damage state, death, rubble spawn | procedural builders, damage material layer, collapse animation | building types |
| 3. Roads and ground | Road layer with speed bonus, ground classes, road mesh | speed multiplier in steering and flow cost | road mesh, textures | road types |
| 4. Water and bridges | Rivers (deep, shallow, ford), map bridges with towers, destroy and repair, bridge nav layer, engineer repair order | surface layer, bridge entity, repair order, nav layer | water shader, bridge models and states, scaffold | water, bridge types |
| 5. Garrison and tech | Garrison, bunkers, hospital heal aura, oil derrick income, capture, gas station explosion and fire chain | contain and evict, capture, aura, income, explosion | occupant UI, window fire, flags | garrison, tech, explosive data |
| 6. Vegetation and props | Trees, forests, bushes, fences, crush, burn, stumps, clutter, map generation helper | crush, burn, felled-cell overlay | instanced trees, sway, burn, topple | vegetation, prop types |
| 7. Snow and polish | Snow overlay on all assets, frozen rivers, snowy rubble, tuning, performance pass | none | material overlay, LOD, budgets | snow tuning |
| 8. Build bridges and AI | Engineers build bridges, AI uses garrison and bridges | build order, scaffold | scaffold build animation | bridge build data |

Order rationale: 1 is the base; 2 gives the first visible win; 3 and 4 need the
layer machinery; 5 needs the commands UI; 6 is independent and can swap with 5;
7 is last; 8 builds on 4.

## 8. Assumptions (narrowest choices, revisit if wrong)

* Feature types live in new `data/features/*.yaml`, not in `data/factions/`.
* All art is procedural or generated (D-02, D-07); EA art is never used.
* Damage states switch at 70 % and 35 % health, like Zero Hour.
* Only infantry garrison; occupants are ejected when the building is wrecked.
* Trees do not block vision; shells collide with them.
* Neutral buildings belong to nobody until garrisoned or captured.
* The crush mechanic comes from the parallel crush task.
* The computer player ignores map features until phase 8.

## 9. Open questions for the owner

1. Garrison ownership: does entering a neutral building make it yours (as in
   Zero Hour), or does it only shelter units while it stays neutral?
2. Road bonus size: +30 % vehicles and +15 % infantry as a start, or a
   stronger "highway" feel?
3. Do trees and forests block vision (unlike Zero Hour)?
4. Gas station explosion: how big, does it hurt whoever shot it, and should
   fire spread to neighbouring buildings and trees?
5. Bridges: only engineers rebuild, or the dozer too? Does repair cost money
   (Zero Hour: free)?
6. Rubble: permanent for vehicles, cleared by engineers, or fades with time?
7. Rivers: are amphibious or naval units in scope, or are rivers only barriers
   with fords and bridges for now?
8. Which tech buildings first (hospital and oil derrick proposed) and which
   other effects (radar reveal, repair aura, reinforcements, cash crate)?
9. Is a map editor or procedural map generator expected, or are maps
   hand-written YAML for now?
10. Should neutral buildings be targetable by default or only by force fire?

## 10. Acceptance criteria (for the plan itself)

* AC-25-01: the owner picks an order and answers the open questions; each
  accepted phase gets its own spec (garrison, bridges, roads) before code.
* AC-25-02: this document ships alone: no data, schema or code changes.
