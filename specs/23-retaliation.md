# Spec 23 — Retaliation (units answer the fire that hits them)

## 1. Behaviour

* When a unit is hit by an enemy shot, it and its **idle** friends nearby turn on
  the shooter, even when the shooter is outside their weapon range: they walk
  until it is in range and fire (an ordinary `Attack` order).
* Responders are own units that are armed (weapon able to hurt the shooter),
  mobile and idle (no order). Units with an order (move, attack, harvest,
  build...) keep it. Buildings never move, so they only use normal targeting.
* The shooter must be at most 9 tiles from the victim (so far artillery is not
  chased). It does **not** need to be visible: a shot gives it away, and an
  `Attack` order keeps chasing a target hidden in the fog while it is within 9
  tiles of the unit. Friends are the idle units within
  5.5 tiles of the victim.
* The chase ends like any attack order: when the shooter dies or gets more than 9
  tiles away, the unit goes idle (and then auto-targets as usual).

## 2. Simulation

* Hooked into `apply_hit` / `apply_splash`; one `next_order_id` is consumed per
  retaliation that finds responders. Responders are picked in ascending index
  order. Constants live in `combat.rs` (`RETALIATION_*_CENTI`).

## 3. Precedent

`generals-precedent` note: Zero Hour `ActiveBody::attemptDamage` sends the
victim and idle mobile friends within `RetaliationFriendsRadius` (120) into
`aiGuardRetaliate` against the attacker, gated by `MaxRetaliationDistance`
(200) and by KINDOF flags (immobile, drone, cannot-retaliate).

## 4. Assumptions

* World units are scaled to tiles so the original 200 / 120 become 9 / 5.5
  tiles (about twice a rifle's range).
* Zero Hour ends a retaliation chase after 10 s; here it lasts until the target
  is dead or out of sight (the simple attack order).
* Always on for every player; no toggle.

## 5. Acceptance criteria

* AC-23-01 (`crates/sim/tests/combat.rs`): a soldier shot by a mortar outside
  its range advances on it; an idle friend nearby joins; a unit with a move
  order does not.
