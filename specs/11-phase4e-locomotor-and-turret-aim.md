# 11 — Phase 4e locomotor and turret aim

Status: hull locomotion (P4-21), turret aim (P4-22), snapshot angles (P4-23) and
client rendering (P4-24) implemented; owner playtest 2026-10-24 asked for
body motion while driving (§6.1).
Depends on `03-phase2-core-loop.md` (movement §5.10, combat §5.11, snapshot
§5.15), `06-phase4a-procedural-models.md` §5.1 (turn rates in the data) and
`09-phase4c-animation-and-finish.md`. Roadmap: Phase 4. Decisions: D-02
(deterministic fixed-point simulation), D-05 (2.5D).

## 1. Context

Owner playtest 2026-10-12 found these problems:

1. Vehicles slide: the simulation moves every unit straight along its flow
   field direction and the client only rotates the model (spec 06 §5.1), so a
   truck drives sideways while its hull catches up ("turning on ice").
2. The `ua-bradley` turret does not turn to fire.
3. The `ua-defense` (Stugna-P emplacement) turret does not turn to fire.
4. Dozers and trucks back up oddly: the model points one way while the unit
   slides the other. Reversing is fine as long as it does not look like ice.

Owner requests (2026-10-12): a turret should swing back to the direction of
travel (its rest position) while the vehicle drives somewhere else, and
vehicles may reverse for short moves if it looks like real driving.

Diagnosis (no code changed, reproduced with a scratch probe against
`crates/sim`):

* Problem 2. The `.glb` has its `turret` node (`client/public/models/ua-bradley.glb`
  nodes: `turret`, `ua-bradley`) and the client turns it
  (`client/src/render/entities.ts:426-453`). But the snapshot only carries a
  target on the tick the weapon fired: `World::update_combat` clears
  `last_target` every tick (`crates/sim/src/combat.rs:31-33`) and
  `entity_row` encodes it only when set (`crates/sim/src/snapshot.rs:165-178`).
  The Bradley fires every 8 ticks (`ua-bushmaster`, `cooldownTicks: 8`), so the
  target is visible in 1 snapshot of 8 (67 ms). `HeadingTracker.update`
  (`client/src/render/heading.ts:124-130`) turns the turret towards the target
  for that one frame (180 °/s × 0.067 s = 12°) and back towards the hull for the
  other seven. The turret never reaches the target. The same applies to every
  turret; slower weapons (`ua-rh120`, 30 ticks) are worse.
* Problem 3. Same cause as problem 2. The emplacement fires every 60 ticks
  (`ua-stugna-emplacement`, `data/factions/ukraine.yaml:11`), so its target is
  in 1 snapshot of 60 and the turret turns 120 °/s × 0.067 s = 8° towards it
  before drifting back. Buildings keep hull yaw 0 (`entities.ts:426`), so the
  turret settles facing forward. The `.glb` has its `turret` node.
* Problem 4. Same cause as problem 1, seen backwards: the client hull turns
  towards the movement direction at `turnRateDeg` (`heading.ts:123`) while the
  unit already moves the opposite way, so for about a second it drives
  backwards with no steering.

Precedent (generals-precedent notes, source
`electronicarts/CnC_Generals_Zero_Hour@0a05454d`, paths under
`GeneralsMD/Code/GameEngine/`):

* Locomotor (note 2026-10-12, "vehicle locomotor"). Movement dispatches on the
  locomotor appearance (`Source/GameLogic/Object/Locomotor.cpp:1087-1096`).
  TREADS turn in place at full `TurnRate` regardless of speed, and the goal
  speed is `(1 − |relAngle| / (π/4)) × desiredSpeed`, so a tank stops and pivots
  when 45° or more off heading (`Locomotor.cpp:1168`, `1195-1204`). WHEELS turn
  only while moving: `turnAmount = min(1, speed / MinTurnSpeed) × TurnRate`, with
  `MinTurnSpeed` floored at `maxSpeed / 4`, and speed capped at `MinTurnSpeed`
  while the heading error exceeds π/20 (`Locomotor.cpp:1307`, `1340-1343`,
  `1461-1468`). Wheels reverse or do a 3-point turn when stopped more than 90°
  off (`Locomotor.cpp:1305-1330`). Acceleration and braking are per locomotor;
  treads brake at `slowDownDist = (v / 1.5) × (v / Braking)`
  (`Locomotor.cpp:1212`). Arrival moves exactly onto the goal by
  `min(speed, dist)` (`Locomotor.cpp:1116-1150`). The "ultra accurate" flag is
  dead in released code. INI values are not in the public repository.
