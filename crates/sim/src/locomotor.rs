//! Hull locomotion (spec 11 §5.2, §5.2.1): heading, speed, braking and short
//! reverse moves per locomotor kind. Integer and fixed-point only.

use crate::angle::{Angle, atan2};
use crate::entity::Entity;
use crate::fixed::{Fx, FxVec2};
use crate::map::{MapGrid, cell_of};
use crate::rules::{LocoKind, Motion};

/// Half a turn in angle units: a reversing vehicle steers with the rear towards the goal.
const HALF_TURN: i32 = 32768;

/// Whether a `Move` order to `target` starts as a reverse move (spec 11 §5.2.1):
/// the goal lies at least `reverse_angle` off the heading and within `reverse_max`.
pub(crate) fn wants_reverse(motion: &Motion, pos: FxVec2, heading: Angle, target: FxVec2) -> bool {
    if !matches!(motion.kind, LocoKind::Tracks | LocoKind::Wheels) || motion.reverse_max == Fx::ZERO
    {
        return false;
    }
    let offset = target - pos;
    let error = heading.delta(atan2(offset.x, offset.y)).abs();
    error >= motion.reverse_angle && offset.length() <= motion.reverse_max
}

/// One tick of motion towards `target`, along the unit vector `desired` for a
/// unit whose straight-line distance to `target` is `remaining`; `in_goal` is
/// true inside the goal cell, the only place it snaps. Returns true when the
/// unit arrived; it is then on `target` with `speed = 0` and the caller ends
/// its order.
pub(crate) fn drive(
    unit: &mut Entity,
    motion: &Motion,
    nav: &MapGrid,
    desired: FxVec2,
    remaining: Fx,
    in_goal: bool,
    target: FxVec2,
) -> bool {
    let reversing = unit.reversing && matches!(motion.kind, LocoKind::Tracks | LocoKind::Wheels);
    match motion.kind {
        LocoKind::Immediate | LocoKind::Foot => {
            unit.heading = unit
                .heading
                .turn_towards(atan2(desired.x, desired.y), motion.turn_step);
            if in_goal && remaining <= motion.max_speed {
                unit.pos = target;
                unit.speed = Fx::ZERO;
                return true;
            }
            unit.pos = unit.pos + desired.scale(motion.max_speed);
            unit.speed = motion.max_speed;
            false
        }
        LocoKind::Tracks | LocoKind::Wheels => {
            let heading_to = atan2(desired.x, desired.y);
            let wanted = if reversing {
                Angle(heading_to.0.wrapping_add(HALF_TURN as u16))
            } else {
                heading_to
            };
            let top = if reversing {
                motion.reverse_speed
            } else {
                motion.max_speed
            };
            let step = if motion.kind == LocoKind::Tracks {
                motion.turn_step
            } else {
                wheel_turn_step(motion, unit.speed)
            };
            unit.heading = unit.heading.turn_towards(wanted, step);
            let error = unit.heading.delta(wanted).abs();
            let mut goal_speed = if motion.kind == LocoKind::Tracks {
                if error >= motion.pivot {
                    Fx::ZERO
                } else {
                    let scaled = i64::from(top.raw()) * i64::from(motion.pivot - error);
                    Fx::from_raw((scaled / i64::from(motion.pivot)) as i32)
                }
            } else if error > motion.slow_turn {
                top.min(motion.min_turn_speed)
            } else {
                top
            };
            // Braking starts before the goal cell (spec 11 §5.2 step 3).
            let twice = motion.braking.mul(remaining) + motion.braking.mul(remaining);
            goal_speed = goal_speed.min(motion.accel.max(twice.sqrt()));
            unit.speed = if unit.speed < goal_speed {
                (unit.speed + motion.accel).min(goal_speed)
            } else {
                (unit.speed - motion.braking).max(goal_speed)
            };
            if in_goal && remaining <= unit.speed {
                unit.pos = target;
                unit.speed = Fx::ZERO;
                unit.reversing = false;
                return true;
            }
            let heading = unit.heading.dir();
            let next = if reversing {
                unit.pos - heading.scale(unit.speed)
            } else {
                unit.pos + heading.scale(unit.speed)
            };
            if may_enter(nav, unit.pos, next) {
                unit.pos = next;
            } else {
                unit.speed = Fx::ZERO;
            }
            false
        }
    }
}

/// A hull may move to `next` when its cell is open, or when it stays within
/// the cell it already stands in: one caught by cells that just closed under
/// it (a trench dug deep, spec 35 §5b) must be able to roll out.
fn may_enter(nav: &MapGrid, from: FxVec2, next: FxVec2) -> bool {
    nav.is_passable(cell_of(next)) || cell_of(next) == cell_of(from)
}

/// Wheels turn only while moving: `max(turn_step / 4, turn_step × min(speed,
/// minTurnSpeed) / minTurnSpeed)` (spec 11 §5.2; Generals `Locomotor.cpp:1461-1468`).
fn wheel_turn_step(motion: &Motion, speed: Fx) -> i32 {
    let min_turn = motion.min_turn_speed.raw().max(1);
    let scaled = i64::from(motion.turn_step) * i64::from(speed.min(motion.min_turn_speed).raw())
        / i64::from(min_turn);
    (motion.turn_step / 4).max(scaled as i32)
}

/// Decelerates a unit whose order ended this tick and keeps it coasting along its
/// heading (spec 11 §5.2, last paragraph), with the same passability check.
pub(crate) fn coast(unit: &mut Entity, motion: &Motion, nav: &MapGrid) {
    if unit.speed == Fx::ZERO {
        return;
    }
    if !matches!(motion.kind, LocoKind::Tracks | LocoKind::Wheels) {
        unit.speed = Fx::ZERO;
        return;
    }
    unit.speed = if unit.speed > motion.braking {
        unit.speed - motion.braking
    } else {
        Fx::ZERO
    };
    let heading = unit.heading.dir();
    let next = if unit.reversing {
        unit.pos - heading.scale(unit.speed)
    } else {
        unit.pos + heading.scale(unit.speed)
    };
    if may_enter(nav, unit.pos, next) {
        unit.pos = next;
    } else {
        unit.speed = Fx::ZERO;
    }
}
