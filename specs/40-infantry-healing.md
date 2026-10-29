# 40 — Infantry heal at the barracks

Status: built (owner request 2026-10-29, backlog item 7). Depends on
`19-save-games.md` and `34-infantry-transport.md` (containment).
Decisions: D-02 (deterministic fixed point), D-05 (balance in data).

## 1. Goal

Damaged own infantry ordered onto the barracks walks in, heals for free while
production continues, then walks out whole. Full-health infantry does not enter.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; Zero Hour 1.04 INI.
Precedent researched for the owner before building this slice (backlog item 7).

* Barracks-style structures carry `HealContain` (`ContainModule = HealContain`,
  `HealContain.cpp`): damaged own infantry right-clicked onto the building walks
  in for free. Full-health infantry and other units are rejected by the normal
  contain-entry checks.
* Occupants heal over 2000 ms and leave automatically when whole; the contain
  module is independent of production, so the barracks keeps training while it
  heals.
* Zero Hour declares a nominal capacity of 10. The module did not consistently
  enforce the cap; Red Line enforces it as a rule (assumption A1).

## 3. Rules

* `Command::HealAt { units, building }` accepts own, living, damaged, free foot
  infantry and an own complete building with `healsInfantry: true` (both
  barracks). Full-health infantry, vehicles, contained units, enemies, incomplete
  buildings and buildings without the flag are ignored.
* Eligible infantry walk to the building footprint and enter within the existing
  1.5-tile range. A barracks holds at most `infirmary.slots = 10` patients; a
  unit that arrives when it is full returns to idle.
* While inside, a patient is hidden, untargetable and immobile. Each active tick
  restores the share of its entry deficit that is due, so the deficit is healed
  in exactly `infirmary.healTicks = 30` ticks (two seconds at 15 Hz), free. The
  last tick leaves it whole and it walks out to the first free foot cell around
  the building. If boxed in, it waits inside until a cell frees.
* Production, queues, rally points, power and construction are untouched.
* If the barracks is destroyed or sold with patients inside, they are ejected
  alive around the footprint (lowest id first). A patient with no free cell dies
  in the collapse. Ejecting deals no damage.
* No early manual unload: the stay is short and auto-exits (Zero Hour
  `HealContain` behaviour).

## 4. Architecture

* `crates/sim/src/infirmary.rs` owns validation, `Order::Heal`, approach, the
  timed heal and the exit. Containment reuses `Entity.aboard` with the barracks
  id, so the entity is already hidden, untargetable and immobile through
  `Entity::contained`; the countdown and the entry deficit live in the order and
  therefore in the save/hash paths. Transport-only paths ignore the barracks
  (`apply_disembark` requires a transport), and a dedicated death pass ejects
  patients before the building is removed.
* Exit cells reuse the deterministic `free_cell_around` ring scan, the foot grid
  and `footprint_distance`/`footprint_center`.
* Data: `healsInfantry` on the barracks types and an `infirmary` block in
  `data/balance/environment.yaml` (`healTicks`, `slots`). The schema, generated
  ruleset and client type definitions carry both.
* `client/src/input/repair.ts` resolves a right click on an own complete barracks
  and filters the selection to damaged foot infantry.
* Example save `?load=infantry-healing`: two damaged riflemen and one whole
  rifleman beside their barracks. Select the damaged ones and right click the
  barracks.

## 5. Assumptions

* **A1** The nominal capacity of 10 is enforced; the Zero Hour module bug that
  did not enforce it is not copied.
* **A2** Only same-player barracks take patients; allies and neutral buildings
  wait for such relationships.
* **A3** Mixed selections send only damaged infantry; other selected units keep
  their orders.
* **A4** AI does not use infirmaries yet.

## 6. Acceptance criteria

AC-40-01..08: a damaged patient heals in exactly 30 ticks, reaches full and exits
automatically; full-health, vehicles, enemies, incomplete and non-infirmary
buildings are rejected; production advances while it heals; only 10 patients fit;
a mid-heal save continues with identical hashes; a destroyed barracks ejects its
patients unharmed; client filtering and worker dispatch are covered; real mouse
input heals the example rifleman and he walks out.