* Turret aim (note 2026-10-12, "turret firing"). A turret goes IDLE → AIM →
  FIRE → HOLD → RECENTER (`Source/GameLogic/AI/TurretAI.cpp:91-103`); AIM moves
  to FIRE only when yaw is within `REL_THRESH = 0.035` rad (≈ 2°) and the target
  is in range (`TurretAI.cpp:1092-1103`, `1167-1173`). The turret snaps when the
  remaining angle is below one step (`TurretAI.cpp:403`). Recenter waits
  `RecenterTime` (default 2 s) and turns at half rate (`TurretAI.cpp:200`,
  `1226-1240`). A weapon without a turret turns the hull: in place when the
  locomotor can stop, firing only when `|relAngle| < AcceptableAimDelta`
  (clamped to ≥ 0.035 rad) (`Source/GameLogic/AI/AIStates.cpp:5036`,
  `5056-5081`). Only turreted units pursue while firing
  (`AIStates.cpp:2368-2370`).

## 2. Scope

In:

* Fixed-point angles and integer trigonometry in `crates/sim`.
* Per-type motion profile precomputed from the data at ruleset load (owner
  remark 2026-10-12: the rules live in the unit, so nothing is re-derived per
  tick).
* Hull heading, current speed, acceleration and braking for vehicles; tracked
  vehicles pivot, wheeled vehicles turn while moving; units move where they
  face.
* Turret angle in the simulation; a turret must align before firing; a
  turretless weapon needs the hull aligned.
* Heading and turret angle in the snapshot; the client renders them instead of
  inferring them from movement.
* Short reverse moves for tracked and wheeled vehicles (§5.2.1).
* The turret returns to the direction of travel while moving with no target.

Out (deferred):

