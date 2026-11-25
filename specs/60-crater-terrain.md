# 60 — Craters as terrain

Status: built (sim); the client keeps drawing its own relief. Depends on
`24-terrain-relief.md` (§3.1, §6), `29-weapon-ground-impacts.md` (§4),
`35-engineering-works.md` (§5b, the wheels grid), `19-save-games.md`.
Decisions: D-02 (deterministic fixed point), D-05 (balance is data).
Closes issue #333.

## 1. Goal

Shell craters stop being only a picture. Tracked vehicles drive over them
slowed; wheeled vehicles are slowed by shallow ones and cannot enter a deep
one, so they route around it (the AI too); infantry are not affected. Owner
request, 2026-10-25: "some vehicles should not cross craters without tracks,
and if it is very deep they should avoid it".

## 2. Precedent (`generals-precedent`, Zero Hour)

* Terrain is a per-cell surface mask; a locomotor's `Surfaces` decide which
  cells it may enter (`AIPathfind.cpp:4758` `validLocomotorSurfacesForCellType`,
  `:4787` `validMovementTerrain`; `Locomotor.cpp:445`). Treads, wheels and legs
  differ in how they move and turn, not in which cells are legal.
* The pathfinding map is reclassified only on object add or remove, bridge
  state changes and map load (`AIPathfind.cpp:9686`, `:3613`); the one
  permanent footprint that never clears is `KINDOF_BLAST_CRATER` (`:4145`).
  There is no deformation path and no rough-ground speed multiplier: speed
  only drops with body damage (`Locomotor.cpp:792-802`).
* Shipped INI values were not read.

Differences, on purpose: Zero Hour has no crater gameplay, so Red Line adds
a depth grid and a per-locomotor rule. It keeps Zero Hour's shape: the
legal-cell mask per locomotor is what routes units (the existing `Wheels`
navigation grid, spec 35 §5b, closes the deep cells), and the map updates
explicitly on the fixed tick when a crater is dug. The speed damping is new.

## 3. Rules

1. The world keeps a crater depth per cell in centi-tiles (`craters`, empty
   until the first crater). Depth is saved, hashed and capped at
   `craters.maxDepthCenti` (50, spec 24 §3.1).
2. A projectile that detonates without damaging an entity directly digs the
   crater of its damage type from `craters.digs` (radius and centre depth, in
   centi-tiles; only damage types listed dig). Cells whose centre lies within
   the radius sink by `depth × (1 − t²)²`, `t` being the distance in radii,
   rounded to the nearest centi-tile; deeper shells stack. Blocked cells and
   water are not dug.
3. A cell whose depth reaches the wheels' `blockDepthCenti` (20) leaves the
   `Wheels` grid (closed like a deep trench). Flow fields are recomputed in
   that tick and moving orders re-route. Tracks and feet never lose a cell.
4. A unit standing in a crater drives at `100 − slowPct × depth / maxDepth`
   percent of its top and reverse speed; `slowPct` per kind: tracks 35, wheels
   55, foot 0.

## 4. Data

`data/balance/environment.yaml` `craters`: `maxDepthCenti`, `digs` (by damage
type: `radiusCenti`, `depthCenti`, matching `data/render/impacts.json`) and
`movers` (`foot`, `tracks`, `wheels`: `slowPct`, optional `blockDepthCenti`).
`build-data` resolves damage types to indices into `ruleset.json`.

## 5. Acceptance criteria

* AC-60-01: a shell digs a crater whose centre sinks, stacks and is capped at
  the maximum; far cells stay flat.
* AC-60-02: a crater past the wheels' block depth closes the cell on the
  wheels grid only; tracks and feet keep it.
* AC-60-03: a supply truck ordered across a deep crater never enters its cell
  and arrives; a Leopard crosses.
* AC-60-04: a crater slows a tank and a truck but not a rifleman.
* AC-60-05: craters change the state hash and survive a save and load
  (including the closed wheels cell).
* AC-60-06: a save without craters loads and writes no `craters` field; worlds
  without craters hash as before.
* Example save `crater-field` (`?load=crater-field&mute=1`): a HIMARS digs a
  field; a truck and a tank are ordered across it.

## 6. Assumptions

* The simulation digs its own craters from the same damage types and sizes as
  the client's relief (spec 29 §4) but does not read `impacts.json`; the two
  tables are kept in step by hand. The client does not yet read the sim grid
  (no snapshot field), so a crater dug by the sim and one drawn by the client
  can differ slightly in outline.
* Craters of vehicle wrecks (spec 29 §3.6) and trench craters (spec 35 §5c)
  are client-only and do not affect movement; only shell craters do.
* Rock ground is not told apart from soil in the sim: craters dig on any open,
  dry cell.
* Tracked vehicles are never blocked, even by a maximum-depth crater: they
  only slow. Pathfinding does not avoid slow cells.
* Infantry are unaffected (`slowPct: 0`); the number is data.
* A wheeled unit caught in a cell that closes under it rolls out through the
  existing way-out rule (spec 35 §5b).
* Crater cover (`cover.crater` in `environment.yaml`) remains unapplied.
