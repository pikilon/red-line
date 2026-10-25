# 29 — Weapon ground impacts (visual only)

Status: accepted (owner request 2026-10-25).
Depends on `07-phase4b-combat-effects.md` §3 (explosion FX),
`17-projectiles-and-combat-readability.md` §4.7 (detonation events),
`24-ground-marks.md` (decals), `24-terrain-relief.md` (relief).
Decisions: D-02 (the simulation stays deterministic: nothing here touches it).

## 1. Context

The owner wants every weapon's hit to be visible on the ground, each weapon
type with its own ground effect, on top of the existing explosion FX, and the
terrain deformation of spec 24 to look better: smooth, natural craters with a
raised rim, right lighting, blended with the scorch marks, no seams or spikes,
readable from the isometric camera.

## 2. Precedent (Zero Hour) and the difference

Note from `generals-precedent` (EA source `GameClient/FXList.cpp`, data
`INIZH.big` 1.04 via `generals:ini`):

* Each weapon names an FXList for its detonation (`ProjectileDetonationFX`,
  `Weapon.ini`); the list is a set of nuggets: `ParticleSystem`, `TerrainScorch`,
  `ViewShake`, `LightPulse`, sound. `ParticleSystem UseCallersRadius = Yes`
  scales the burst with the weapon's damage radius (`FXList.ini:784`).
* Small arms and machine guns have no ground FX at all, only fire FX
  (`WeaponFX_GenericMachineGunFire`, `FXList.ini:1016-1041`). Tank shells and
  missiles: an explosion and a smoke particle system, no scorch
  (`WeaponFX_GenericTankShellDetonation`, `FXList.ini:778-789`;
  `WeaponFX_RocketBuggyMissileDetonation`, `FXList.ini:3329`).
* Artillery adds a scorch, debris and dust (`FX_ArtilleryBarrage`,
  `FXList.ini:6541`: `TerrainScorch RANDOM r15`, `ArtilleryBarrageDebris`,
  `ArtilleryBarrageDust`). Heavy ordnance adds a dust wave and a large scorch
  (`WeaponFX_MOAB_Blast`, `FXList.ini:7462-7515`: `MOABDustWave`,
  `TerrainScorch RANDOM r250`).
* `TerrainScorch Type = RANDOM` picks one of four scorch textures
  `SCORCH_1..4` per detonation (`FXList.cpp:454-458`).

**Adopted:** one data-driven impact profile per damage type with per-weapon
overrides (the FXList per weapon); bursts sized by the weapon's splash
(`UseCallersRadius`); four scorch shapes picked at random; debris and dust for
artillery-class hits; a dust wave for heavy ordnance.

**Difference (owner request):** Zero Hour leaves no ground mark for bullets,
tank shells and missiles; here bullets kick dust and leave small pocks, and
shells and missiles leave a scorch, thrown clods and a shallow dent. Craters
are real relief (spec 24 §2 already differs from the original, which only
uses decals).

## 3. Behaviour

1. Impacts come from the simulation's detonation events (spec 17 §4.7), so
   they appear where and when a shot actually lands, scatter included.
2. Per damage type (`data/render/impacts.json`, `byDamageType`; one weapon can
   override sections in `byWeapon`):

   | Class | Ground effect |
   |---|---|
   | smallArms | 3 small dust kicks and a pock, spread up to 0.45 tiles around the hit (near misses) |
   | autocannon | 4 larger dust kicks, 2 clods, a bigger pock; spread 0.35 |
   | antiTank (shells, ATGM, RPG) | dust burst, 6 clods, a random scorch, a 0.65–0.75 tile dent with a rim |
   | highExplosive (GMLRS) | tall dust, a dust ring, 12 clods, scorch, a 1.3 tile crater with rim and ejecta ring |
   | thermobaric (TOS) | wide dust and a fast dust wave, wide scorch, a 2.2 tile shallow crater |

3. Dust takes the colour of the ground it rises from (soil, grass, snow,
   rock). Rock keeps scorches but no pocks, clods or craters.
4. A shot that strikes a building throws its dust at the wall facing the
   shooter; scorch and craters stay off the roof. Bullets still pock the
   ground at the wall's foot.
5. Pocks fade after 90 s (+30 s fade, ring of 800); scorches and ejecta last
   like spec 24 blasts (ring of 500, FIFO).
6. A shot that strikes an armoured vehicle leaves no ground layer under the
   hull: no dust, clods, scorch or crater (the blast FX of spec 07 still
   plays). When such a vehicle is destroyed by an explosive weapon
   (`antiTank`, `highExplosive`, `thermobaric`), one minimal crater from
   `data/render/impacts.json` (`unitDeathCrater`) is dug under the wreck; a
   non-explosive death leaves no crater. Owner request, 2026-10-25.

## 4. Crater relief (replaces spec 24 §3.1)

* Craters are dug into a fine height grid, 4 samples per tile side. Every
  tile a crater can reach is drawn as a fine patch (same material, UVs and
  dirt opacity as the ground tile, which is folded away); crater samples on
  the outline of the patched area stay at zero, so patches meet the coarse
  ground exactly: no seams and no single-vertex spikes.
* Profile (in crater radii `t`): a round bowl `-(1 - t²)²` plus a rim
  `rim · exp(-((t - 0.92) / 0.24)²)` that fades out by `t = 1.6`; the
  outline wobbles by three low sine lobes so no two craters are circles.
  Sink is capped at 0.5 tiles, rim build-up at 0.2.
* Normals come from the fine grid; brightness adds damp-soil darkening and a
  curvature term (hollows darker, crests lighter) so the shape reads from the
  high camera. Torn soil in the bowl and on the rim shows the dirt texture.
* Craters fade out next to rock tiles; the base height of the ground mesh is
  read at start-up and the relief adds to it, so a hilly base keeps its shape.
* Scorch, ejecta and every other mark are grids that drape over the relief
  and are re-lifted whenever it changes there (`onChange` → `relift`).

## 5. Interface

* `createGroundImpacts(effects, decals, relief)`: `record(snapshot, combat,
  nowMs)` per new tick; `impact(weapon, x, y, nowMs)` for one hit.
* `TerrainDeformer.crater(x, z, radius, depth, startMs, rim?)` returns false
  when no patch room is left; `onChange(listener)`; `stats().refined`.
* Effects gain `dust` (camera-facing soft puff with per-instance opacity) and
  `clod` (ballistic, rests where it lands).
* Debug: `__redline.impact(weaponId, x, y)` lands one impact.

## 6. Assumptions

* The existing explosion, blast and impact FX (spec 07) stay as they are;
  this spec adds the ground layer under them.
* Sizes and counts are a first pass for the owner to judge; they live in
  data only.
* No player-facing text besides the example save's name and description.

## 7. Acceptance criteria

* AC-29-01: a rifle hit kicks dust and leaves a pock; an HE rocket leaves a
  crater deeper than 0.2 tiles with clods (unit tests).
* AC-29-02: a shell hitting a building leaves no mark and no crater.
* AC-29-03: the fine crater patches share every vertex height with the coarse
  ground they touch (unit test), and the profile has no step.
* AC-29-04: `?load=weapon-impacts` shows every weapon class force-firing at
  open ground within 300 ticks (example contract). Setups gain the
  `attackGroundCenti` order for this (spec 19 §3.5, spec 20 `AttackGround`).
* AC-29-05: a shell striking an armoured vehicle leaves no decal, no dust and
  no crater under it; an armoured vehicle destroyed by an explosive weapon
  digs one minimal crater (`unitDeathCrater`) under the wreck, and one killed
  by a non-explosive weapon digs none.