* 3-point turns for wheels.
* Turret pitch, damaged locomotor values, turn pivot offset.
* Infantry facing rules beyond §5.4 (infantry keeps today's movement).

## 3. Angles and trigonometry (`crates/sim/src/angle.rs`, new)

```rust
/// Binary angle: 65536 units per turn, wrapping. 0 faces +y, a quarter turn
/// (16384) faces +x, so `dir(a) = (sin a, cos a)` and the client yaw is
/// `a × 2π / 65536` (same convention as `Math.atan2(dx, dz)`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Angle(pub u16);

pub const TURN: i32 = 65536;

impl Angle {
    /// Signed shortest difference `to − self` in (−32768, 32768].
    pub fn delta(self, to: Angle) -> i32;
    /// `self` turned towards `to` by at most `step` units (≥ 0); exactly `to`
    /// when the remaining difference is ≤ `step` (Generals snap,
    /// TurretAI.cpp:403). `step == 0` means instant: returns `to`.
    pub fn turn_towards(self, to: Angle, step: i32) -> Angle;
    /// Unit vector `(sin, cos)` as `FxVec2`, from `SIN_TABLE`.
    pub fn dir(self) -> FxVec2;
}

/// Angle of the vector `(dx, dy)`; `Angle(0)` for the zero vector. Octant
/// reduction plus `ATAN_TABLE[ratio]`, ratio = min/max × 1024 with an `i64`
/// intermediate. Integer only.
pub fn atan2(dx: Fx, dy: Fx) -> Angle;

/// `deg × 65536 / 360 / TICK_RATE_HZ`, rounded down, at least 1 when
/// `deg > 0`; 0 when `deg == 0`.
pub fn deg_per_second_to_step(deg: u32) -> i32;
/// `deg × 65536 / 360`, rounded down.
pub fn deg_to_units(deg: u32) -> i32;
```

* `SIN_TABLE: [i32; 1025]` (Fx raw of sin over a quarter turn, index =
  units / 16) and `ATAN_TABLE: [u16; 1025]` (atan(i / 1024) in angle units) are
  committed constants, generated once by `scripts/gen-trig-tables.mjs`
  (floats only in that script; the sim only reads integers).
* No `f32`/`f64` anywhere in `crates/sim` (existing clippy rule).

## 4. Data and the precomputed motion profile

### 4.1 Globals (`data/rules/globals.yaml`, `globals.schema.json`)

```yaml
aimToleranceDeg: 2          # required, 1..45: default weapon aim tolerance
turretRecenterTicks: 30     # required, >= 0: idle ticks before a stationary turret recenters (Generals RecenterTime 2 s)
locomotors:                 # required, ids referenced by unit types
  foot:    { kind: foot }
  tracked: { kind: tracks, pivotAngleDeg: 45, accelCenti: 2, brakingCenti: 4, reverseAngleDeg: 120, reverseMaxCenti: 300, reverseSpeedPercent: 50 }
  wheeled: { kind: wheels, minTurnSpeedPercent: 40, slowTurnAngleDeg: 9, accelCenti: 2, brakingCenti: 3, reverseAngleDeg: 120, reverseMaxCenti: 300, reverseSpeedPercent: 40 }
```

* `kind`: `foot | tracks | wheels`. `pivotAngleDeg` 1..180 (tracks only).
  `minTurnSpeedPercent` 25..100 (wheels only; Generals floors MinTurnSpeed at
  maxSpeed/4). `slowTurnAngleDeg` 1..90 (wheels only; Generals π/20 = 9°).
  `accelCenti`, `brakingCenti` ≥ 1, centi-tiles per tick² (tracks, wheels).
  `reverseAngleDeg` 90..180, `reverseMaxCenti` ≥ 0 (0 disables reversing),
  `reverseSpeedPercent` 10..100 (tracks, wheels).

### 4.2 Faction types (`data/factions/*.yaml`, `faction.schema.json`)

* Every unit gains `locomotor` (required for units, forbidden for buildings and
  depots), a key of `globals.locomotors`.
* Weapons gain optional `aimToleranceDeg` (1..45, default the global).
* An armed building must have `turretTurnRateDeg > 0` (semantic check).
* Initial assignment:

  | Locomotor | Types |
  |---|---|
  | `foot` | `ua-rifleman`, `ru-rifleman`, `ua-stugna-team`, `ru-rpg-gunner` |
  | `tracked` | `ua-bradley`, `ru-bmp-2`, `ua-leopard-2a4`, `ru-t-72b3`, `ru-tos-1a`, `ua-dozer`, `ru-dozer` |
  | `wheeled` | `ua-kozak-scout`, `ru-brdm-scout`, `ua-himars`, `ua-supply-truck`, `ru-supply-truck` |

  Infantry weapons (`ua-rifle`, `ua-stugna-p`, `ru-*` equivalents) get
  `aimToleranceDeg: 15`.

`build-data.mjs` emits `locomotor` (index into `ruleset.locomotors`),
`aimToleranceDeg` and the globals into `data/generated/ruleset.json`; absent
fields are emitted as 0 / `-1` so older fixtures still load.

### 4.3 Precomputed profile (`crates/sim/src/rules.rs`)

Computed once in `Ruleset::from_json`, stored on `TypeDef` / `WeaponDef`:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocoKind { Instant, Foot, Tracks, Wheels }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Motion {
    pub kind: LocoKind,        // Instant when the type has no locomotor (fixtures)
    pub max_speed: Fx,         // fx_centi(speed_centi)
    pub turn_step: i32,        // deg_per_second_to_step(turnRateDeg); 0 = instant
    pub turret_step: i32,      // deg_per_second_to_step(turretTurnRateDeg); 0 = no turret
    pub pivot: i32,            // deg_to_units(pivotAngleDeg)
    pub slow_turn: i32,        // deg_to_units(slowTurnAngleDeg)
    pub min_turn_speed: Fx,    // max_speed × minTurnSpeedPercent / 100
    pub accel: Fx,             // fx_centi(accelCenti)
    pub braking: Fx,           // fx_centi(brakingCenti)
    pub reverse_angle: i32,    // deg_to_units(reverseAngleDeg)
    pub reverse_max: Fx,       // fx_centi(reverseMaxCenti); 0 = never reverses
    pub reverse_speed: Fx,     // max_speed × reverseSpeedPercent / 100
}
// TypeDef gains `pub motion: Motion`; WeaponDef gains `pub aim_tolerance: i32`.
```

Examples: `ua-bradley` `turn_step` = 220 × 65536 / 360 / 15 = 2669,
`turret_step` = 2184; `ua-defense` `turret_step` = 1456; aim tolerance 2° = 364.

`LocoKind::Instant` (no `locomotor` field, as in `tests/fixtures/test-rules.json`)
reproduces today's behaviour exactly: instant turn, instant speed, movement
along the flow direction, no aim gating. Existing spec tests stay green.

## 5. Simulation behaviour

### 5.1 Entity state (`crates/sim/src/entity.rs`)

`Entity` gains `heading: Angle`, `turret: Angle` (relative to the hull),
`speed: Fx`, `reversing: bool`, `aim: Option<EntityId>` and
`idle_aim_ticks: u32`. Spawned units
face `Angle(0)`, or the direction to their rally point when produced; buildings
have `heading` 0. All six fields are part of the state hash
(`crates/sim/src/hash.rs`).

### 5.2 Locomotion (`crates/sim/src/locomotor.rs`, new)

`step_move` and `step_toward_goal` (`world.rs`) compute the desired
displacement: the vector to the final point inside the goal cell or when
`MapGrid::line_passable(pos, final point)` holds, otherwise the flow direction.
They pass it, with the straight-line distance to the final point in every cell,
to the locomotor. `line_passable` walks every cell the segment crosses (integer
grid walk; where the segment crosses a cell corner exactly, both side cells must
be passable) and is true when all are passable. Generals steers at the next
node of a path optimised by line of sight (`Path::optimizeGroundPath`,
`AIPathfind.cpp:602`; `Path::computePointOnPath`, `AIPathfind.cpp:934-937`), so
on a clear last stretch it drives straight at the goal; aiming at the final
point when it is in line matches that stretch. Following the flow field until
then is a deviation, since the flow field has no path nodes:

```rust
/// One tick of motion towards `desired` (a non-zero direction) for a unit
/// whose straight-line distance to its final point is `remaining`; `in_goal`
/// is true inside the goal cell. Returns true when the unit arrived (snapped).
pub(crate) fn locomote(world: &mut World, index: usize, desired: FxVec2, remaining: Fx, in_goal: bool) -> bool;
```

Per kind, with `d = atan2(desired)`:

* **Instant / Foot**: `heading = heading.turn_towards(d, turn_step)`;
  position moves by `desired.normalize() × max_speed` (today's rule, including
  the snap when `in_goal` and `remaining ≤ max_speed`); `speed = max_speed`
  while moving.
* **Tracks**:
  1. `heading = heading.turn_towards(d, turn_step)`; `e = |heading.delta(d)|`.
  2. `target = 0` if `e ≥ pivot`, else `max_speed × (pivot − e) / pivot`
     (Generals `Locomotor.cpp:1195-1204`).
  3. `target = min(target, max(accel, sqrt(2 × braking × remaining)))`, in
     every cell, so braking starts before the goal cell. The straight-line
     distance is never longer than the path, so a detour only brakes early.
     Generals brakes on the distance along the path (`onPathDistToGoal`,
     `Locomotor.cpp:1188-1201`).
  4. `speed` moves towards `target` by at most `accel` up, `braking` down.
  5. When `in_goal` and `remaining ≤ speed`: snap to the final point,
     `speed = 0`, arrived (only inside the goal cell, so a snap never crosses
     a wall corner).
     Otherwise `next = pos + heading.dir() × speed`; when `cell_of(next)` is
     impassable, the unit does not move and `speed = 0`.
* **Wheels**: as tracks, except step 1 uses `step = max(turn_step / 4,
  turn_step × min(speed, min_turn_speed) / min_turn_speed)` (Generals
  `Locomotor.cpp:1461-1468`; the `turn_step / 4` floor replaces the deferred
  3-point turn so a stopped truck can still turn) and step 2 is
  `target = min(max_speed, min_turn_speed)` when `e > slow_turn`, else
  `max_speed` (`Locomotor.cpp:1340-1343`).

#### 5.2.1 Reversing (tracks and wheels)

When a vehicle receives a `Move` order (and only then: the choice is fixed for
the whole order, so it never flips mid-route), it sets `reversing = true` when
`|heading.delta(atan2(target − pos))| ≥ reverse_angle` and the straight-line
distance to the target is ≤ `reverse_max`. While reversing, every rule above
uses `d' = d + 32768` (the rear faces the goal) and `max_speed` is replaced by
`reverse_speed`; the position moves by `−heading.dir() × speed`, so the unit
drives backwards exactly along its hull axis and steers with the same turn
rules (no sideways sliding). `reversing` is cleared on arrival or when the
order changes. Generals precedent: wheels reverse when stopped more than 90°
off (`Locomotor.cpp:1305-1330`); this spec extends it to tracks.

Orders that end movement (`Idle`, `Attack` in range, docked `Build`,
`Harvest` loading/unloading) brake: `speed` decreases by `braking` per tick
and the unit coasts along `heading` while `speed > 0` (same passability
check). Separation (§5.10 phase 3) is unchanged and does not change heading.

### 5.3 Turret aim and fire gating (`crates/sim/src/combat.rs`)

For each armed entity in the combat phase (order unchanged: ascending id):

1. Target: the current `Attack` order's target when valid (a new order
   overrides the lock, AC-11-18), else `aim` when still valid (§5.11
   validity), else `select_target` as today; store it in `aim` (sticky lock,
   Generals `TurretAI` keeps its victim while no new order replaces it).
