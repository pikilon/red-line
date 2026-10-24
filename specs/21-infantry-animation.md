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

## 3. Poses (`client/src/render/rig.ts`, `animation.ts`)

The animator keeps per-unit eased state (`RigState`): `walk` (0..1, 6/s),
`phase` (cycles, 2 per second while walking), `stance` (kneeling..standing),
`aim`, `carry`, `sinceShot`, `reloadMs`.

* **Walk.** Thighs swing in opposition, the knee flexes while the leg swings
  forward, the hips lean slightly and twist against the stride, the rifle
  swings a little. The hull does not bounce: the old bob applies only to
  models without limbs (and to the box fallback).
* **Aim.** A rifleman raises the rifle from low ready when he has a target and
  stands still; firing kicks the arms back for 140 ms.
* **Kneeling teams.** `ru-rpg-gunner` (both men) and the `ua-stugna-team`
  operator kneel (right knee down, left foot forward, hips 0.2 figure heights
  lower) while stationary and stand up to move (stand up 2.2/s, kneel 1.6/s).
  A rifleman never kneels.
* **RPG gunner.** Launcher on the shoulder aimed at a target; lowered in hand
  to walk or when idle. Reload over the weapon cooldown (3 s): the spent round
  disappears on firing; 8–25 % the launcher is lowered muzzle down; 28–78 % a
  new round travels from behind the shoulder, over it and out in front, then
  slides in at the muzzle; 80–96 % the launcher comes back up, ready when the
  cooldown ends.
* **Stugna team.** While the operator walks, the launcher lifts off the
  ground to the shoulder (`anchor_carry`) over about 1 s, the tripod legs fold
  together and swing back, and the cable disappears; it deploys again when the
  team stops. Reload over the weapon cooldown (5 s): the spent canister
  falls away (10–30 %) and a new one drops in from above (30–78 %).
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
  tiles vertically; at rest every limb is neutral.
* AC-21-02: Given the `ru-rpg-gunner` rig, When `stance` is 0, Then both men
  are lowered and the right shin is bent 90°; When walking, Then they are standing.
* AC-21-03: Given a rocket reload, Then the round is hidden at the shot,
  arrives from outside the tube mid-reload and rests in place when the cooldown
  ends, and the launcher is lowered in the middle and raised at the end.
* AC-21-04: Given the Stugna rig carrying (`carry` 1), Then the launcher is
  offset to `anchor_carry`, the tripod is folded and the cable is hidden; the
  canister falls and is replaced during the reload.
* AC-21-05: Given the animator, Then only rigged infantry get a rig, the walk
  eases in and out, moving drops the aim, and `sinceShot` and `reloadMs` follow
  the shot and the weapon cooldown.
* AC-21-06: Given `node tools/models/check.mjs --strict`, Then the rigged
  models pass (root `<type id>`, materials, budget, bounds).
