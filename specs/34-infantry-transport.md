# 34 — Infantry transport

Status: built (owner request 2026-10-28, backlog item 1 in `docs/roadmap.md`).
Depends on `31-environment-interaction.md` (garrison, whose containment model
this reuses), `19-save-games.md` (example save), `28-vehicle-crush.md`.
Decisions: D-02 (fixed-point deterministic simulation), D-05 (data driven).

## 1. Goal

Infantry board their own vehicles, ride hidden inside, fire from vehicles with
fire ports, and unload. A destroyed vehicle hurts or kills its riders.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; data: `INIZH.big` 1.04.

* **Entry** (`TransportContain::isValidContainerFor`, `TransportContain.cpp:182-210`;
  `ActionManager::canEnterObject`, `ActionManager.cpp:526-720`): own unit,
  `AllowInsideKindOf INFANTRY`, free slots for its `TransportSlotCount`
  (infantry 1).
* **Board order** (`AIStates.cpp:6221-6390`): the rider re-targets the vehicle
  every frame and walks to it; it enters on contact.
* **Exit** (`TransportContain.cpp:420, 634-641`; `OpenContain.cpp:1377-1403`):
  riders leave one at a time, `ExitDelay` apart (250 ms on Humvee and Troop
  Crawler).
* **Fire** (`OpenContain.cpp:76`, `TransportContain.cpp:594-621`):
  `PassengersAllowedToFire` defaults to No; Humvee and Battle Bus set it.
* **Death** (`OpenContain::onDie`, `OpenContain.cpp:857-876, 1441-1475`): each
  rider loses `DamagePercentToUnits` of its maximum hit points (100 kills it,
  Humvee; 10 on the Troop Crawler), survivors are ejected.
* **Values**: Humvee slots 5, fires, 100 %; Troop Crawler slots 8, no fire,
  10 %, heals riders 10 %/s.

## 3. Rules

| Vehicle | Model | Slots | Fire ports | Damage to riders |
|---|---|---|---|---|
| `ua-kozak-scout` | Humvee | 5 | yes | 100 % |
| `ru-brdm-scout` | Humvee | 4 | yes | 100 % |
| `ua-bradley` | Troop Crawler | 6 | no | 10 % |
| `ru-bmp-2` | Troop Crawler | 6 | no | 10 % |

`exitTicks: 4` (250 ms at 15 Hz). Data: `transport: { slots, fireFromInside?,
damagePct, exitTicks }` on the unit type (`data/factions/*.yaml`).

## 4. Architecture

* `crates/sim/src/transport.rs`. A rider keeps its entity with
  `aboard = Some(vehicle id)`; `Entity::contained()` (garrison or vehicle) is
  what hides, untargets and freezes a unit. Riders copy the vehicle position
  after the movement phase (`carry_riders`), so they see and fire from it.
* Commands `Board { units, carrier }` and `Disembark { carrier }`; order
  `Board`. The vehicle keeps `unloading = Some(ticks to next exit)`.
* Deaths phase: `unload_transports` then `empty_dead_transports` run before
  `remove_dead`.
* Hash and save write `aboard` and `unloading` only when set, so worlds without
  riders keep their hashes and saves.
* Snapshot: a rider row has `FLAG_INSIDE | FLAG_ABOARD` and its `progress`
  holds the vehicle id; enemies get no row for it.
* Client: right click an own transport with infantry selected boards it;
  a selected transport with riders shows "Unload (n)". Riders are never picked
  or box-selected. Example save `?load=infantry-transport`; setup order
  `{ board: <label> }`.

## 5. Assumptions (narrowest choices)

* **A1** Every foot unit takes one slot; vehicles never ride.
* **A2** Riders leave on free cells around the vehicle's cell; with no free
  cell the next rider waits.
* **A3** No healing inside (Troop Crawler heal not copied; our IFVs are not
  medical vehicles).
* **A4** The AI does not use transports yet.
* **A5** Riders boarding a moving vehicle chase it; there is no "vehicle waits".

## 6. Acceptance criteria

AC-34-01..07 in `crates/sim/tests/transport.rs`: board, entry rules and slots,
riding hidden, unloading one at a time, fire ports, death damage, hash and save.