2. With `turret_step > 0` and a target: `want = atan2(target − pos) −
   heading`; `turret = turret.turn_towards(want, turret_step)`;
   `aligned = |turret.delta(want)| ≤ aim_tolerance`; `idle_aim_ticks = 0`.
3. With `turret_step == 0` and a target: `want = atan2(target − pos)`. When
   the order is `Idle` or `Attack` with the target in range, `heading =
   heading.turn_towards(want, turn_step)` (hull turns in place); otherwise
   the hull keeps its heading. `aligned = |heading.delta(want)| ≤
   aim_tolerance`.
4. `LocoKind::Instant`: always aligned (today's behaviour).
5. Cooldown decrements as today; the weapon fires only when ready **and**
   aligned. Fire sets `last_target` as today.
6. No target: `aim = None`, `idle_aim_ticks += 1`. When the unit is moving
   (`speed > 0`), the turret turns towards `Angle(0)` (hull forward, the
   direction of travel) by `turret_step` at once (owner request: the turret
   takes its travel position while driving). When stationary, it waits until
   `idle_aim_ticks > turretRecenterTicks` and then turns towards `Angle(0)` by
   `max(1, turret_step / 2)` (Generals recenter at half rate).

Power and construction gating (`can_fire`, unchanged) run before steps 1–6.

### 5.4 Infantry

`foot` units keep today's movement. They aim with step 3 (the hull is the
weapon), using the weapon's `aimToleranceDeg` (15°); at 540–720 °/s
(`turn_step` 6553–8738 per tick) a 180° turn takes at most 5 ticks.

