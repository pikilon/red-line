# 21 — Infantry animation

Status: implemented; owner asked 2026-10-24 for soldiers that walk instead of
bouncing, an RPG team that stands up to move, a Stugna operator that picks the
launcher up to move, and a visible reload before every missile.
Depends on `06-phase4a-procedural-models.md` (models), `09-phase4c-animation-and-finish.md`
§4 (the walk bob this replaces for rigged models), `18-infantry-appearance-and-textures.md`.
Decisions: D-05 (2.5D). Nothing changes in the simulation, the snapshot or the data.

## 1. Precedent (Zero Hour)

Source: `generals-precedent` note of 2026-10-24 (`Object::adjustModelConditionForWeaponStatus`,
`WeaponSet::getModelConditionForWeaponSlot`, `ChinaInfantryTankHunter` and
`AmericaInfantryMissileDefender` blocks of the INI).

* Infantry have separate states: idle, `MOVING` (a looping run clip),
  `FIRING_A`, `BETWEEN_FIRING_SHOTS_A`, `RELOADING_A` and `PREATTACK_A`.
  Priority: fired this frame > not attacking (none) > between shots > reloading
  > pre-attack.
* **Moving drops the fire pose** (`ATTACKING` must be set for any fire state).
* The reload clip of a launcher reuses the fire clip at a lower speed and its
  length matches `ClipReloadTime`, so the soldier is ready when the weapon is.
* Whether a soldier shoulders the launcher or kneels is baked into the clips,
  not in code; this spec chooses the poses below.

Red Line follows the same shape on the client: walking (`moving` flag), aiming
(has a target and is not moving) and reloading (time since the last shot
against the weapon cooldown, which is the reload time of a launcher).

## 2. Rig

Infantry models are authored standing and split into rigid limbs. A limb is a
glTF node named `limb_<man>_<part>` (`<man>` is `m` for a lone soldier, `g`/`a`
gunner/assistant, `o` operator, `x` team props); the node tree is the skeleton:
`hips` → `arms`, `thigh_l/r` → `shin_l/r`; the RPG gunner has a `round` limb
under `arms`; the Stugna team has `launcher` → `tripod`, `canister`, plus
`cable`. `anchor_carry` is an empty node: where the launcher rides when carried.
`client/src/render/models.ts` extracts every limb with its geometry relative to
its own joint; `entities.ts` draws each limb as its own instanced mesh with
the matrix `parent × joint × pose`. The hull of a rigged model is empty.
Triangle budget and bounds of spec 06 still apply to the sum of the limbs.
Draw calls: each limb is an instanced mesh per material, so a rigged type costs
up to 28 calls (the RPG team) instead of 4; the AC-03-62 bound of spec 10 §3
becomes `4 × types + 28 × rigged types + 10`.

## 3. Poses (`client/src/render/rig.ts`, `animation.ts`)

The animator keeps per-unit eased state (`RigState`): `walk` (0..1, 6/s),
`phase` (cycles, 2 per second while walking), `stance` (kneeling..standing),
`aim`, `carry` (launcher pick-up), `sinceShot`, `reloadMs`.

* **What counts as walking.** The measured ground speed of the unit (above 0.3
  tiles/s), not the snapshot `moving` flag: the simulation sets that flag for
  any unit with an order, so an attacker (or a ground-fire unit) standing in
  range would otherwise march on the spot. Units approach until the target is
  in range and stop there (spec 20 §1); infantry never fire while walking
  (Zero Hour: moving drops the fire pose).
* **Walk.** Thighs swing in opposition, the knee flexes while the leg swings
  forward, the hips lean slightly and twist against the stride, the rifle
  swings a little. The two men of a team are 0.37 of a cycle apart, so they
  never step in unison. The hull does not bounce: the old bob applies only to
  models without limbs (and to the box fallback).
* **Aim.** A rifleman raises the rifle from low ready when he has a target or
  fired in the last 1.5 s (ground fire has no target) and stands still;
  firing kicks the arms back for 140 ms.
* **Kneeling teams.** `ru-rpg-gunner` (both men) kneel (right knee down, left
  foot forward, hips 0.2 figure heights lower) while stationary and stand up to
  move (stand up 2.2/s, kneel 1.6/s). A rifleman never kneels.
* **RPG team reload** over the weapon cooldown (3 s). The assistant brings the
  round: 8–25 % the gunner stands the launcher muzzle up (a launcher is loaded
  from the muzzle); 14–50 % the assistant turns to the gunner with his arms
  out while a round (`a_spare`, standing in his rocket carrier) flies from his
  back to the front of the muzzle, nose first; 50–78 % the gunner's own round
  slides in; 80–96 % he brings the launcher back down to aim, ready when the
  cooldown ends. The spent round disappears at the shot.
* **Launcher pick-up** (`carry` follows the stow the simulation reports, at
  3/s, and targets 1 while the team walks): the operator stands up first
  (0–30 %), turns to the launcher and bends over it with his arms reaching
  (25–70 %), while the launcher lifts to the shoulder (`anchor_carry`) and the
  tripod legs fold together and swing back (40–100 %); the cable disappears.
  Only then do his legs start walking (`carry` ≥ 95 %). When he stops, the
  launcher goes down again and he kneels. The simulation holds the team still
  while it stows and sets up (spec 11), so the legs stay put and the unit no
  longer glides during the pick-up. The RPG gunner shoulders his launcher the
  same way (`stowTicks` 8).
* **Stugna reload** over the weapon cooldown (5 s): the spent canister falls
  away (10–30 %) and a new one drops in from above (30–78 %).
* Which weapons show a reload: those whose render `launch` is `backblast` or
  `softLaunch`. Rifles show none.

## 4. Assumptions

* No pre-attack pose: the rocket weapons have no `PreAttackDelay` in Zero Hour
  either.
* Kneeling is a client pose of the standing model; the two joint angles are in
  `rig.ts` (`KNEEL`) and must be re-derived if the figures in
  `tools/models/infantry.py` change.
* Death animations (`deaths.ts`) are unchanged.

## 5. Acceptance criteria

* AC-21-01: Given `limbPose` of a rifleman, When `walk` is 1, Then the two
  thighs swing in opposite directions and the hips never move more than 0.01
  tiles vertically; at rest every limb is neutral; the two men of a team have
  different phases.
* AC-21-02: Given the `ru-rpg-gunner` rig, When `stance` is 0, Then both men
  are lowered and the right shin is bent 90°; When walking, Then they are standing.
* AC-21-03: Given a rocket reload, Then the gunner's round is hidden at the
  shot, the assistant's spare round flies to the muzzle and the gunner's round
  appears at the front of the muzzle and rests in place when the cooldown ends;
  the launcher is held muzzle up in the middle and aimed again at the end.
* AC-21-04: Given the Stugna rig, Then the operator is standing at `carry`
  0.3 and bent over the launcher around 0.45; carrying (`carry` 1) the launcher
  is offset to `anchor_carry`, the tripod is folded and the cable is hidden; the
  canister falls and is replaced during the reload.
* AC-21-05: Given the animator, Then only rigged infantry get a rig, the walk
  follows the measured speed (a unit with the `moving` flag and no speed does
  not walk), moving drops the aim, a shot keeps the aim for 1.5 s, a launcher
  team holds its legs until the pick-up is done, and `sinceShot` and `reloadMs`
  follow the shot and the weapon cooldown.
* AC-21-06: Given `node tools/models/check.mjs --strict`, Then the rigged
  models pass (root `<type id>`, materials, budget, bounds).
