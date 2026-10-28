# 36 — Ports and amphibious vehicles

Status: built (owner request 2026-10-28, backlog item 3 in `docs/roadmap.md`).
Depends on `03-phase2-core-loop.md` (harvesting), `26-map-features-plan.md`
(water, harbour props), `19-save-games.md`.
Decisions: D-02 (fixed-point deterministic simulation), D-05 (data driven).

## 1. Goal

A port pays supply trucks and never runs out. Some vehicles cross water.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; data: `INIZH.big` 1.04.

* **No warehouse regenerates.** `SupplyWarehouseDockUpdate.cpp:113` only takes
  boxes; there is no infinite flag; the largest stock is 400 boxes (Supply
  Dock, `CivilianBuilding.ini:505`). "Never runs out" exists only as the Oil
  Derrick, which pays its owner 200 every 12 s without trucks
  (`AutoDepositUpdate.cpp:146-172`, `CivilianBuilding.ini:25108-25111`).
* **Truck timing.** A warehouse dock action takes one box every
  `SupplyWarehouseActionDelay` (1000 ms on Chinese and GLA trucks, 4 boxes of 75).
* **Amphibious** (for the next PR): `BasicAmphibiousLocomotor` has
  `Surfaces = GROUND WATER`, the same speed on both (`Locomotor.ini:1334-1358`),
  and floats at the water surface (`Locomotor.cpp:2031-2043, 2312-2330`).

## 3. Differences from Zero Hour (owner requests)

* **D1 — a port is a supply source that never runs out**, visited by trucks
  (not a derrick). To keep it from outpaying depots, each load at a port makes
  the truck wait the port's `loadTicks` on top of its own.

## 4. Rules

`port-depot` (`data/rules/globals.yaml`, `lateTypes`): category depot, 3x2,
`infinite: true`, `loadTicks: 90` (6 s more per load; a Ukrainian truck loads
300 in 3 s at a depot, 9 s at a port). A map places one with
`depots: [{ origin, amount, type: port-depot }]`; `demo-coast` has one in its
harbour yard.

## 5. Architecture

* `TypeDef::infinite` and the depot type's `load_ticks`
  (`crates/sim/src/economy.rs`, `update_harvesting`): loading adds the depot's
  load ticks and never takes from an infinite depot's stock.
* `DepotDef::kind` (map `type`) picks the depot type; absent is the first one.
* `lateTypes` in globals: common types listed after the factions so adding one
  keeps every earlier type index (fixtures and saves pin them).
* Model `tools/models/port-depot.py` (containers, crates, a small crane).
* Example save `?load=port-supply`.

## 5b. Amphibious vehicles

* `amphibious: true` on a unit type (Zero Hour `Surfaces = GROUND WATER`):
  `ru-bmp-2` and `ru-brdm-scout` (the real vehicles swim). Same speed on land
  and water, as Zero Hour.
* `MapGrid::water_blocked` records the cells only deep water blocks;
  `features::water_blocks` builds a third nav layer (`Layer::Water`,
  `World::nav_water`) with them open, broken bridge decks included. Without
  deep water the layer is absent and amphibious units use the vehicle grid.
  Saves keep its flow goals (`waterFlowGoals`).
* Client: no change; the water surface sits just above the ground, so a
  swimming vehicle is drawn at the right height. Example save
  `?load=amphibious-crossing`.

## 6. Assumptions

* **A1** The port is neutral like every depot: any player's trucks use it.
* **A2** Its stock bar shows the map's `amount` and never drops.
* **A3** Ukraine has no amphibious vehicle yet (the Bradley does not swim);
  balance to be decided by the owner.

## 7. Acceptance criteria

AC-36-01..02 in `crates/sim/tests/port.rs`: a port pays and keeps its stock;
a supply depot still empties. AC-36-03..04 in `crates/sim/tests/amphibious.rs`:
a BMP-2 swims across the river while a T-72 takes a bridge; a swimming
vehicle survives a save.