## 6. Snapshot and client

* `ENTITY_STRIDE` 9 → 11 (`crates/sim/src/snapshot.rs`): appends
  `heading` and world turret angle `heading + turret`, both as `0..65535`.
  Ghosts write `0, 0`. `client/src/sim/matchSnapshot.ts` `EntityState` gains
  `heading: number; turretAngle: number` (angle units).
* `client/src/render/heading.ts` exports
  `angleToYaw(units: number): number` (`units × 2π / 65536`, normalised to
  (−π, π]) and `lerpAngle(a: number, b: number, t: number): number` (shortest
  arc, angle units). `interpolateEntities` interpolates both angles with
  `lerpAngle` and the same `alpha` as positions.
* `entities.ts` takes hull yaw from `angleToYaw(entity.heading)` (units) and
  turret yaw from `angleToYaw(entity.turretAngle)` (units and buildings). The
  `HeadingTracker` and `turnRatesOf` of spec 06 §5.1 are no longer used for
  entities from a match snapshot; they stay for the tech-slice renderer.

### 6.1 Body motion while driving (owner request 2026-10-24)

Presentation only (`client/src/render/suspension.ts`), derived from the
rendered position and hull yaw, nothing in the sim: armoured units dip nose
down when braking and squat when accelerating (pitch ≤ 0.06 rad), lean outward
in turns (roll ≤ 0.07 rad, proportional to turn rate × speed) and shake
slightly with the engine while moving. Both hull and turret take the tilt.
Moving parts (`articulation` in the faction data, owner request 2026-10-24):
`launcher` (HIMARS) folds its pod flat while driving and its weapon fires only
when `speed == 0` (`stationaryFire`); `blade` (dozers) keeps the blade raised at
rest, lowers it while driving and raises and lowers it in a cycle while the
dozer works in place. A turreted vehicle with no target swings its turret ahead
of the hull towards its `Move` goal at twice its aim rate; with a target it keeps
aiming at it. Missile infantry (`stowTicks`: Stugna team 17, RPG gunner 8; owner request 2026-10-29)
stay still while they stow the launcher before a walk (the move order only takes
effect once `stow == stowTicks`) and while they set it up again after stopping;
they fire only when fully set up. The Stugna operator slings the launcher on his
back; the snapshot reports the stow progress in permille in `progress`.
Infantry animation stays deferred.
Assumption: Generals' tread and wheel texture animation
(`TreadDriveSpeedFraction`, W3DTankDraw) is not reproduced yet.

