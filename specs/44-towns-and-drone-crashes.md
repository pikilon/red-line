# 44 — Bases in towns and drones crashing into buildings

Status: implemented (owner requests 2026-11-03: towns and crashes; then
cities, crumbling buildings and Shaheds that never circle).
Depends on `26-map-features-plan.md`, `31-environment-interaction.md`,
`32-river-port-map.md`, `43-air-and-drones.md`.

## 1. Goal

* On the default skirmish map each base starts in the middle of a town, as
  front-line bases do in reality.
* Drones can crash into civilian buildings.
* A hit building crumbles bit by bit, with an explosion at every hit.
* A Shahed (Geran) sent to a point dives into it; it never circles.

## 2. Precedent (`generals-precedent`, Zero Hour)

* Living aircraft never collide with structures: "Airborne flying objects
  don't collide for now" (`Locomotor.cpp:1046-1048`); `processCollision`
  returns false for air movers (`AIUpdate.cpp:1434`, `:2363-2368`). Flight
  height is terrain-relative (`Locomotor.cpp:1938-1942`); the only
  building-aware mode, `Z_RELATIVE_TO_GROUND_AND_BUILDINGS`, is unused by the
  shipped INI.
* Wrecks do bounce off structures (`PhysicsUpdate.cpp:1284`).

## 3. Differences from Zero Hour

* **Drones crash into tall buildings** (owner request). Zero Hour has no such
  rule; Red Line gives each civilian building type a height and low drones that
  fly into a taller one crash.

## 4. Rules

### 4.1 Cities around the bases

* `river-port` has a city around each start: a street grid (2-wide asphalt
  streets every 7-8 cells, roads are rendering only) whose blocks are filled
  back to back with apartment blocks, office towers, shops, townhouse rows,
  houses and a few warehouses, factories and gas stations (about 80 buildings a
  side). The generator places two rows per block, fronts facing the streets.
* Left clear: the base core around the HQ and depot (cells 4..18 x 30..53), the
  outer depot, the two hills (parks), the plateau and its ramp, and the river
  groves. The bush scatter and the farm hamlets gave way to the city. The AI
  site search (spec 05 §5.5) places buildings on free cells, beyond the core
  when needed.
* The east city mirrors the west one (left-right, like the rest of the map).
* City buildings are ordinary civilian features: garrisonable, destructible.

### 4.2 Drones crashing into buildings

* Feature type field `heightCenti` (default 0): height of the standing feature
  in centi-tiles. Data: `townhouse-row` 160, `factory` 180, `apartment-block`
  220, `church` 280, `office-tower` 420; the other buildings stay below the
  low drone altitude (`airLow.altitudeCenti` 140) and drones clear them.
* After it moves each tick, an airborne flyer of air class `low` whose cell lies
  in the footprint of a living, not collapsing, feature with `heightCenti`
  above its locomotor `altitudeCenti` crashes:
  * a one-way unit detonates its warhead there (the building takes the hit, as
    from any detonation);
  * any other flyer falls, harmless (no killer).
* Class `high` flyers (jets, cruise missiles) fly over every building.
* Low drones fly straight (spec 43 §4.1), so a player routes them around tall
  buildings with waypoints.

### 4.3 Buildings crumble hit by hit (client)

* Zero Hour shows damage through body states (`DAMAGED` 0.7, `REALLYDAMAGED`
  0.35, `RUBBLE`) and `TransitionDamageFX` (spec 26 §2.1); Red Line keeps those
  states and adds a burst on every hit between them.
* Every drop of a standing building's hit points draws, on a wall facing the
  camera at a random height: a fireball, pieces of facade thrown off and a dust
  curtain sliding down; bigger for a bigger share of hit points lost.
* A building that lost any hit points smokes from the roof; damaged smokes,
  wrecked burns and a collapse sinks in fire and dust (spec 31), as before.
* A one-way flyer's own blast is drawn at its flight height, so a drone that
  flies into a wall explodes on the wall, not at its foot.

### 4.3b Ruins (client)

* Zero Hour gives each civilian building a separate `RUBBLE` model
  (`CBTAprtmn1_R`, `CBTownHs01_R` in `W3D.big`): an apartment block keeps a
  tall shell, about 0.7 of its height, a town house a low pile, about 0.3; the
  transition is one burst of smoke, explosion and debris
  (`TransitionDamageFX`), no lasting fire (`generals-precedent` note).
* `rubble-heap` (client) draws, instead of a smooth mound: an ash-dark ground
  past the footprint, a jagged mound of masonry, floor slabs fallen across it,
  stubs of the outer walls with window holes (up to about 2.3 tiles on a 3x3
  or larger ruin, a block's shell; up to 1.3 on smaller ones), snapped columns,
  bent rebar and loose blocks, some charred. Original art: D-02.
* Difference: the ruin smoulders and its embers glow for a while (spec 31).

### 4.4 One-way flyers sent to a point

* A fixed-wing one-way flyer (Geran, Molniya) ordered to move to a point flies
  there and detonates on arrival, like an attack on the ground (spec 43 §4.2);
  it never orbits the point. A one-way rotorcraft (FPV, Sting) still hovers.

## 5. Assumptions

* "Drones" means the class `low` flyers: Geran, Molniya, Orlan, FPV, Sting and
  Baba Yaga.
* One height per type, not per variant.
* A crashing drone that is not one-way does not damage the building.

## 6. Acceptance

* `?load=town-drones`: the Ukrainian base sits inside its city; six Gerans dive
  one after another into the apartment block east of the base, each hit
  explodes, and the block smokes, burns and collapses.
* `crates/sim/tests/air.rs`: a Geran flying into the apartment block crashes and
  damages it; a Su-34 on the same line flies on; a Geran sent to a point
  detonates there once.
