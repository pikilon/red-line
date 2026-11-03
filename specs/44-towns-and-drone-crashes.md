# 44 — Bases in towns and drones crashing into buildings

Status: implemented (owner request 2026-11-03).
Depends on `26-map-features-plan.md`, `31-environment-interaction.md`,
`32-river-port-map.md`, `43-air-and-drones.md`.

## 1. Goal

* On the default skirmish map each base starts in the middle of a town, as
  front-line bases do in reality.
* Drones can crash into civilian buildings.

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

### 4.1 Towns around the bases

* `river-port` has a town around each start: a north row (townhouses, shops, an
  apartment block, a church and one more block across the main road), a west
  row of houses, an east row across the main road (shops, houses, an office
  tower) and a south row (shops, a gas station, houses, townhouses, a block),
  with lamp posts, parked cars and a bus stop. The core around the HQ, the
  depot and the main road stays clear to build on; the AI site search
  (spec 05 §5.5) places buildings on free cells, beyond the town when needed.
* The east town mirrors the west one (left-right, like the rest of the map).
* Town buildings are ordinary civilian features: garrisonable, destructible.

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

## 5. Assumptions

* "Drones" means the class `low` flyers: Geran, Molniya, Orlan, FPV, Sting and
  Baba Yaga.
* One height per type, not per variant.
* A crashing drone that is not one-way does not damage the building.

## 6. Acceptance

* `?load=town-drones`: the Ukrainian base sits inside its town; two Gerans fly
  into the apartment block across the main road and explode there, the third flies
  down the street and passes, and the Orlan falls at the office tower.
* `crates/sim/tests/air.rs`: a Geran flying into the apartment block crashes and
  damages it; a Su-34 on the same line flies on.
