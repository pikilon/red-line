# Spec 22 — Snow and ground cover (client weather)

## 1. Behaviour

* On a snowy map, snow falls over the visible part of the map and the ground
  turns white in patches over time. Units and buildings are never recoloured.
  Snow is off everywhere by default and is turned on per URL (see §2).
* The effect is **visual only**: it lives in `client/src/render/weather.ts`,
  is not part of the simulation, the hash or the saves, and uses no game RNG.
* The game menu has a **Snow: on / off** button (setting `weather`, absent =
  on) for slow machines; switching it hides the whole effect live. The cover
  keeps its progress while hidden.

## 2. Turning snow on

* Snow is **opt-in through the URL**, never tied to a map id: no map is snowy
  by default, so demo saves and manual tests are clear unless asked otherwise.
* `?weather=snow` turns it on on any map; no `weather` parameter (or
  `?weather=none`) leaves the map clear. It combines with `?load=<id>`:
  `?load=infantry-vs-armor&weather=snow`.
* `?snow=<0..2>` density multiplier and `?cover=<0..1>` start with part of the
  cover already settled; both only matter when snow is on.

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
* Cover (rework, issue #336): a mesh with 2 samples per tile side lifted
  0.012 over the ground **and its relief** (`heightAt`, spec 24), updated
  through `onChange`, so snow lies in and around crater bowls and on their
  rims instead of leaving bare holes. Per-cell thresholds (value noise, scaled
  to at most 0.85; rock cells never cover) are bent by broad noise in the
  shader, so snow is patchy and drifted while settling and `maxCover` 1 leaves
  the ground continuously white at the end; only rock and steep slopes stay
  bare. The terrain mesh is not modified. Decals and craters of other layers
  draw after it (`renderOrder -1`).
* Snow surface: opacity 0.98 (the cracked dirt below never shows) with its own
  procedural look: fbm hollows tinted blue, fine grain, and lighting from the
  screen-space normal (sun from the north-west) so rims catch light and bowl
  slopes in shade go blue-grey. A crater floor sunk ≥ 0.13 tiles shows fresh
  dark dirt (`bareDirt`), fading as snow settles; it is never olive.
* Flakes: varied sizes (`flakeSize` × 0.45..2.55, rare big ones), big flakes
  slower and softer, Gaussian soft edge, alpha varies with size, slow fall
  (`fallSpeed` 2.4) with a gentle sway.
* Tracks on snow use the compacted grey-blue surface (`decals.json`, `snow`
  colour `0x7d8da1`).

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

* Style reference (RA Remastered / Zero Hour snow maps): continuous white
  ground with blue shading and darker compacted trails. Copied; our
  difference is the live settling and the fresh dark crater floors.
* Snow does not stop on pause: the clock only advances while the game runs.

## 7. Acceptance criteria

* AC-22-01..04 in `client/src/render/weather.test.ts`: snow opt-in by URL
  parameter, cover growth, determinism, density clamp.
* AC-22-05: thresholds stay below 0.85, final cover ≥ 0.99, fresh crater dirt
  only on deep floors (`weather.test.ts`).
* Manual: `?load=infantry-vs-armor&weather=snow` shows falling snow and the
  ground whitening; menu → Snow: off removes it, and the same URL without
  `weather` stays clear.
