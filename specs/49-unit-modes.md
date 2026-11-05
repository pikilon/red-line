# 49 — Unit modes: attack move and guard

Status: built (tester request, issue #452, 2026-11-05). Touches `08` (keys,
cursor), `23` (retaliation), `41` (command panel, lifts A1 for Attack move and
Guard). Decisions: D-05 (guard radii in `data/rules/globals.yaml`), i18n for
every player-facing string, sim determinism.

## 1. Goal

Besides Move, Attack, Force fire and Stop, a player can tell units how to act:

* **Attack move**: advance to a point and fight every enemy met on the way,
  then carry on to the point.
* **Guard**: hold a point; attack enemies that come near it, chase them a
  limited distance and time, then walk back to the point.

## 2. Precedent (`generals-precedent`, Zero Hour)

```
Question: Which unit behaviour commands does Zero Hour have and how do they behave?
Source: electronicarts/CnC_Generals_Zero_Hour@0a05454d8; data: INIZH.big (Zero Hour 1.04)
Findings:
* GenericCommandSet slot 11 is Command_AttackMove, 14 Command_Stop; Command_Guard,
  Command_GuardWithoutPursuit, Command_GuardFlyingUnitsOnly exist —
  INIZH.big:Data\INI\CommandButton.ini:1718-1768, CommandSet.ini:23-25 [fact]
* Attack move (AIAttackMoveToState::update, AIStates.cpp:3596): each update while no
  attack is running it asks getNextMoodTarget (auto-acquire within vision, fog
  filtered); a target found stops the move and runs an attack state machine; when that
  machine idles (target dead/lost) it repaths to the goal and moves on [fact]
* Guard (AIGuardMachine, AIGuard.cpp:182-192): states Inner -> Outer -> Return -> Idle.
  Inner scan (lookForInnerTarget, :210) picks the closest attackable enemy within
  vision x GuardInnerModifier of the guard point, no fog filter [fact]
* Outer state (:510-545) chases the nemesis; it exits when the target leaves vision x
  GuardOuterModifier of the guard point, or after GuardChaseUnitsDuration; the timer
  resets while the target is within the inner radius (:558-585) [fact]
* Return state (:627-665) walks back to the guard point and keeps scanning
  (GuardEnemyReturnScanRate), so it acquires targets on the way like an attack move;
  Idle scans every GuardEnemyScanRate [fact]
* A guard that is shot attacks the aggressor (attackAggressors, :177) [fact]
* GUARD_WITHOUT_PURSUIT skips the Outer chase (:512); FLYING_UNITS_ONLY filters
  to flyers (:284) [fact]
* Scatter (MSG_META_SCATTER) and waypoint mode (Alt, MSG_ADD_WAYPOINT) are client
  messages, CommandXlat.cpp:878-884, 2995-3010 [fact]
* No scout/explore order exists in the command buttons or the AI states [fact]
Values: AIData.ini:16-22 GuardInnerModifierHuman 1.8, GuardOuterModifierHuman 2.2,
  GuardChaseUnitsDuration 10000 ms, GuardEnemyScanRate 500 ms, ReturnScanRate 1000 ms
  (AI players: 1.1 / 1.333).
Red Line recommendation: copy Attack move and Guard; skip guard variants, scatter and
  waypoints for now; no scout order (no precedent).
```

## 3. Behaviour

### 3.1 Attack move (`Command::AttackMove`, `Order::AttackMove`)

* Units get the same goals as a Move to the point (spread for a group,
  spec 04). Armed ground units attack-move; unarmed units and flyers just move.
* Each tick, an attack-moving unit with no engaged enemy looks for the nearest
  enemy it can hurt within its **acquisition range** (sight, or weapon range
  when longer) that its owner sees; ties go to the lowest id.
* With an engaged enemy it acts as an Attack order: stands when in weapon
  range, else closes in. It drops the enemy when it dies or leaves the
  acquisition range, then looks again; with none left it resumes the move.
* Arriving at the point makes it idle, as a Move does.

### 3.2 Guard (`Command::Guard`, `Order::Guard`)

* Units walk to the point as for a Move; each armed ground unit's destination
  becomes its **post**. Unarmed units and flyers just move.
* Radii around the post, from the unit's acquisition range: inner =
  `innerPercent` (180 %), outer = `outerPercent` (220 %). Chase time =
  `chaseTicks` (150 = 10 s). Values in `globals.yaml` `guard`.
* With no target, the guard picks the nearest enemy it can hurt within the
  inner radius of its post, **seen or not** (Zero Hour's guard scan has no
  fog filter), and the chase time is refilled.
* With a target it acts as an Attack order. Each tick the target is inside the
  inner radius the chase time refills; outside it, one tick is spent. The
  target is dropped when it dies, leaves the outer radius of the post, or the
  chase time runs out.
* With no target it walks back to its post (scanning on the way) and stands
  there.
* A guard with no target that is shot (or whose friend nearby is shot) by a
  shooter in retaliation range targets that shooter (spec 23), keeping its post
  and leash.

### 3.3 Both

* Stop, or any new order, ends them. Saves keep them (`attackMove`, `guard`
  order and command kinds). The state hash includes them.

## 4. Client

* Command panel Units section: **Attack move (F)** and **Guard (H)** buttons
  after Force fire, with inline icons (crossed swords with a chevron; a
  shield). A press arms the next map tap; it lights while armed; a second press,
  Esc or the right click disarms.
* Keys: `F` arms Attack move and `H` arms Guard while own units are selected.
* Cursor: while armed, the map cursor is a red crossed-swords chevron (attack
  move) or a blue shield (guard).
* The tap sends the order for the selected own units at the ground point; the
  usual acknowledgement voice plays.
* The Controls page lists both keys.

## 5. Assumptions

* A1: Zero Hour's keys are A (attack move) and G (guard), but here A pans the
  camera and G toggles gore, so they are `F` and `H`.
* A2: Scout/Explore is not added: Zero Hour has no such order (issue #452 asked
  "only if ZH has it").
* A3: Guard without pursuit, guard flyers only, guarding a unit (follow),
  scatter and Alt waypoint queues are not added in this change.
* A4: Scans run every tick instead of Zero Hour's 0.5 s / 1 s staggered random
  rates: the same result without consuming the logic RNG.
* A5: An engaged attack-move enemy is dropped when it leaves the unit's
  acquisition range (Zero Hour's attack state machine has no such leash; this
  keeps the column moving).
* A6: The guard radii use the human-player modifiers for every player; the
  computer AI does not give guard or attack-move orders yet.
* A7: Every armed unit of a group guards the spot it was sent to (its own spread
  cell), not one shared point.

## 6. Acceptance

* AC-49-01 (`crates/sim/tests/unit_modes.rs`): an attack-moving tank engages a
  truck beside its road, destroys it and arrives at the point idle.
* AC-49-02: the same trip as a plain move arrives sooner (it never stops).
* AC-49-03: an unarmed unit given an attack move gets a plain Move.
* AC-49-04: a guarding tank attacks a truck 9 tiles away (inside the inner
  radius, outside its sight), destroys it and returns to its post.
* AC-49-05: a truck beyond the inner radius is ignored; the guard stays put.
* AC-49-06: a faster truck fleeing beyond the outer radius is let go and the
  guard returns to its post.
* AC-49-07 (`client/src/input/unitModes.test.ts`): an armed tap sends the order
  for the selected own units at the point.
* Stop ends both orders (`stop_ends_attack_move_and_guard`).
