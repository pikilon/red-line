# 55 — Dock bays: servicing units go inside, two at a time

Status: built (issue #501). Amends `03-phase2-core-loop.md` (supply trucks),
`39-vehicle-repair.md` and `40-infantry-healing.md`.
Decisions: D-02 (deterministic fixed point), D-05 (balance in data).

## 1. Goal

Supply trucks loading at a supply depot or unloading at a supply center, vehicles
being repaired at a vehicle factory and infantry being healed at a barracks drive
or walk **into the building** instead of parking on its outside edge. A building
services at most **two** units inside at once; further arrivals wait outside and
go in, in arrival order, as slots free up.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`, `DockUpdate/`.

* Docks have `DockStart` / `DockAction` / `DockEnd` points: the docker enters, works
  at the action point and leaves by the end point (`DockUpdate.cpp:234-250`).
* Slots are `NumberApproachPositions` (`DockUpdate.cpp:45,83-97`); waiting spots are
  the `DockWaiting` bones, and a unit advances one spot only when the spot ahead is
  free (`DockUpdate.cpp:187-232`). Only the active docker is cleared to enter.
* Zero Hour gives up when a fixed dock has no free spot, and waits at most 30 s
  (`AIDock.cpp:167-290`); barracks healing uses `HealContain` capacity
  (`HealContain.cpp`, `OpenContain.cpp`). The shipped INI numbers were not readable.
* Red Line follows the model (slots, waiting outside, enter/work/leave) but, by owner
  request, keeps waiting units in the queue instead of giving up (assumption A2).

## 3. Rules

* `globals.dockSlots` (default 2, `data/rules/globals.yaml`) is the number of units a
  supply depot, supply center or repair factory services inside at once.
  `environment.infirmary.slots` (2) is the same limit for a barracks.
* A unit within `dockRangeCenti` of the building that finds a free slot is placed
  inside the footprint (`Entity.aboard = building`: hidden, untargetable, immobile)
  and starts its work: truck load/unload timer, vehicle repair cycle, infantry heal.
* A unit that finds no free slot stays outside at the dock and enters the first tick a
  slot is free. Lower unit index goes first, so the queue is deterministic.
* When the work ends the unit leaves onto the passable cell of the footprint edge
  facing its next stop (a loaded truck faces the supply center, an empty one the
  nearest depot; others use the approach cell).
* A unit inside whose order changes (a new command, the building dying, selling) is
  put outside again; a unit whose building vanished is released.
* Units on a `Move` stop when touching an idle unit inside the goal cell, so a queue
  outside a dock on a rally point cannot keep them walking forever.
* Repair still costs 50 % pro rata (spec 38). Both vehicles inside repair at the same
  time, each in `vehicleRepairTicks`; production and rally are untouched.

## 4. Assumptions

* A1: trucks are hidden while inside (like infantry healing) instead of drawing a
  truck overlapping the building model.
* A2: queued units wait indefinitely, not Zero Hour's 30 s give-up.
* A3: ports (spec 36) are depots and use the same two slots.

## 5. Acceptance criteria

* AC-55-01: at most two supply trucks are inside one depot at once; the third waits
  outside and enters once one leaves (`tests/harvest.rs`).
* AC-55-02: two damaged vehicles repair together inside a factory, a third waits
  outside and is repaired afterwards, never more than two inside (`tests/repair.rs`).
* AC-55-03: at most two infantry heal inside a barracks, the rest heal in turn
  (`tests/infirmary.rs`, AC-40-03).
* AC-55-04: a truck unloads inside the supply center and drives out (AC-03-24).

## 6. Try it

`?load=economy`, `?load=vehicle-repair` and `?load=infantry-healing`.
