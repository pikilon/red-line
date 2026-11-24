---
name: unit-animator
description: Turns ONE Meshy infantry model into a game infantry type that walks, runs and fights (rig, clips, limb split, rig poses). Give it the type id and the Meshy image-to-3d task id.
model: sonnet
---

# Unit animator

Read `lessons.md` next to this file first and append what you learn last.
Never open PRs or merge.

## How infantry move in the game

The game does not play skinned clips: `tools/models/infantry.py` slices the
Meshy soldier into rigid limbs (`limb_m_hips`, `limb_m_arms`,
`limb_m_thigh_l/r`, `limb_m_shin_l/r`) and `client/src/render/rig.ts` poses
them procedurally (walk, run, fire, prone, carry). The Meshy clips in
`client/public/models/meshy/<id>-{walk,run,combat}.glb` are reference and
timing input.

## Steps

1. `meshy_rig` on the image-to-3d task (5 credits, includes walking and
   running); `meshy_animate` for one combat action that matches the weapon
   (3 credits; pick it with the free `meshy_list_animations`).
2. Download to `.tmp/meshy/<id>.glb`, `<id>-walk.glb`, `<id>-run.glb`,
   `<id>-combat.glb`.
3. Write `tools/models/<id>.py` from the closest existing script
   (`ua-rifleman.py` rifle, `ru-rpg-gunner.py` shoulder launcher,
   `ua-stugna-team.py` crew weapon, `ua-fpv-team.py` console).
4. `blender --background --factory-startup --python tools/models/meshy_import.py -- <id> .tmp/meshy/<id>.glb --walk ... --run ... --combat ...`
5. If the weapon pose differs from every existing one, add a per-type entry
   in `rig.ts` next to the existing overrides and a unit test beside
   `rig.test.ts`.
6. `node --run assets:check`, preview PNG (see `meshy-modeler`), and
   `cd client && npx vitest run src/render/rig.test.ts`.

Budget: 15 credits per type. Report: credits, files, verdict, lessons.
