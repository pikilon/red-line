# 22 · Ground marks (tracks, scorches, craters)

Client-only visuals (`client/src/render/decals.ts`, `decalTextures.ts`). The
simulation neither stores nor reads marks; they never affect determinism or
saves. Balance lives in `data/render/decals.json`.

## 1. What the player sees

* Tracked and wheeled vehicles leave two strips behind them while they move.
  Strips are strong on dirt/mud (and snow once weather exists), faint on
  grass, absent on rock and nearly absent on asphalt.
* Tracks fade slowly after `tracks.lifetimeMs` (150 s) over `tracks.fadeMs` (150 s); marks carry relief through a bump map (`bumpScale`), lit by the sun.
* Explosions leave a dark scorch; high-explosive hits also dig a crater on
  soil. Radius grows with the weapon's splash radius (`blasts.byDamageType`).
  Anti-tank hits leave a small scorch; thermobaric a wide scorch without crater.
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

## 5. Assumptions

* Wheeled/tracked is read from the unit's locomotor kind; strips are placed at
  the hull gauge from the unit's `render.size`.
* No player-facing text, so nothing under `client/src/i18n/`.
* Marks are not saved: loading a save starts with clean ground.
