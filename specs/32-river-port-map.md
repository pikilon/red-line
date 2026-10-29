# 32 — River-port: the default map

Status: accepted 2026-10-28. Depends on `03-phase2-core-loop.md` §4.5 (maps),
`26-map-features-plan.md` (ground, water, roads, features, bridges, port),
`30-terrain-elevation.md` (hills, plateaus, ramps) and `19-save-games.md`.

## 1. Context

The owner wants a playable map that shows everything the landscape can do
(harbours, rivers, bridges, resources, elevation, forests) and wants it as the
first thing a player sees when opening the game.

## 2. Map `river-port` (`data/maps/river-port.yaml`)

128 x 96, mirrored left-right (Ukraine west, Russia east), like Zero Hour's
two-player maps that mirror both bases so neither side has an edge.

* A deep river with shallow banks runs from the north edge into the sea and
  splits the bases. It is crossed by a road bridge (north road, y 20), a ford
  (centre, y 40), a wooden bridge (dirt road, y 58) and a stone arch (harbour
  road, y 72). An asphalt road links each base to the three bridges.
* The south coast is sea; each side has a harbour (quays, a pier, cranes,
  warehouses, containers, fishing boats, a cargo ship, buoys, a lighthouse).
* Six depots: a 15000 depot by each HQ, a rich 15000 depot on each side's
  plateau (north, one ramp down to the north road) and a 10000 depot by the
  harbour road.
* Two hills per side, a pine (west) or fir (east) forest along the north edge,
  birch and oak groves on the river banks, poplar rows and a farm hamlet by the
  dirt road.

## 3. Default map

`DEFAULT_MAP` is `river-port`: opening the game without `?map=` starts a
skirmish on it against the default AI. `first-line` stays available with
`?map=first-line`, and the end-to-end tests that rely on its layout pin it.

## 4. Example save `river-port`

`?load=river-port` opens the map revealed, camera on the ford, with two tanks
per side, to look around before playing.

## Acceptance criteria

* AC-32-01 (data): `DEFAULT_MAP` is `river-port`; its depots and HQs mirror
  left-right; it has sea, a river with a ford, the three bridge types, harbour
  props, forests, two plateaus with ramps and hills.
* AC-32-02 (manual): opening the game shows river-port with both AIs able to
  build and play.

Assumption (owner left it open): "main screen" means the map a new game opens
on; there is no separate title screen.
