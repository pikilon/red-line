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
  (splash, or direct hit within `DIRECT_HIT_CENTI`). Splash also hits friendly
  units and buildings in its radius (owner request 2026-10-25), and a direct
  hit catches a friendly that stands at the impact point; automatic targeting
  still ignores friendlies.
* A homing weapon fired at the ground flies as a ballistic one (no victim).
* An unreachable point (blocked cell) walks to the nearest passable cell.

## 2. Simulation

* `Command::AttackGround { units, target }` → `Order::AttackGround`
  (hashed tag `5`; saved as `{ "attackGround": ... }`). `GROUND_TARGET`
  (`u32::MAX`) marks a projectile / `last_target` aimed at the ground.
* `aim_turret` takes the aim point instead of an entity index.

## 3. Precedent

`generals-precedent` notes 2026-10-24 (input) and 2026-10-25 (targeting),
source `electronicarts/CnC_Generals_Zero_Hour@0a05454d8` (paths under
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
* A new attack order replaces the locked victim on the command tick:
  `AIUpdateInterface::privateAttackObject` clears the AI state machine and
  re-enters `AI_ATTACK_OBJECT` (`Source/GameLogic/Object/Update/AIUpdate.cpp:3433-3436`);
  its `onExit` nulls the victim and clears every turret goal
  (`Source/GameLogic/AI/AIStates.cpp:5692-5722`), and
  `TurretAI::setTurretTargetObject` re-aims at the new target
  (`AI/TurretAI.cpp:571-600`). The weapon reload is not reset
  (`Source/GameLogic/Object/Weapon.cpp:2661-2671`,
  `WeaponSet.cpp:788`), so the first shot at the new target waits out the
  remaining cooldown. An auto-acquired victim stays sticky until it dies, is
  unattackable or leaves range (`AIStates.cpp:5600-5603`,
  `TurretAI.cpp:1013-1023`).
* Which button is the plain order button is the `UseAlternateMouse` option
  (`Source/GameClient/GUI/GUICallbacks/Menus/OptionsMenu.cpp:322-334`):
  alternate = left selects, right orders; regular = left orders, right
  deselects or cancels. Red Line uses the alternate one. A plain left click
  attacks an enemy only in the regular scheme (`CommandXlat.cpp:3678-3711` for
  the alternate right click, `:3741-3781` for the regular left click;
  `Source/GameClient/SelectionInfo.cpp:198-206`, `SelectionXlat.cpp:712-726`).
* Attack orders are not fog-gated: the weapon layer's shroud check is
  deliberately commented out (`Source/GameLogic/Object/WeaponSet.cpp:531-545`);
  fog only gates automatic acquisition (`Source/GameLogic/Object/Update/AIUpdate.cpp:4640`)
  and the client's hiding/picking (`GameClient.cpp:718`,
  `EngineDevice/Source/W3DDevice/GameClient/W3DScene.cpp:351`). Dispatch only
  checks that the target still exists (`GameLogicDispatch.cpp:1207-1219`).
* Picking is a camera ray against the model's bounds
  (`EngineDevice/Source/W3DDevice/GameClient/W3DView.cpp:2207-2232`,
  `W3DScene.cpp:351-377`), not a screen-space radius; only area selection
  projects centres.

Red Line copies the input: Ctrl is held, and either Ctrl + left click or
Ctrl + right click force-fires under the cursor, with the pick deciding object
vs point as in the original. The plain right click keeps its context action,
and a move never fires. An ordered attack on an enemy outside the player's fog
is accepted and chased, matching Zero Hour; automatic targeting stays fog-gated
(§1 and spec 03 §5.11). Deliberate deviations:

* Red Line uses the alternate scheme but also accepts a plain left click on an
  enemy as attack (owner request 2026-10-24), so the target can be clicked
  without a modifier.
* Own and neutral objects are not force-attacked directly (a click falls back
  to a ground shot); a ground shot can still catch own units with a direct
  hit or splash.
* Selected buildings are not force-fired, so a production building keeps its
  rally orders.
* Picking approximates the original ray with a one-tile order radius; selection
  keeps the half-tile pick (spec 03 §6.5).

## 4. Feedback and assumptions

* A client-only red disc and ring pulse on the ground under the ordered target
  (or at the attack-ground point) for `ATTACK_MARKER_MS` = 1300 ms, growing
  slightly and blinking out; an entity target is followed while the marker is
  alive (`client/src/render/attackMarker.ts`, owner request 2026-10-25). Up to
  four markers coexist; a fifth recycles the oldest. It acknowledges the order
  without touching the simulation.
* The mouse cursor itself does not change.
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
  selection; with `Ctrl+A` selecting the HIMARS and the unarmed dozer, the
  same click still gives the HIMARS the `attack` order (the unarmed unit does
  not block it); no console error.
* AC-20-04 (`crates/sim/tests/combat.rs`): a HIMARS does not auto-target a
  truck 10 tiles away outside its sight; once ordered to attack it, it fires
  and damages the truck, and a new attack order on an in-range rifleman
  switches the fire to it (spec 11 AC-11-18) instead of keeping the old
  target.
* AC-20-05 (Playwright): in the AC-20-03 scene, an attack order or an
  `AttackGround` order makes `__redline.attackMarkerCount()` at least 1 in the
  next frame; after 1.5 s it is 0 again; no console error.
