# 24 · Ground marks (tracks, scorches, craters)

Client-only visuals (`client/src/render/decals.ts`, `decalTextures.ts`). The
simulation neither stores nor reads marks; they never affect determinism or
saves. Balance lives in `data/render/decals.json`.

## 1. What the player sees

* Tracked and wheeled vehicles leave two strips behind them while they move.
  Strips are strong on dirt/mud (and snow once weather exists), faint on
  grass, absent on rock and nearly absent on asphalt.
* Tracks fade slowly after `tracks.lifetimeMs` (150 s) over `tracks.fadeMs` (150 s); marks are unlit flat sprites (a bump-map relief was tried and dropped: not visible, extra cost).
* Shot marks per weapon (pocks, four random scorch shapes, ejecta rings) are
  chosen in `data/render/impacts.json` (spec 27); blast marks are grids that
  drape over crater relief.
* Marks appear when the shell lands (shot delay is respected), not when fired.
* Foot units leave nothing.

## 2. Original precedent (generals-precedent note, Zero Hour 1.04)

* Tracks: a new edge every 10 world units (`addEdgeToTrack`,
  `W3DTerrainTracks.cpp:310-420`); fade `1 - age/FadeDelay`, Medium quality
  30 s (`GameLOD.ini`); newest edges stay opaque. No terrain gating in the
  original: gating by surface is our addition (owner request).
* Scorches: terrain decal sized by the FX nugget's own radius, `MAX_SCORCH_MARKS
  = 500`, oldest evicted first (`BaseHeightMap.cpp:2052-2062`), no fade.
  A "crater" is just a big scorch plus debris; we draw a separate crater sprite.
* Adopted: spacing, 30 s track fade, FIFO eviction, 500 scorch cap, scorches
  that stay until evicted (`blasts.fadeMs = 0`, a 1 h life).

## 3. Caps

Two rings with FIFO eviction: `tracks.maxMarks` (3000) and `blasts.maxMarks`
(500). Each ring is one mesh and one draw call; opacities update per frame.

## 4. Hooks for other layers

* `Decals.setSurface(fn)`: weather/snow replaces the surface lookup
  (`strength` 0..1, tint colour). Default derives from rock cells and the
  terrain's dirt-overlay noise.
* `Decals.setHeight(fn)`: relief supplies the ground height; default flat.
* Marks are quads per mark, lifted 0.012 tiles with polygon offset.

## 5. Hardness and snow (after spec 22-snow)

* Each surface in `data/render/decals.json` has a `hardness` (0 soft .. 1
  hard). Marks are as visible as the ground is soft: faint on grass, clear in
  mud and snow, almost none on asphalt, none on rock.
* Marks are subtle and irregular: tread strips have ragged, patchy textures,
  random gaps (`gapChance`), wobble, angle jitter and uneven opacity; blasts get
  a random orientation, uneven axes and opacity.
* Snow coverage is read exactly as the cover shader paints it (bilinear
  thresholds, `snow.coverEdge`), and the surface blends between ground and snow
  by that amount: marks never turn white before the snow starts and fade into
  the bare ground as a vehicle leaves a patch. Above 50 % coverage a mark counts
  as snowy: it ages `snow.fillRate` times faster while snow is falling. With
  snow off, or on bare ground, marks last their full lifetime.
* Tracks trail behind the hull: nothing is stamped ahead of the vehicle.

## 6. Assumptions

* Wheeled/tracked is read from the unit's locomotor kind; strips are placed at
  the hull gauge from the unit's `render.size`.
* No player-facing text, so nothing under `client/src/i18n/`.
* Marks are not saved: loading a save starts with clean ground.
