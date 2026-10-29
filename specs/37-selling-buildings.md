# 37 — Selling buildings

Status: built (owner request 2026-10-29, backlog item 4). Depends on
`03-phase2-core-loop.md` (buildings, queues and economy) and `19-save-games.md`.
Decisions: D-02 (deterministic fixed point), D-05 (balance in data).

## 1. Goal

The owner sells any complete building for part of its cost. Selling a producer
also cancels and refunds everything in its queue.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; Zero Hour 1.04.

* Completed controllable buildings expose Sell; unfinished buildings instead
  have Cancel Construction (`ControlBar.cpp:1740-1745,1850-1900`;
  `ControlBarUnderConstruction.cpp:70-99`).
* Sell is independent of health, power, occupants and queues. Queued work is
  cancelled and fully refunded; occupants are evicted
  (`BuildAssistant.cpp:1499-1575`; `ProductionUpdate.cpp:1140-1165`).
* `SellPercentage = 50%`; the normal refund is integer truncation of cost × 0.5
  (`BuildAssistant.cpp:256-264`; `ThingTemplate.cpp:1532-1541`).
* Retail takes about six seconds to finish a sale and pays at the endpoint
  (`BuildAssistant.cpp:176-177,214-264,280-285`).

## 3. Difference in this slice

**D1 — sale completion is immediate.** The six-second scaffold/shrink animation
and its sale-in-progress state are not added. This avoids a save-format change;
the queue and building refunds happen together in the command phase and normal
death cleanup removes the building in the same tick.

## 4. Rules

* `Command::Sell { building }` accepts a living, complete, own entity building.
  Enemy, incomplete, dead, unknown and repeated-sale targets are ignored.
* Every queued item is refunded at full cost, including the partly produced
  head. The building refunds `floor(cost × sellRefundPercent / 100)` regardless
  of current HP. Credits use saturating addition.
* `sellRefundPercent: 50` lives in `data/rules/globals.yaml`.
* Selling clears old attacker attribution, then uses ordinary death removal:
  footprints open, navigation rebuilds, production stops and the last building
  can cause defeat. Power and vision retain their normal one-final-tick death
  timing. Player-owned entity buildings currently contain no occupants.
* The command panel offers **Sell (refund)** for exactly one complete own
  building, producing or not. It stays enabled with a full queue.

## 5. Architecture

* `crates/sim/src/economy.rs`: validation and refunds beside Cancel; no new
  entity state or snapshot layout. Pending Sell commands use the normal save
  command encoding.
* `client/src/ui/commandPanel.ts`: sell offer and handler; the app sends the
  selected building id through the ordinary worker command path.
* Example save `?load=selling`: complete power plant, barracks and vehicle
  factory with 5000 credits. Queue units, then select a building and sell it.

## 6. Assumptions

* **A1** There is no confirmation dialog and no last-building exemption.
* **A2** Ordinary destruction presentation plays; there is no dedicated sale
  animation or sound in this slice.
* **A3** AI does not sell buildings yet.

## 7. Acceptance criteria

AC-37-01..05: exact building plus whole-queue refund exactly once; rejected
invalid targets; pending-sale save continuity; complete/non-producing and
multi-selection panel cases plus worker dispatch; mouse-driven sale removes the
building and returns credits. The example joins the generic save round trips.
