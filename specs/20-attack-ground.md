# Spec 20 — Attack ground (force fire at a point)

## 1. Behaviour

* **Player input:** `Ctrl` + right click on the map (on macOS also `Ctrl` + left
  click, which the browser reports as a context menu) with units selected.
* Every selected own **armed unit** receives an `AttackGround` order at that
  point; unarmed units and buildings are unaffected and keep their order.
* The unit walks until the point is inside `[minRange, range]` of its weapon,
  stops there, turns its turret (or hull) to the point and fires with the
  normal weapon rules (cooldown, salvo, scatter, splash). It keeps firing
  until stopped (`Stop`) or given any other order.
* The order ignores other targets: the unit does not auto-target enemies while
  it holds it. A shot hits whatever enemy is at the impact point
  (splash, or direct hit within `DIRECT_HIT_CENTI`). No friendly fire, as for
  every shot.
* A homing weapon fired at the ground flies as a ballistic one (no victim).
* An unreachable point (blocked cell) walks to the nearest passable cell.

## 2. Simulation

* `Command::AttackGround { units, target }` → `Order::AttackGround`
  (hashed tag `5`; saved as `{ "attackGround": ... }`). `GROUND_TARGET`
  (`u32::MAX`) marks a projectile / `last_target` aimed at the ground.
* `aim_turret` takes the aim point instead of an entity index.

## 3. Assumptions

* Zero Hour's force-fire-at-location (Ctrl + click) behaves the same way; the
  `generals-precedent` note was not consulted, so verify the details.
* No ground marker is drawn; the shells themselves are the feedback.

## 4. Acceptance criteria

* AC-20-01 (`crates/sim/tests/combat.rs`): a mortar shells a point with no
  enemy in sight, ignores another enemy in range, and `Stop` ends it; out of
  range it approaches only until the point is in range.
* AC-20-02 (`client/src/input/intent.test.ts`): `resolveAttackGround` sends
  only the armed own units.
