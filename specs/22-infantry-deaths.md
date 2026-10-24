# 22 — Infantry deaths: by shot and by explosion

Status: implemented; owner asked 2026-10-24 for death animations that differ
between explosions and gunshots, and a better blood splat (the old one was
three overlapping flat rectangles).
Depends on `07-phase4b-combat-effects.md` (death detection, gore filter, §3 body
and blood), `21-infantry-animation.md` (limb rig). Decisions: D-03 (more violent
than Red Alert 2: the gore stays, behind the `G` filter), D-05 (2.5D).
Nothing changes in the simulation, the snapshot or the data.

## 1. Precedent (Zero Hour)

Source: `generals-precedent` note of 2026-10-24 (`Damage.h` `DeathType`,
`SlowDeathBehavior.cpp`, the `ChinaInfantryRedguard` and `AmericaInfantryRanger`
blocks of the INI).

* The weapon's `DeathType` (NORMAL, EXPLODED, BURNED, POISONED, CRUSHED...)
  selects the death module; bullets are NORMAL.
* NORMAL: one of two death clips picked at random (`DTA`/`DTB`), no motion.
* EXPLODED: the same module family with a fling (`FlingForce` 8 ± 3,
  `FlingPitch` 60° ± 10) and three clips: dying, flailing in the air, bouncing
  on landing.
* Corpses sink after 3 s and are removed after 8 s. Zero Hour has **no blood
  or gibs**: death visuals are the clips and, for fire and toxin, replacement
  objects.

Red Line follows the shape (shot: a few stable variants; explosion: a fling
with a flailing loop and a bounce) and keeps its own gore, corpse lifetime
(20 s, spec 07 §3) and no burn or poison deaths, which no weapon here causes.

## 2. Cause of a death

`createDeathCauses()` (`deaths.ts`) remembers, for 5 s, the shots of every
snapshot (entities with the `fired` flag and a target):

* weapons of damage type `antiTank`, `highExplosive` or `thermobaric` leave a
  **blast** at the target with radius `max(1, splash)` tiles;
* the others (`smallArms`, `autocannon`) remember **who shot** a target.

When a soldier disappears: inside the radius (plus 0.4 tiles) of a remembered
blast it is an **explosion** and the body is pushed away from the blast centre
(along the shell when it stood on it); else, if someone shot it, a **shot**
pushed away from the shooter; else a shot that pushes it back along its heading
(fog, ground fire).

## 3. Falling bodies (`corpses.ts`)

The snapshot drops the unit, so a `Corpse` (type, owner, place, hull yaw,
cause) is added to a list the entity renderer draws with the same limbs the
soldier walked with, posed by time since the death (`bodyPose` tips the whole
body over its feet, `corpseLimb` moves the limbs). It lies `CORPSE_MS` = 20 s
and shrinks away over the last 3 s.

* **Which way it falls** comes from where the hit comes from, against the way
  the soldier faces: pushed along his facing (hit from behind) he falls on his
  face; against it (hit from the front) on his back; within about 27° of square
  across it, on his side. The body **never turns on its feet** first: it tips
  over the soles it stands on, keeping its heading.
* **Shot, three styles by id** (same axis rule): stumbles (arms reaching,
  knees going slack); jerked by the hit (a kick of the chest, arms flung up
  when falling back); crumples (knees give way as in the kneel pose, then
  topples).
* **A soldier who dies kneeling** (the RPG team and Stugna operator while they
  hold a position) falls from the kneel: the animator's last pose is captured in
  `Corpse.kneel`, so he does not stand up before falling.
* **Explosion**: thrown 1.0–1.5 tiles along the push in 0.9 s on a 0.6-tile
  arc, flipping once in the air the way he is thrown (forward over the face,
  backward over the back, sideways after a side blast) without turning on his
  feet, arms flung up and legs kicking, one bounce (0.14 tiles), then limp.
* Other infantry types without a rig keep the flat `body` box of spec 07.

## 4. Blood (`effects.ts`, `splat.ts`, `deaths.ts`)

The `blood` effect is now a flat quad with a generated splat texture (an
irregular pool, dark red nearly black in the middle, soft edge, scattered
drops and streaks) instead of a box, drawn with a polygon offset over the
ground. A splat spreads from 35 % to full size when it appears: 0.18 s for a
spurt, 1.4 s for a pool (`spreadMs`).

* **Shot** (little blood): spurts first, three small stretched splatters in
  quick succession (40–220 ms) from the wound along the way he is hit; the
  pool, about half a tile, appears just as the body lands and spreads slowly.
* **Explosion**: four spurts that follow the body through the air, a pool of
  about 0.8 tiles where it lands (spreading slowly) and one splash ahead.
* Gore off (`G`): no blood at all; bodies still fall.

## 5. Assumptions

* The death kind comes from the weapons seen firing in the last 5 s; a soldier
  who dies from a shell fired in the fog falls as a shot.
* Variant per soldier id so the same id always dies the same way.
* No gibs or dismemberment: a body stays whole.

## 6. Acceptance criteria

* AC-22-01: `createDeathCauses` reports `explosion` for a victim inside the
  radius of a rocket's blast (target or neighbour) with the push away from the
  centre, `shot` pushed away from a rifle shooter, and forgets shots after 5 s.
* AC-22-02: `bodyPose` of a shot ends lying (face down, on the back or on the
  side by where the hit comes from), never turns the body on its feet, and the
  fall takes time; a soldier who died kneeling starts from the kneel.
* AC-22-03: `bodyPose` of an explosion carries the body `tossReach` tiles from
  where it stood, in the air at 0.3 s, flipped past a half turn, and landed
  near the ground at 2 s.
* AC-22-04: `corpseLimb` crumples the knees (variant 2) and flings the arms
  up then limp (explosion); a corpse shrinks over its last 3 s and is dropped
  after 20 s.
* AC-22-05: `spawnDeathEffects` with bodies adds a body (no flat `body`), delays
  the pool until the body is down, sprays more blood for an explosion and none
  with gore off.
* AC-22-06: `createSplatTexture` is opaque in the middle, clear in the corners
  and neither empty nor a filled square.
