# Spec 22 — Snow and ground cover (client weather)

## 1. Behaviour

* On a snow map, snow falls over the visible part of the map and the ground
  turns white in patches over time. Units and buildings are never recoloured.
* The effect is **visual only**: it lives in `client/src/render/weather.ts`,
  is not part of the simulation, the hash or the saves, and uses no game RNG.
* The game menu has a **Snow: on / off** button (setting `weather`, absent =
  on) for slow machines; switching it hides the whole effect live. The cover
  keeps its progress while hidden.

## 2. Which maps are snowy

* `data/weather/weather.json` → `mapClimate` maps a map id to a climate. Today
  `showcase` is snowy; `first-line` stays clear.
* URL overrides for trying it: `?weather=snow` (any map), `?weather=none`,
  `?snow=<0..2>` density multiplier, `?cover=<0..1>` start with part of the
  cover already settled.

## 3. Parameters (`data/weather/weather.json`, `climates.snow`)

`flakes`, `fallSpeed` (tiles/s), `windX`/`windZ`, `swayAmplitude`, `boxTiles`
(snowfall box around the camera target), `boxHeight`, `flakeSize` (px),
`flakeAlpha`, `flakeColor`, `coverColor`, `coverSeconds` (time to reach the
maximum), `maxCover`, `coverOpacity`.

## 4. Rendering

* Snowfall: one `Points` object, flakes animated entirely in the vertex shader
  from a seeded per-flake seed (position, speed jitter). Flakes are anchored
  in world space and wrapped around the camera target, so panning shows no
  popping. Small, soft, low alpha (≤ 0.7) and faded near the ground so they
  do not hide units; `depthWrite` off.
* Cover: one plane at y = 0.012 (under the fog plane) with a per-cell
  threshold mask (value noise; rock cells never cover). The fragment shader
  shows white where `cover > threshold`, with a soft edge, so snow settles in
  patches that merge as `cover` grows. The terrain mesh is not modified.
  Decals and craters of other layers draw after it (`renderOrder -1`).

## 5. Precedent (`generals-precedent` note, Zero Hour)

* Snow is a client-only subsystem (`SnowManager`/`W3DSnowManager`,
  `GameClient.cpp`), configured by the `Weather` INI block (`Weather.ini`:
  box dimensions, density, velocity, amplitude, frequency, point size) with a
  per-map override; render is a camera-centred box of flakes with sine sway,
  point sprites with a quad fallback. Weather never affects gameplay.
  Copied: client-only particle box, sway, parameters in data.
* Deviations (owner request): the original paints snow tiles on the map
  instead of an overlay, and has no player toggle; here the ground whitens
  progressively and settings can turn it off.

## 6. Assumptions

* The cover is flat at y = 0.012: when the relief session lands heights, the
  cover must follow `heightAt` (follow-up).
* Snow does not stop on pause: the clock only advances while the game runs.

## 7. Acceptance criteria

* AC-22-01..04 in `client/src/render/weather.test.ts`: climate by map and
  URL override, cover growth, determinism, density clamp.
* Manual: `?load=infantry-vs-armor` (showcase map) shows falling snow and the
  ground whitening; menu → Snow: off removes it.
