# Spec 20 — Attack ground (force fire at a point)

## 1. Behaviour

* **Player input:** hold `Ctrl` and left click on the map with units selected
  (Zero Hour's held force-attack mode, §3). `Ctrl` + right click does the same,
  because in Red Line the right button is the plain order button. On macOS
  `Ctrl` + left click also arrives as a context menu; the client treats that
  gesture as force fire, never as the plain right click. A plain right click
  keeps its normal action (spec 08 §3.7).
* Every selected own **armed unit** receives the order: an enemy unit or
  building under the cursor is attacked (so a moving target is followed,
  §3); any other point gets an `AttackGround` order at that point. Unarmed
  units and buildings are unaffected and keep their order.
* Orders pick an enemy unit within `ORDER_PICK_RADIUS_TILES` (one tile, spec 03
  §6.5), so clicking any part of the model counts; selection keeps the tighter
  half-tile pick.
* A plain left click on an enemy unit or building with own armed units
  selected attacks it and keeps the selection (owner request 2026-10-24), so
  clicking the target works without holding a modifier. The original leaves
  this click to its order button (§3); Red Line accepts both because the owner
  expects click-to-attack. A left click on the ground still selects or
  deselects; it never fires.
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

## 3. Precedent

`generals-precedent` note 2026-10-24, source
`electronicarts/CnC_Generals_Zero_Hour@0a05454d8` (paths under
`GeneralsMD/Code/GameEngine/`):

* Ctrl is a held force-attack mode, not a click chord of its own: the command
  map arms `BEGIN_FORCEATTACK` on Ctrl down and disarms it on release
  (`Data\English\CommandMap.ini:814-826` in `EnglishZH.big`;
  `Source/GameClient/MessageStream/CommandXlat.cpp:3483-3489`). While it is
  armed, both click messages call `evaluateForceAttack` instead of the normal
  context action (`CommandXlat.cpp:3678-3710` for the right button and
  `:3741-3781` for the left).
* On empty ground that sends `MSG_DO_FORCE_ATTACK_GROUND` with the world point
  (`CommandXlat.cpp:1388-1398`), which becomes `AIGroup::groupAttackPosition`
  (`Source/GameLogic/System/GameLogicDispatch.cpp:1249-1277`); its
  `NO_MAX_SHOTS_LIMIT` keeps the unit firing until it gets another order or is
  stopped (`Source/GameLogic/AI/AIGroup.cpp:2223`). The clicked point decides
  the order; there is no "nearest enemy" lookup.
* Over an attackable object the same mode sends `MSG_DO_FORCE_ATTACK_OBJECT`
  and forces an attack on that object (`CommandXlat.cpp:1352-1370`).
* A plain order click on empty ground is a pure move and never fires
  (`CommandXlat.cpp:886-902`, `:2295`). The force-attack cursor
  `ForceAttackGround` shows the mode before the click
  (`INIZH.big:Data\INI\Mouse.ini:76`).
* Which button is the plain order button is the `UseAlternateMouse` option
  (`Source/GameClient/GUI/GUICallbacks/Menus/OptionsMenu.cpp:322-334`):
  alternate = left selects, right orders; regular = left orders, right
  deselects or cancels. Red Line uses the alternate one.

Red Line copies the input: Ctrl is held, and either Ctrl + left click or
Ctrl + right click force-fires under the cursor, with the pick deciding object
vs point as in the original. The plain right click keeps its context action,
and a move never fires. Two deliberate deviations: own and neutral objects are
not force-attacked (the sim has no friendly fire; the click falls back to a
ground shot), and selected buildings are not force-fired, so a production
building keeps its rally orders.

## 4. Assumptions

* No ground marker is drawn and the mouse cursor does not change; the shells
  themselves are the feedback.
* Ctrl is latched on the button press: releasing Ctrl before the button still
  fires.

## 5. Acceptance criteria

* AC-20-01 (`crates/sim/tests/combat.rs`): a mortar shells a point with no
  enemy in sight, ignores another enemy in range, and `Stop` ends it; out of
  range it approaches only until the point is in range.
* AC-20-02 (`client/src/input/intent.test.ts`): `resolveForceFire` sends only
  the armed own units, attacks an enemy unit or building under the cursor, and
  sends `attackGround` for any other point.
* AC-20-03 (Playwright): in `?debug=1&speed=4&ai=off`, a spawned owner-0
  `ua-himars` is selected with a left click; holding `Ctrl` and left clicking
  the ground at `(40, 58)` keeps it selected and, on the next tick, its saved
  order is `attackGround` toward `(40, 58)`; `Ctrl` + left click on an enemy
  building gives it an `attack` order on that building; after a `Stop`, `Ctrl`
  + right click on the ground does the same as the left click; a plain left
  click on the enemy building also gives it an `attack` order and keeps the
  selection; no console error.
