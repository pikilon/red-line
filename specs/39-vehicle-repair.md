# 39 — Vehicle repair at the factory

Status: built (owner request 2026-10-29, backlog item 6). Depends on
`35-engineering-works.md` (repair helpers) and `19-save-games.md`.
Decisions: D-02 (deterministic fixed point), D-05 (balance in data).

## 1. Goal

A damaged vehicle ordered onto its own vehicle factory docks outside and is
repaired for free, one vehicle at a time, while factory production continues.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; Zero Hour 1.04 INI.

* War factories are `REPAIR_PAD` buildings with `RepairDockUpdate`; selecting
  damaged vehicles and right-clicking the factory issues `MSG_GET_REPAIRED`
  (`FactionBuilding.ini:24948,24966-24972`; `CommandXlat.cpp:3678-3710`).
* Eligibility requires a living mobile damaged vehicle and a completed visible
  own/allied repair pad; full-health vehicles cannot start
  (`ActionManager.cpp:146-204`). Vehicles dock, not enter containment
  (`AIUpdate.cpp:3751-3759`; `AIDock.cpp:55-60,613-636`).
* Repair is free. The rate is computed once from the initial missing HP and
  `TimeForFullHeal = 5000 ms`; one active docker repairs while others wait, then
  the vehicle exits automatically (`RepairDockUpdate.cpp:91-152`;
  `DockUpdate.h:150-151`). Production and repair modules are independent.

## 3. Rules

* `Command::RepairVehicle { units, factory }` accepts own, living, damaged,
  non-foot vehicles and an own complete building with `repairsVehicles: true`.
  HQ and supply center do not become repair pads merely by producing vehicles.
* Vehicles approach the outside footprint and wait within the existing dock
  range. The lowest-id docked vehicle repairs; all others wait with their own
  countdown untouched. Losing the factory or becoming ineligible returns to idle.
* `environment.repair.vehicleRepairTicks = 75` (five seconds at 15 Hz). The
  rate is fixed when the cycle starts from the initial missing HP: each active
  tick restores the share of that deficit that is due by then, so the deficit is
  repaired in exactly 75 ticks. Damage taken during the cycle is not healed by
  it; when the countdown ends below full, a fresh cycle starts for the remaining
  deficit. Repair costs no credits.
* The vehicle remains outside and targetable. Production, rally and construction
  state are untouched; completion returns the vehicle to idle.
* No explicit five-position queue geometry is added: waiting vehicles use normal
  movement and separation around the dock.

## 4. Architecture

* `Order::RepairVehicle { factory, missing, remaining }` stores the deterministic
  countdown, so save/load continues the same repair. `crates/sim/src/repair.rs`
  reuses footprint approach, distance, entity HP clamp and repair balance.
* Both vehicle factories set `repairsVehicles: true` in faction data; the schema
  and generated ruleset carry it to sim and client.
* `client/src/input/repair.ts` resolves left-click factory repair (spec 08
  §3.9). Existing HP bars and receding damage effects show recovery; no
  containment or new renderer is needed.
* Example save `?load=vehicle-repair`: two damaged vehicles beside their factory
  and a supply center. Select a vehicle and click the factory.

## 5. Assumptions

* **A1** Only same-player factories are eligible until Red Line has allies.
* **A2** Mixed selections send only damaged vehicles; other units keep orders.
* **A3** AI does not seek factory repair yet.

## 6. Acceptance criteria

AC-39-01..05: one vehicle finishes in exactly 75 ticks while production advances
and the second waits; full/foot/wrong-pad cases are rejected; save/load preserves
an active countdown; damage taken mid-cycle starts a fresh cycle; client filtering
and worker dispatch are covered; real mouse input repairs a vehicle in the example.

## Addendum: Repair button (owner request 2026-10-29)

Selecting a damaged own vehicle while an own complete repair factory stands
shows a Repair at factory button (Units section). It sends `repairVehicle` to the
factory nearest the first selected vehicle; a left click on the factory still works
(spec 08 §3.9).
