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

## 3. Falling bodies: a small ragdoll per man (`corpses.ts`)

The snapshot drops the unit, so a `Corpse` (type, owner, place, hull yaw, cause,
the pose and blood he died with) is added to a list the entity renderer draws
with the same limbs the soldier walked with. **Each man of a team is a ragdoll**
simulated in a fixed step (1/120 s) seeded by the entity id, so it is
deterministic and costs nothing in the game simulation:

* **Body**: a rod (0.5 tiles) in the vertical plane of the push, with gravity
  (4 tiles/s²), a ground contact at both ends (restitution 0.25, 0.4 for blasts;
  friction 0.8) and a resting state that lays it flat. A shot tips it over its
  feet (pinned, an inverted pendulum with a push from the hit, released at 1 rad
  and then free); it keeps its heading and never turns on its feet first. An
  explosion throws it free: up (≈2 tiles/s), away (0.9–1.4 tiles/s along the
  push) and tumbling (6–9 rad/s), it bounces and slides to rest 1–1.8 tiles away.
* **Limbs**: the thighs, shins and arms are damped pendulums with joint limits
  (shins bend one way only, 0..2.6 rad) that **start in the pose he died in**
  (`poseOnDeath`: the stride of a walker, the bent legs of a kneeler), feel the
  body's angular acceleration and hang under gravity, and cannot go through the
  ground. They go limp, so legs and arms flop and settle instead of keeping the
  walking or standing pose. Once he lies, each leg rests a little differently
  (knee bend, 0.14–0.24 rad splay) so a body is never a ruler.
* **Style of a shot** by id: stumble (a push of the chest, arms reaching), jerk
  (a hard kick, arms flung up), crumple (the knees give way into the kneel pose
  while a weak push topples him). Which way he falls comes from the push, not
  from a chosen clip: hit from behind he falls on his face, from the front on his
  back, from the side on his side.
* **Teams**: the second man reacts 0.12 s later; each man tips over his own feet.
  Props (the Stugna launcher) stay where they were.
* A soldier who dies kneeling falls from the kneel: he does not stand up first.
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

## 5. Clothes and fade (`limbFx.ts`)

* **Blood on the clothes**: the `body` material of a limb darkens to dried-blood
  red in patches (a 3-D value noise per soldier, so each wears a different
  pattern) that spread with the blood level: a living soldier's is
  `(1 − hp / maxHp)^0.8`; a body keeps what hurt him before plus the blow that
  killed him (+0.45 for a shot, +0.7 for a blast). At most about half the cloth
  is covered. Armbands (`team`) stay clean.
* **Fade out**: a body disappears by fading, not shrinking: the last 3 s of its
  20 s the limbs dissolve (a dither, `alphaHash` with a per-instance
  `instanceFade`), and their shadows with them (a custom depth material).

## 6. Hits that do not kill

When a soldier of a rigged type loses hp between two snapshots and lives
(`detectHits`), the animator jolts him: the body tips over its feet by
`0.1` (shot) or `0.28` (blast) rad plus twice the share of his hp lost (up to
0.7 rad) **in the direction the shot pushes** (the cause of spec 22 §2), peaking
70 ms after the hit and recovering in 0.7 s (`t·e^(1−t)`, no overshoot); the
arms jerk and the knees give for a moment; two hits add up under a cap of 0.75
rad. Nothing changes in the game simulation.

**Blood from a wound** (`spawnHitBlood`, gore on only) starts only when a hit
leaves the soldier with **less than 60 % of his hp** (`WOUND_BELOW`): above it a
hit only jolts him and stains his clothes (§5). Below it, the shot that lands
throws blood out of the wound in a **thin jet**: 3 droplets (5 for a hard hit,
jolt ≥ 0.3 rad) leave the chest (0.3 tiles up) along the push in a narrow cone
(±0.14 rad) at 1.1–3.5 tiles/s with a low rise (0.2–0.8 tiles/s). **It is
synchronised with the jolt**: the first drop leaves 55 ms after the hit, when
the body has started to tip, and the rest follow 30 ms apart, so there is
almost nothing before the jolt. **No two jets are alike**: each hit takes a
running number as seed, which varies the count (±1), the lean of the whole jet
(±0.12 rad), its force (0.8–1.2), the height it leaves at and the length of
each splat, even on the same soldier. Each is a thin streak (0.12 × 0.012 tiles, `droplet` effect) that **lies
along its velocity** while it flies on a ballistic arc (gravity 4 tiles/s²),
and where it comes down it leaves a small, thin splat stretched along the jet
(about 0.16 × 0.04 tiles) that dries up after 10 s. The wound shows on
his clothes through the rule of §5: the blood level follows the hp he has lost,
so every hit stains the uniform a little more, from the first one.

## 7. Assumptions

* The death kind comes from the weapons seen firing in the last 5 s; a soldier
  who dies from a shell fired in the fog falls as a shot.
* Variant per soldier id so the same id always dies the same way.
* No gibs or dismemberment: a body stays whole.

## 8. Acceptance criteria

* AC-22-01: `createDeathCauses` reports `explosion` for a victim inside the
  radius of a rocket's blast (target or neighbour) with the push away from the
  centre, `shot` pushed away from a rifle shooter, and forgets shots after 5 s.
* AC-22-02: the ragdoll of a shot ends lying (axis horizontal) near where it
  stood, never turns on its feet, is deterministic, keeps its joints inside their
  limits, starts from the pose he died in and goes limp (the legs do not keep the
  walking pose), splays the legs once it lies, and a kneeler keeps the hips low.
* AC-22-03: an explosion throws the body up (over 0.3 tiles) and along the push,
  tumbling past a half turn in the air, flings the limbs, lands it lying within
  1–1.8 tiles and `landing()` reports where and when for the blood.
* AC-22-04: a body fades out: `corpseFade` goes 1 → 0 over its last
  3 s and bodies are dropped after 20 s.
* AC-22-05: `spawnDeathEffects` with bodies adds a body (no flat `body`), delays
  the pool until the body is down, sprays more blood for an explosion and none
  with gore off.
* AC-22-06: `createSplatTexture` is opaque in the middle, clear in the corners
  and neither empty nor a filled square.
* AC-22-07: a death is soaked by the blow plus what hurt him before (`Corpse.blood`).
* AC-22-08: `detectHits` reports soldiers that lost hp and lived with the push of
  the cause and a jolt that is larger for blasts, capped at 0.7, and skips the
  unhurt, the dead and vehicles.
* AC-22-09: the animator jolts a hit soldier (zero at the hit, the peak 70 ms
  later, recovered after 0.7 s), adds two hits under the 0.75 cap and ignores
  hits on ids it never saw.
* AC-22-10: `spawnHitBlood` throws droplets only when the hit leaves him under 60 %
  of his hp (2–4 for a light hit, 4–6 for a hard one), the first leaves after the jolt
  has started (none at 20 ms) and no two jets are the same, they fly along the push and
  come down, each leaves a small thin splat (under 0.3 × 0.06 tiles), none without
  gore, and the splats dry up after 10 s.
