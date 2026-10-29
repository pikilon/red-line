# 33 — Production rally points

Status: built (owner request 2026-10-29; amended by spec 08 §3.9). Depends on
`03-phase2-core-loop.md` (production and `Command::Rally`) and
`19-save-games.md`. Decisions: D-02 (fixed-point deterministic simulation),
D-05 (data driven).

## 1. Goal

A player sets or replaces a barracks or vehicle factory rally point with the
Rally point button and a left click, sees it while that building is selected,
and every subsequently produced unit leaves the building and moves there.
Spec 08 §3.9 D2: a plain left click on the ground does not set the rally; the
button is the only path.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; Zero Hour 1.04 INI.

* A context click on empty ground sends `MSG_SET_RALLY_POINT`; a new click
  replaces the point and there is no gameplay clear operation
  (`CommandXlat.cpp:2204-2223,3741-3783`; `GameLogicDispatch.cpp:137-210`).
* While the producer is selected, the client draws a local-player-colored
  `RallyPointMarker`; deselecting destroys only the visual, not the stored point
  (`ControlBarCommand.cpp:493-507`; `ControlBar.cpp:2193-2194,2693-2744`).
* Production exits at `UnitCreatePoint`, clears the natural exit and then orders
  the player rally point. Units already exiting keep their existing path
  (`DefaultProductionExitUpdate.cpp:65-124,151-178`;
  `QueueProductionExitUpdate.cpp:71-167`; `AIUpdate.cpp:3383-3413`).

## 3. Rules

* An own production building accepts the command (keeping spec 03's existing
  validation). The Rally point button arms the next left click, which replaces
  the point; there is no separate clear command.
* The existing exit cell is Red Line's natural exit. A produced unit spawns
  there and immediately receives its own ordinary move order to the current
  rally point. Changing the point never reroutes a unit already produced.
* The requested point is shown in the controlling player's colour only while
  that producer is selected. Deselecting hides the marker but preserves it.
* The point is simulation state, survives saves and appears in snapshots. The
  client only sends commands and renders it.

## 4. Architecture

* Keep `Site.rally` and the production-exit `Move` in `crates/sim/src/economy.rs`;
  add rally coordinates to building snapshots and setup-command examples.
* Reuse the existing `rally` intent through `resolveRally` in
  `client/src/input/intent.ts`; only the armed Rally button calls it.
* Render a small ground marker from snapshot state, selected-building only.
* Example save `?load=rally-points`: both a barracks and a vehicle factory have
  distinct rally points and enough credits to queue units and watch both exit
  paths. Setup order `{ rally: [xCenti, yCenti] }` authors the initial points.

## 5. Assumptions

* **A1** The existing exit cell and normal path remapping stand in for Zero
  Hour's natural-rally path and destination adjustment; no new exit delay is in
  scope.
* **A2** Supply trucks still prefer their automatic harvest order when no rally
  point is set, as in spec 03; a rally point takes precedence when present.
* **A3** Rally markers have no gameplay collision and are not saved as entities.

## 6. Acceptance criteria

AC-33-05..08 (01..04 already belong to the bridge-repair tests): factory and
barracks units receive their building's current rally move; changing a point
does not reroute existing units; snapshots/saves retain it; the client sets and
replaces a point and shows its marker only for the selected producer; the
example save demonstrates both production types.