## 7. Acceptance criteria

**AC-11-01 Fixed-point angles.** Given `atan2` and `Angle::dir`, when
evaluated on every multiple of 64 angle units, then `atan2(dir(a)) ` is within
±8 units of `a`; `atan2(0, 1) = 0`, `atan2(1, 0) = 16384`, `atan2(0, −1) =
32768`, `atan2(−1, 0) = 49152`; `Angle(65000).delta(Angle(100)) = 636`;
`turn_towards` snaps when the remaining difference ≤ step and returns the
target for step 0; `deg_per_second_to_step(220) = 2669`,
`deg_per_second_to_step(1) = 12`, `deg_per_second_to_step(0) = 0`.

**AC-11-02 Motion profile from data.** Given the built-in ruleset, when
loaded, then `ua-bradley.motion` is `Tracks` with `turn_step 2669`,
`turret_step 2184`, `pivot 8192`; `ua-supply-truck.motion` is `Wheels` with
`min_turn_speed = max_speed × 40 / 100`; `ua-rifleman.motion` is `Foot`;
`ua-rifle.aim_tolerance = 2730`, `ua-rh120.aim_tolerance = 364`; and the test
fixture's types are `Instant`. A faction file with a unit missing `locomotor`,
an unknown locomotor id, or an armed building without `turretTurnRateDeg`
fails `node --run check:data`.

**AC-11-03 Tracked pivot.** Given a `tracked` unit at rest facing `Angle(0)`
on an open map, when ordered to a point straight behind it (heading error
180°), then its position does not change while `|heading error| ≥ 45°`, the
heading changes by exactly `turn_step` per tick until then, and afterwards it
moves only along `heading.dir()` (every per-tick displacement is parallel to
the heading within 1 raw unit per axis).

**AC-11-04 Tracked slowdown and acceleration.** Given a `tracked` unit at rest
facing its goal, when it starts moving, then its speed rises by `accel` per tick
up to `max_speed`; given a heading error `e < pivot` after turning, its speed
target is `max_speed × (pivot − e) / pivot`.

**AC-11-05 Wheeled turning arc.** Given a `wheeled` unit at rest facing
`Angle(0)`, when ordered to a point 90° to its right, then on the first tick
it turns by `max(turn_step / 4, …)` and moves forward, its speed never exceeds
`min_turn_speed` while the error exceeds `slow_turn` (when the error grows
after a faster start, the speed falls towards `min_turn_speed` at most `braking`
per tick, so a few ticks above it are allowed), and its path to the goal
is an arc (the unit is never displaced sideways relative to its heading). With
the goal in a straight line it steers at the goal, not along the flow field, and
ends exactly on it. `line_passable` is true across open cells and false when the
segment crosses a blocked cell, or crosses a corner exactly between two cells
where one is blocked.

