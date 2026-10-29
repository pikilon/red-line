# 38 — Dozers repair buildings

Status: built (owner request 2026-10-29, backlog item 5). Depends on
`35-engineering-works.md` (repair work) and `19-save-games.md`.
Decisions: D-02 (deterministic fixed point), D-05 (balance in data).

## 1. Goal

A dozer ordered onto a damaged friendly building approaches it and restores its
hit points for free until it is whole.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; Zero Hour 1.04 INI.

* Repair is a contextual object-target command offered to selected dozers, not a
  repair-button mode (`CommandXlat.cpp:1782-1808`; `AIGroup.cpp:2320-2330`).
* A damaged living structure is eligible; either side under construction is not
  (`ActionManager.cpp:383-448`). The builder uses construction-style approach
  positioning (`DozerAIUpdate.cpp:1879-1920,1972-2028`).
* Docked healing costs no money and runs at `RepairHealthPercentPerSecond = 2%`
  of maximum HP (`DozerAIUpdate.cpp:469-790`; `AmericaVehicle.ini:1738-1741`).
* Healing does not stack: one active benefactor repairs; another command
  interrupts the task and completion returns the dozer to idle
  (`Object.cpp:1897-1938`; `DozerAIUpdate.cpp:670-684,1569-1627`).

## 3. Rules

* `Command::RepairBuilding { units, building }` accepts only a living, complete,
  damaged building of the commanding player and its dozers (types that build).
  Infantry and other vehicles do not participate. Wrong-owner, full,
  incomplete, dead or missing targets are ignored.
* A dozer approaches the building footprint and works within the existing
  1.5-tile repair range. Another order cancels the job; a lost or invalid target
  returns the dozer to idle.
* Once a second, the lowest-id active dozer restores
  `dozerPoints × permillePerSecondPerPoint` of maximum HP. Existing values are
  3 × 7 = 21 permille (2.1 %, the closest existing data match to Zero Hour's
  2 %). Additional dozers do not increase the rate. Repair is free.
* Construction progress, production queues, rally points and power are unchanged.
  HP clamps at maximum and every repairer then becomes idle.
* No idle auto-repair scan is added in this slice.

## 4. Architecture

* `crates/sim/src/repair.rs` owns validation, `Order::RepairBuilding`, approach,
  one-second healing and completion. It reuses `work_points`, `build_goal`,
  `entity_distance` and the repair balance; entity HP has its own small clamp
  helper because player buildings are not map features.
* `client/src/input/repair.ts` resolves a left click on an own complete damaged
  building and filters the selection to dozers (spec 08 §3.9). Existing health
  bars and dozer blade work animation provide presentation; no new indicator is
  required.
* Orders and pending commands join the existing deterministic save/hash paths.
* Example save `?load=building-repair`: two dozers beside damaged power plant and
  barracks. Select the dozers and click a damaged building.

## 5. Assumptions

* **A1** Only same-player buildings are repairable; allied/neutral repair waits
  for such relationships to exist in Red Line.
* **A2** Mixed selections send only dozers; other selected units keep their orders.
* **A3** AI does not issue building-repair orders yet.

## 6. Acceptance criteria

AC-38-01..05: one active dozer repairs at the data rate once a second until full;
wrong workers/targets are rejected; active repair survives a save with identical
future hashes; the client emits commands only for eligible dozers and worker
dispatch is preserved; real mouse input repairs the example building.
