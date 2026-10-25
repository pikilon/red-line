# 24 — Terrain relief (visual only)

Status: accepted (owner request 2026-10-24).
Depends on `10-phase4d-remastered-look.md` §4 (terrain meshes),
`07-phase4b-combat-effects.md` §3 (explosions).
Decisions: D-02 (the simulation stays deterministic: nothing here touches it).

## 1. Context

The owner wants the ground to change during a match: big explosions sink it at
the impact point, and heavy vehicles sink it slightly on mud and snow. Changes
must be smooth and read well in the isometric camera.

## 2. Precedent (Zero Hour) and the difference

Note from `generals-precedent`:

* Weapon and explosion marks are **decals**, not geometry: `TerrainScorchFXNugget`
  → `addScorch` (`FXList.cpp:446-459`), at most `MAX_SCORCH_MARKS = 500`, FIFO,
  no fade (`BaseHeightMap.cpp:2052`, `BaseHeightMap.h:247`).
* Vehicle marks are decals too: `TerrainTracksRenderObjClass`, pool of
  `MaxTerrainTracks = 100`, ring buffer of edges, alpha fade
  (`W3DTerrainTracks.cpp`, `GameData.ini`).
* Real height changes exist only for script-placed `BLAST_CRATER` footprints
  (`TerrainLogic::createCraterInTerrain`, `TerrainLogic.cpp:2862`, lower-only)
  and building flattening (`flattenTerrain`, `TerrainLogic.cpp:2644`). No
  weapon, explosion or vehicle code deforms terrain, and the original has no
  snow or mud sinking.

**Difference.** The original gives the same read with decals; craters and
tread marks as decals belong to the parallel decal task. This spec adds what
the owner asked for on top: a real **mesh relief**, rendered only (the
simulation height stays flat). The cost is low because the relief is a small
CPU height grid whose changed vertices are rewritten in a local range, not a
shader or a second mesh.

## 3. Behaviour

1. Superseded by spec 29 §4: craters come from each weapon's impact profile
   at its detonation point, on a fine patched grid with a raised rim. They
   still sink over 350 ms with a smoothstep ease.
2. Crater sink at one point is capped at 0.2 tiles; further hits only change
   the rim (spec 29 §4, owner request 2026-10-25). Vehicle press adds at most
   0.07 on top, still well under the 0.5-tile scout/Humvee height.
3. Tracked vehicles (weight 1) and wheeled ones (0.5) sink the ground while
   they drive: 0.05 tiles per tile driven × weight × softness, floor
   `0.07 × softness`. Infantry and buildings press nothing.
4. Softness is 0..1 per tile corner. Default: the dirt-overlay opacity (the
   mud patches). Snow layers replace it with `setSoftness(mask)`.
5. Sunk ground is darker (up to 45 % at 0.3 tiles), so the relief also reads
   as damp soil from far away.
6. Grass and dirt use the same heights, so they never separate. Rocks are
   untouched. Units, hulks and corpses stand on the visual surface: `groundY`
   reads the elevation (spec 30) plus this relief, and vehicles pitch and roll
   into a crater with `groundTilt` (owner request 2026-10-25). The simulation
   still walks them on the flat 2D ground.

## 4. Interface (for the decal and snow layers)

`terrainDeformerOf(terrain)` returns the controller of the terrain group;
`createTerrain` keeps its signature, so layers drawn above keep working.

* `crater(x, z, radius, depth, startMs)`: schedule a crater.
* `press(sources, nowMs)`: weights moving over the ground.
* `setSoftness(mask | null)`: per-corner softness, `(width+1)×(height+1)`.
* `heightAt(x, z)`: current surface height, the map elevation (spec 30) plus
  the sink (≤ 0), so decals and units can follow the surface.
* `update(nowMs)`: called once per frame by the skirmish loop.
* `setGroundRelief(heightOf | null)` (`elevation.ts`): the renderer-wide hook
  that makes `groundY` and `groundTilt` read the surface with relief; the
  skirmish passes `heightAt` (elevation included).

## 5. Performance

Craters flush every frame while growing; vehicle sinking flushes at most every
200 ms. Only the changed slot range is re-uploaded (`addUpdateRange`). Debug
API: `__redline.relief()` returns flush count, total flush ms and vertices.
Measurement: see the pull request.

## 6. What would make it affect gameplay (separate task)

The simulation would need its own fixed-point height grid in `crates/sim`:
craters and tread sinking as deterministic edits (part of the world hash and
of saves, spec 19), with the pathfinder and line-of-sight rules reading it
(slope limits, speed on soft ground). The client would then read the grid
from snapshots instead of computing it. EA does the same only for scripted
craters and updates its pathfinding map explicitly.

## 7. Acceptance criteria

* AC-24-01: a thermobaric or HE explosion makes the ground at its target sink
  smoothly within 350 ms.
* AC-24-02: a tank driving over a dirt patch leaves it up to 0.07 tiles lower;
  on plain grass it sinks about 0.
* AC-24-03: the crater sink never exceeds 0.2 tiles, the relief never exceeds
  0.5 tiles with vehicle press, and it never changes the simulation hash.
* AC-24-04: with 100+ vehicles moving, relief upkeep stays well under 0.5 ms
  per frame.
* AC-24-05: a unit standing on a fresh crater is drawn at the crater surface
  (`groundY` includes `heightAt`) and tilts towards its slope; on a flat map
  with no relief it still stands at y = 0 (unit test).