**AC-11-06 Braking and arrival.** Given a `tracked` or `wheeled` unit moving
at `max_speed` towards a goal, when it approaches the goal, then its speed falls towards
`max(accel, sqrt(2 × braking × remaining))` (`remaining` is the straight-line
distance to the goal) at most `braking` per tick, so it enters the goal cell at
most `braking` above that bound. It ends exactly on
the goal-cell centre with `speed = 0` and `Order::Idle`, within
`ceil(path / min(max_speed, …)) + 30` ticks.

**AC-11-07 Moves where it faces near walls.** Given a `wheeled` unit whose
next step along its heading would enter an impassable cell, when stepped, then
it does not enter it, `speed` becomes 0, and it still reaches a goal around the
wall (the AC-02-03 map) within 600 ticks.

**AC-11-08 Turret must align before firing.** Given a powered `ua-defense`
with turret at `Angle(0)` and an enemy tank in range at 180°, when stepped,
then no shot is fired until `|turret error| ≤ aim_tolerance`, the turret turns
`turret_step` (1456) per tick, and the first shot happens on tick
`ceil(32768 / 1456) = 23` (±1).

**AC-11-09 Turreted unit fires while moving.** Given a `ua-bradley` on a
`Move` order with an enemy in range 90° to its side, when stepped, then it keeps
moving, its turret turns towards the enemy, and it fires once aligned.

**AC-11-10 Turretless hull aim.** Given an idle `ua-rifleman` facing away
from an enemy in range, when stepped, then its heading turns towards the enemy
by `turn_step` per tick and it fires only when within 15°; given the same
rifleman on a `Move` order whose heading is more than 15° off the enemy, it
does not fire.

**AC-11-11 Sticky aim and recenter.** Given a turret aiming at target A and a
nearer target B appearing, when stepped, then it keeps A while A is valid;
when no target remains for `turretRecenterTicks + 1` ticks, a stationary
turret turns towards `Angle(0)` at `turret_step / 2` per tick; a moving unit
with no target turns its turret towards `Angle(0)` by `turret_step` from the
first tick without a target.

**AC-11-12 Legacy rules unchanged.** Given `tests/fixtures/test-rules.json`
(no locomotors), when the Phase 1–3 suites run, then all pass unchanged, and
`Instant` units are always aligned.

**AC-11-13 Determinism.** Given the AC-03 determinism scenario with the
built-in ruleset, when run twice natively and once in WASM, then the state
hashes match at every 100 ticks, and the hash covers `heading`, `turret`,
`speed`, `aim` and `idle_aim_ticks` (changing any one changes the hash).

**AC-11-14 Snapshot angles.** Given a world with a unit facing `Angle(16384)`
with turret `Angle(16384)` relative to its hull, when encoded, then its record
has 11 fields ending with `16384, 32768`; `decodeMatchSnapshot` reads
`heading` and `turretAngle`; `lerpAngle(65000, 100, 0.5)` crosses 0 along the
short arc; `angleToYaw(16384) = π/2`.

**AC-11-15 Rendered from sim angles.** Given two snapshots where a unit's
`turretAngle` goes from 0 to 16384, when rendered at `alpha = 0.5`, then its
turret yaw is π/4 and its hull yaw is `angleToYaw(heading)`, independent of
its movement since the previous frame.

**AC-11-16 Short reverse.** Given a `wheeled` unit at rest facing
`Angle(0)`, when ordered to a point 2 tiles straight behind it, then
`reversing` is true, every per-tick displacement is anti-parallel to
`heading.dir()` (within 1 raw unit per axis), speed never exceeds
`reverse_speed`, and it arrives with its heading within 10° of `Angle(0)`;
ordered to a point 5 tiles behind, it does not reverse and pivots or arcs
instead (AC-11-03/05). The same holds for a `tracked` unit.

**AC-11-17 In the skirmish (Playwright).** Given a skirmish with a Bradley
and a `ua-defense` attacking enemy units, when 5 s pass, then at least one snapshot shows each
shooter's `turretAngle` within 2° of the direction to its target and no
console error.

**AC-11-18 A new attack order overrides a locked victim.** Given a mortar
that has just fired at truck A and locked it, when it is ordered to attack
soldier B in range, then on the next combat tick `aim` is B, the next volley
damages B, and A's HP no longer changes (`crates/sim/tests/combat.rs`).

## 8. Open questions for the owner

1. Locomotor values in §4.1 are first guesses (the Generals INI values are not
   public); tune after the playtest.
