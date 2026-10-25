# 30 — Terrain elevation: hills, ridges, plateaus and cliffs

Status: accepted (owner request 2026-10-25).
Depends on `03-phase2-core-loop.md` §4 (map data), `24-terrain-relief.md`
(visual craters, which now sit on top of the elevation), `22-snow.md`.
Decisions: D-02 (the simulation stays fixed-point and deterministic).

## 1. Context

The owner wants real relief on the maps: hills, ridges and plateaus with
slopes, and steep cliffs that ground units cannot cross. Units, buildings,
shots and effects must stand at the right height, the ground must be lit by
its slope, and snow and the crater relief must keep working on hills.

## 2. Precedent (Zero Hour)

Note from `generals-precedent` (EA source `CnC_Generals_Zero_Hour@0a05454d8`):

* **Heightmap.** One `UnsignedByte` per sample (`BaseHeightMap.h:44`), cell
  `MAP_XY_FACTOR = 10`, height `MAP_HEIGHT_SCALE = 10/16` per byte
  (`MapObject.h:60-61`): a byte is 1/16 of a cell. Ground height is the plane
  of the cell triangle split by the `fy > fx` diagonal (`getHeightMapHeight`,
  `BaseHeightMap.cpp:860,932`), clamped at the map edge.
* **Cliffs.** A cell is `CELL_CLIFF` when max − min of its four corners
  exceeds `PATHFIND_CLIFF_SLOPE_LIMIT_F = 9.8` world units
  (`WorldHeightMap.cpp:65,2312-2327`): a spread of 16 bytes or more. Cliff
  cells allow only `LOCOMOTORSURFACE_CLIFF` locomotors (saboteur, Burton);
  every vehicle and infantry locomotor is `GROUND` (`AIPathfind.cpp:4758`,
  `Locomotor.ini`).
* **Unit height.** Ground units take `z = getLayerHeight(x, y)`
  (`PhysicsUpdate.cpp:763-784`). A slope pitch/roll from the terrain normal
  was not confirmed in the code (only `TerrainLogic::alignOnTerrain`, with no
  caller found).
* **Vision and weapons.** Shroud reveal is a 2D disc, no height term
  (`PartitionManager.cpp:3969`, `Object.cpp:5125`). Attack range is 2D
  (`ATTACK_RANGE_IS_2D`, `Weapon.cpp:80-85`); there is no high-ground bonus.
  Direct fire checks terrain line of sight (`BaseHeightMap.cpp:1011-1113`,
  `Weapon.cpp:3090`).

**Difference.**

* Vehicles tilt to the slope (the owner asked for it; Zero Hour's tilt was not
  confirmed). It is render-only.
* Maps author elevation as features (hills, ridges, plateaus, ramps) that the
  data build turns into the byte grid, instead of a painted heightmap.
* Terrain line of sight for direct fire is **not** in this spec: blocking shots
  needs the attack-move logic to reposition units, or they would stand still
  under a ridge. It is the next step (§8).

## 3. Behaviour (simulation)

1. A map may have `elevation` in `data/maps/<id>.yaml`. Heights are steps of
   1/16 tile at tile corners. Features, highest wins per corner:
   * `hills: { center, radius, height }`: a rounded dome.
   * `ridges: { from, to, radius, height }`: the dome along a segment.
   * `plateaus: { rect, height, slope?, rough? }`: flat over the cells of
     `rect`, falling to 0 over `slope` tiles (0 = a sheer edge); `rough`
     tiles of noise bend the outline. The noise is point-symmetric in the
     plateau's own frame, so mirrored plateaus stay mirrored.
   * `ramps: { from, to, width, height }`: `height` at `from`, 0 at `to`,
     with 3-tile shoulders: the way up a plateau.
2. `node --run build:data` rasterizes the features into `maps[].heights` of
   `data/generated/ruleset.json`: two hex digits per corner, row-major over
   `(width + 1) × (height + 1)`; empty for a flat map. The sim and the client
   read that string; nothing recomputes it at run time.
3. A cell whose four corners spread by 16 steps or more is a **cliff**; the
   sim blocks it like a rock (`MapGrid::set_heights`), so no ground unit
   paths over it. The data check refuses depots and HQs on cliffs.
4. `MapGrid::ground_height(pos)` / `World::ground_height(pos)` returns the
   ground height in tiles (Q16.16), integer only, with Zero Hour's triangle
   split. It is what a ground unit's z is.
5. Vision and weapon range stay 2D; height gives no bonus (as Zero Hour).
6. Elevation is part of the map, not of the world state: it is not hashed or
   saved; a save rebuilds it from its map id.

## 4. Behaviour (client)

1. `elevationOf(map)` decodes the ruleset heights; `groundY(x, y)` samples
   them with the same triangle split as the sim, so units stand where the sim
   says the ground is.
2. The grass, dirt and rock-face layers are lifted to the corner heights.
   Normals come from the heights with the slope bent 2.5× (`SHADING_RELIEF`)
   so gentle hills read under the high isometric sun; elevated grass casts
   shadows. Slopes from 0.3 tiles/tile show bare earth; from 0.55 a rock face
   (rock texture projected from the side it faces) fades in, full at 1.
3. Rock tiles stand on the ground they cover.
4. Units stand on `groundY`. Vehicles pitch and roll to the ground under their
   nose, tail and sides (`groundTilt`); soldiers stay upright. Buildings,
   scaffolds, health bars, flags and the placement ghost stand on the lowest
   point of the footprint (Zero Hour flattens the ground instead).
5. Projectile arcs ride the line from the ground at the muzzle to the ground
   at the impact; effects and blood droplets start at the ground where they
   spawn; tracers and the attack marker follow the ground.
6. The fog of war and the snow cover drape over the heights. Snow slides off
   steep ground (none holds from 1.1 tiles/tile).
7. The crater and tread relief (spec 24) adds to the elevation:
   `heightAt` now returns elevation + sink, and decals follow it.
8. Clicks and box selection pick the first hill the camera ray meets.

## 5. Map

`first-line` gains two point-symmetric plateaus 2.5 tiles high (cells
`40..47 × 80..89` and `80..87 × 38..47`) with cliff edges and one ramp each
(from the west and from the east), two pairs of hills and a pair of ridges,
away from the bases, depots and the routes of the existing example saves.

## 6. Example save

`?load=hills-and-cliffs`: Ukrainian armour and infantry climb the west
plateau of first-line by its ramp; Russian tanks wait under its cliff.

## 7. Acceptance criteria

* AC-30-01..03 (sim): ground height follows the cell triangles, Zero Hour's
  diagonal, and is 0 on flat maps.
* AC-30-04: a spread of 16 steps is a cliff and blocks; 15 is not.
* AC-30-05: a unit ordered onto a plateau never steps on a cliff cell, climbs
  by the ramp and ends 2 tiles up.
* AC-30-06: first-line has cliffs and high ground; the starts are open.
* AC-30-07..12 (client unit): decoding and sampling match the sim; tilt signs;
  footprint ground; ground picking; mesh, relief and drape heights.
* AC-30-13 (e2e): in `hills-and-cliffs` the first Leopard reaches the plateau.
* AC-30-14/15 (data): rasterizing, cliff flags, first-line point symmetry;
  footprints on cliffs are refused.

## 8. Next (not in this spec)

* Terrain line of sight for direct fire (Zero Hour's Bresenham walk with a
  0.5 fudge), with attack orders moving a blocked unit until it can see.
* Cliff-climbing locomotors (a `CLIFF` surface) if a unit needs them.
* Flattening the ground under buildings.
