# 38 — Dozers repair buildings

Status: built (owner request 2026-10-29, backlog item 5). Depends on
`35-engineering-works.md` (repair work) and `19-save-games.md`.
Decisions: D-02 (deterministic fixed point), D-05 (balance in data).

## 1. Goal

A dozer ordered onto a damaged friendly building approaches it and restores its
hit points until it is whole, paying half the build price pro rata (section 3).

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
  2 %). Additional dozers do not increase the rate.
* **Repair costs credits (owner request 2026-11-04).** Restoring hit points of a
  unit or building costs `environment.repair.costPermille` (500 = 50 %) of its
  build price, pro rata to the hit points restored: half a 1200-credit tank's
  health costs 300 (50 % x 1200 x 0.5). The price is charged progressively with
  every heal step as `floor(cost x permille x hp / (1000 x maxHp))` evaluated
  after minus before, so steps of any size add up to the exact total with no
  per-step rounding and no extra state. If the owner cannot pay a whole step,
  only the affordable hit points are restored (never negative credits) and the
  repair order ends (workers/vehicle go idle, the existing stop feedback); the
  player can reissue it once funds exist. Zero Hour repairs free (precedent
  above), so this is a deliberate Red Line deviation. It applies to dozer
  building repair and the vehicle pad (spec 39). Not charged: bridge and
  map-feature repair (not units or buildings), infantry healing in barracks
  (spec 40) and aircraft resupply at airfields (spec 43), which keep their
  Zero Hour-style free service.
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

AC-38-06..08 (`crates/sim/tests/repair_cost.rs`): half a 1200-credit, 750 hp
tank repaired at the pad costs 300 credits; repair stops when funds run out
(partial hp, credits 0, idle); dozer repair of a building is charged pro rata
and refuses to continue without credits.
