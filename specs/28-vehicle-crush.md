# 28 — Vehicles run over infantry

Status: implemented; owner asked 2026-10-25 that tanks crush enemy infantry
and that wheeled vehicles, which do not crush, shove soldiers aside and hurt
them.
Depends on `04-obstacle-approach-and-separation-settling.md` (separation),
`11-phase4e-locomotor-and-turret-aim.md` (locomotors, heading and speed),
`22-infantry-deaths.md` (bodies and blood). Decisions: D-03 (gore behind `G`).

## 1. Precedent (Zero Hour)

Source: EA's `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`,
`GameLogic/Object/Collide/SquishCollide.cpp` (`onCollide`),
`GameLogic/Object/Update/PhysicsUpdate.cpp` (`checkForOverlapCollision`),
`GameLogic/Object/Object.cpp` (`canCrushOrSquish`); INI `INIZH.big`
(`CrusherLevel` comment: "1 = infantry, 2 = trees, 3 = vehicles").

* Each object has a `CrusherLevel` and a `CrushableLevel`; infantry is
  crushable at level 0 and carries a `SquishCollide` module. Almost every
  vehicle has `CrusherLevel` 1 or 2 (tanks 2), so in Zero Hour wheeled
  vehicles crush infantry too.
* `canCrushOrSquish`: never an ally ("Friends don't let friends crush
  friends"; the test is the crusher's view of the relationship, so enemies
  **and neutrals** are crushed), never an unmanned vehicle, never with level 0.
* A crusher only crushes **while moving** (`checkForOverlapCollision` returns
  at once when the velocity is tiny).
* The soldier dies (`DAMAGE_CRUSH`, `DEATH_CRUSHED`, huge damage) when his
  centre is inside the crusher's geometry (`SquishCollide` shrinks the
  soldier to a point) **and the crusher's velocity points toward him**
  (dot product > 0).
* A crushable object is passive to the overlap: physics does not push the
  two apart, the hull drives over him.

## 2. Crush (tracked vehicles)

Phase 2b of the step (`World::run_over`, `crates/sim/src/crush.rs`), after
movement and before separation:

* A **crusher** is a live unit whose locomotor has `crusherLevel > 0` (in
  `data/rules/globals.yaml`, the `tracked` locomotor) and whose `speed > 0`.
* A **crushable** soldier is a live unit on the `foot` locomotor.
* When the soldier belongs to another player, his centre is closer to the
  crusher's centre than the crusher's collision radius (`radiusCenti`), and
  the crusher's velocity (heading × speed, backwards while reversing) points
  toward him, his hp drops to 0; he is removed in the deaths phase.
* Separation skips the pair (crusher, enemy soldier): he is not pushed out of
  the way, the tank drives over him.

## 3. Shove (wheeled vehicles) — Difference

**Difference from Zero Hour (owner's request):** wheeled vehicles do not
crush. A live vehicle whose locomotor has `crusherLevel` 0 and
`shoveDamage > 0` (the `wheeled` locomotor), moving toward an enemy soldier
it touches (centres closer than both radii), shoves him:

* he loses `shoveDamage` hp (20; no armour modifier);
* he is thrown sideways out of the vehicle's path, to `both radii +
  shovePushCenti` (0.40 tiles) from its centre line, on the side he already
  stood (dead centre: left or right by id parity), only into a passable cell.

Once thrown clear he is out of contact, so a passing truck hurts him once.

## 4. Friendly infantry

As in Zero Hour, allies are never crushed and never shoved: own soldiers keep
the normal separation of spec 04 (getting out of the way is the movement
yielding work, not this spec). With no alliances yet, "ally" means "same
player".

## 4a. Dodging (issue #453) — Difference

Zero Hour never makes infantry dodge an enemy crusher: `AIUpdateInterface::
blockedBy` returns early when the mover `canCrushOrSquish` the other unit, so
`SquishCollide::onCollide` kills him; only allies get `aiMoveAwayFromUnit`
(`AIUpdate.cpp` `processCollision`, `Pathfinder::getMoveAwayFromPath`,
generals-precedent note of 2026-11-05). The owner asked that soldiers *try*
to get out of the way instead of letting a column be flattened, so Red Line
reuses that move-out-of-the-way for enemies:

* Every live, moving runner (crusher or shoving hull) looks
  `crushDodgeLookaheadCenti` (data/rules/globals.yaml, 150) past its nose
  along its velocity. Each enemy soldier its body would touch on that
  stretch reacts (sim phase `dodge_crushers`, right after movement).
* An idle soldier (also one firing from where he stands) gets the
  spec 04 §5.3 yield: a short move to the nearest clear cell off the
  vehicle's line, never toward the vehicle.
* A soldier on a move sidesteps one step at his speed away from the line
  each tick he is threatened, and keeps his order.
* Garrisoned, boarded or trench soldiers do not react; soldiers on other
  orders (attack, build, harvest...) do not either.
* Failure: in one half-second window in `crushDodgeMissOneIn` (3) a soldier
  is slow to react (`(id + tick / 15) mod N == 0`, deterministic); together
  with a fast hull or a blocked side this means some still get run over.

## 5. Client (`deaths.ts`, `corpses.ts`)

The death and hit causes of spec 22 §2 learn two more kinds from the
snapshots: a vehicle that runs over (`runOverOf`: crush or shove, from its
locomotor) and touched the soldier in the last 0.6 s is the cause.

* **crush**: the body is slammed down along the hull's heading, the feet swept
  from under it and the limbs thrown about (a short, hard tumble, no flight);
  blood: a wide pool under him and two smears along the way, one per track;
  blood on the clothes as an explosion.
* **shove**: a stronger jolt (0.45 rad floor) pushed away from the vehicle;
  a soldier killed by a shove falls as a shot.
* A full-hp soldier that vanishes under an enemy crusher counts as a death
  (`detectDeaths`).

## 6. Assumptions

* Crushable means "on foot"; there are no trees, walls or crushable vehicles
  yet, so only level 1 is used.
* The crush test uses the crusher's collision circle, not an oriented box.
* Neutral soldiers do not exist yet; the rule is "another player".
* The kill is not credited to the vehicle (`last_hit` is presentation only).

## 7. Acceptance criteria

* AC-28-01: a moving tank kills an enemy rifleman in its path, who is not
  pushed aside before (`crates/sim/tests/crush.rs`).
* AC-28-02: a tank driving through a friendly rifleman leaves him at full hp.
* AC-28-03: a standing tank crushes nobody, even overlapping.
* AC-28-04: a wheeled truck shoves an enemy rifleman sideways out of its path
  and costs him a multiple of `shoveDamage`; he lives.
* AC-28-05: a wheeled truck does not hurt a friendly rifleman.
* AC-28-06: the client reports a soldier under an enemy tank as a `crush`
  death.
* AC-28-07: a friendly tank is no crush cause; a wheeled truck is a `shove`
  pushing away from it, forgotten after 0.6 s.
* AC-28-08: the `run-over` example save: after 900 ticks the tank has
  crushed riflemen and the truck has killed nobody (some dodge, §4a).
* AC-28-09: an idle enemy rifleman in a tank's path steps aside and lives.
* AC-28-10: a rifleman walking head-on at a tank sidesteps and lives.
* AC-28-11: a soldier who never reacts (`crushDodgeMissOneIn: 1`) is crushed.
* AC-28-12: the shipped rules make soldiers dodge and sometimes fail.

Try it: `?load=run-over`.
