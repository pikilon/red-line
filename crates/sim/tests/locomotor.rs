//! AC-11-03..07, AC-11-16: hull locomotion (spec 11 §5.2).
//!
//! Committed by the spec phase. The implementer makes these pass without
//! changing them.

use sim::angle::{Angle, deg_to_units};
use sim::fixed::{Fx, FxVec2};
use sim::map::{Cell, MapGrid, cell_of};
use sim::rules::{LocoKind, Ruleset, TypeId};
use sim::world::{Command, Order, World};

/// Centre of tile `(x, y)` in world units.
fn centre(x: i32, y: i32) -> FxVec2 {
    FxVec2::new(
        Fx::from_raw(x * 65536 + 32768),
        Fx::from_raw(y * 65536 + 32768),
    )
}

fn sandbox(map: MapGrid) -> World {
    World::sandbox(Ruleset::builtin(), map, &[0])
}

fn kind(world: &World, id: &str) -> TypeId {
    world.rules().type_index(id).expect("builtin type exists")
}

/// `cross(a, b)` of two fixed vectors in raw units squared, widened to i64.
fn cross(a: FxVec2, b: FxVec2) -> i64 {
    i64::from(a.x.raw()) * i64::from(b.y.raw()) - i64::from(a.y.raw()) * i64::from(b.x.raw())
}

fn dot(a: FxVec2, b: FxVec2) -> i64 {
    i64::from(a.x.raw()) * i64::from(b.x.raw()) + i64::from(a.y.raw()) * i64::from(b.y.raw())
}

/// A displacement parallel to `dir` within one raw unit per axis after the
/// `× 65536` scale of the cross product.
fn parallel_to(displacement: FxVec2, dir: FxVec2) -> bool {
    cross(displacement, dir).abs() <= 2 * 65536
}

#[test]
fn ac_11_03_tracked_pivot() {
    let mut world = sandbox(MapGrid::open(40, 40));
    let bradley = kind(&world, "ua-bradley");
    let motion = world.rules().ty(bradley).motion;
    assert_eq!(motion.kind, LocoKind::Tracks);
    let id = world.spawn(0, bradley, centre(20, 20));
    // Straight behind a unit facing Angle(0): heading error 180°. Five tiles is beyond
    // reverse_max (3 tiles, spec 11 §4.1), so the unit pivots instead of reversing.
    world.enqueue(Command::Move {
        units: vec![id],
        target: centre(20, 15),
    });

    let mut pivot_ticks = 0;
    loop {
        let before = world.unit(id).unwrap().clone();
        world.step();
        let after = world.unit(id).unwrap().clone();
        let error = after.heading.delta(Angle(32768)).abs();
        if error < deg_to_units(45) {
            break;
        }
        // While the error is 45° or more the tracks turn in place at full rate.
        assert_eq!(
            after.pos, before.pos,
            "a tracked unit does not move while pivoting"
        );
        assert_eq!(after.speed, Fx::ZERO);
        assert_eq!(
            after.heading.0.wrapping_sub(before.heading.0),
            motion.turn_step as u16,
            "the heading changes by exactly turn_step per tick"
        );
        pivot_ticks += 1;
    }
    assert!(
        pivot_ticks >= 9,
        "(180° − 45°) / turn_step is about 9 ticks, got {pivot_ticks}"
    );

    // Afterwards the unit moves only along its heading.
    let mut moved = 0;
    for _ in 0..200 {
        if matches!(world.unit(id).unwrap().order, Order::Idle { .. }) {
            break;
        }
        let before = world.unit(id).unwrap().pos;
        world.step();
        let after = world.unit(id).unwrap().clone();
        let displacement = after.pos - before;
        if displacement != FxVec2::ZERO {
            moved += 1;
            let dir = after.heading.dir();
            assert!(
                parallel_to(displacement, dir),
                "displacement {displacement:?} is not along the heading"
            );
            assert!(dot(displacement, dir) > 0, "the unit drives forward");
        }
    }
    assert!(moved > 0, "the unit drove after the pivot");
}

#[test]
fn ac_11_04_tracked_slowdown_and_acceleration() {
    let mut world = sandbox(MapGrid::open(40, 40));
    let bradley = kind(&world, "ua-bradley");
    let motion = world.rules().ty(bradley).motion;
    let id = world.spawn(0, bradley, centre(20, 20));
    // Straight ahead: no heading error, so the speed rises by accel per tick.
    world.enqueue(Command::Move {
        units: vec![id],
        target: centre(20, 35),
    });
    world.step();
    assert_eq!(world.unit(id).unwrap().speed, motion.accel);
    world.step();
    assert_eq!(
        world.unit(id).unwrap().speed,
        Fx::from_raw(motion.accel.raw() * 2)
    );
    for _ in 0..40 {
        let before = world.unit(id).unwrap().speed;
        world.step();
        let after = world.unit(id).unwrap().speed;
        assert!(after <= motion.max_speed, "speed never exceeds max_speed");
        if before < motion.max_speed {
            assert_eq!(
                after.raw(),
                (before + motion.accel).raw().min(motion.max_speed.raw()),
                "speed rises by accel per tick up to max_speed"
            );
        }
    }
}

#[test]
fn ac_11_04_tracked_speed_target_from_heading_error() {
    // Target 90° to the right: the tracks pivot first, then drive while the error is
    // below pivot, with speed target max_speed × (pivot − e) / pivot.
    let mut world = sandbox(MapGrid::open(40, 40));
    let bradley = kind(&world, "ua-bradley");
    let motion = world.rules().ty(bradley).motion;
    let id = world.spawn(0, bradley, centre(20, 20));
    world.enqueue(Command::Move {
        units: vec![id],
        target: centre(30, 20),
    });
    let east = Angle(16384);
    let mut peak = Fx::ZERO;
    for _ in 0..200 {
        world.step();
        let unit = world.unit(id).unwrap();
        peak = peak.max(unit.speed);
        let error = unit.heading.delta(east).abs();
        if error < motion.pivot {
            let target = (i64::from(motion.max_speed.raw()) * i64::from(motion.pivot - error)
                / i64::from(motion.pivot)) as i32;
            assert!(
                unit.speed.raw() <= target + motion.accel.raw(),
                "speed {} exceeds the target {target} for error {error}",
                unit.speed.raw()
            );
        } else {
            assert_eq!(
                unit.speed,
                Fx::ZERO,
                "no speed while the error is at least pivot"
            );
        }
    }
    assert_eq!(
        peak, motion.max_speed,
        "the unit drives at max_speed once aligned"
    );
}

#[test]
fn ac_11_05_wheeled_turning_arc() {
    let mut world = sandbox(MapGrid::open(40, 40));
    let truck = kind(&world, "ua-supply-truck");
    let motion = world.rules().ty(truck).motion;
    assert_eq!(motion.kind, LocoKind::Wheels);
    let id = world.spawn(0, truck, centre(20, 20));
    // 90° to the right of a unit facing Angle(0).
    world.enqueue(Command::Move {
        units: vec![id],
        target: centre(25, 20),
    });
    let east = Angle(16384);

    world.step();
    let first = world.unit(id).unwrap().clone();
    assert_eq!(
        first.heading.0,
        (motion.turn_step / 4) as u16,
        "stopped wheels turn by turn_step / 4 on the first tick"
    );

    for _ in 0..300 {
        let before = world.unit(id).unwrap().pos;
        let speed_before = world.unit(id).unwrap().speed;
        world.step();
        let unit = world.unit(id).unwrap().clone();
        let displacement = unit.pos - before;
        if displacement != FxVec2::ZERO {
            assert!(
                parallel_to(displacement, unit.heading.dir()),
                "no sideways slide"
            );
        }
        if unit.heading.delta(east).abs() > deg_to_units(9) && unit.speed > motion.min_turn_speed {
            // Above min_turn_speed only while braking down to it (spec 11 §5.2 step 4).
            assert!(
                unit.speed < speed_before,
                "speed {} rises above min_turn_speed while the error is above slow_turn",
                unit.speed.raw()
            );
            assert!(
                speed_before.raw() - unit.speed.raw() <= motion.braking.raw(),
                "speed falls at most braking per tick"
            );
        }
        if matches!(unit.order, Order::Idle { .. }) {
            break;
        }
    }
    assert_eq!(
        world.unit(id).unwrap().pos,
        centre(25, 20),
        "the truck reaches the goal"
    );
}

#[test]
fn ac_11_06_braking_and_arrival() {
    for id_name in ["ua-bradley", "ua-supply-truck"] {
        let mut world = sandbox(MapGrid::open(40, 40));
        let type_id = kind(&world, id_name);
        let motion = world.rules().ty(type_id).motion;
        let id = world.spawn(0, type_id, centre(20, 20));
        let target = centre(20, 30);
        world.enqueue(Command::Move {
            units: vec![id],
            target,
        });
        let path_ticks = 10 * 65536 / motion.max_speed.raw() as u32 + 30;
        let mut ticks = 0;
        let mut peak = Fx::ZERO;
        let mut previous = Fx::ZERO;
        let mut entered = false;
        loop {
            world.step();
            ticks += 1;
            let unit = world.unit(id).unwrap().clone();
            peak = peak.max(unit.speed);
            let in_goal =
                cell_of(unit.pos) == cell_of(target) && !matches!(unit.order, Order::Idle { .. });
            if in_goal && !entered {
                // Braking uses the straight-line distance in every cell, so the unit
                // enters the goal cell at most `braking` above the bound.
                entered = true;
                let remaining = (target - unit.pos).length();
                let twice = motion.braking.mul(remaining) + motion.braking.mul(remaining);
                let bound = motion.accel.max(twice.sqrt());
                assert!(
                    unit.speed.raw() <= bound.raw() + motion.braking.raw(),
                    "{id_name}: enters the goal cell at speed {}, above the braking bound {}",
                    unit.speed.raw(),
                    bound.raw()
                );
            }
            if in_goal && previous != Fx::ZERO {
                // Afterwards the speed only falls towards the bound, at most braking per tick.
                assert!(
                    unit.speed.raw() >= previous.raw() - motion.braking.raw(),
                    "{id_name}: speed falls at most braking per tick"
                );
            }
            previous = unit.speed;
            if matches!(unit.order, Order::Idle { .. }) {
                assert_eq!(unit.pos, target, "{id_name}: ends exactly on the goal");
                assert_eq!(unit.speed, Fx::ZERO, "{id_name}: stopped on arrival");
                assert_eq!(
                    peak, motion.max_speed,
                    "{id_name}: the approach reaches max_speed before braking"
                );
                break;
            }
            assert!(
                ticks <= path_ticks,
                "{id_name}: arrives within the tick bound"
            );
        }
    }
}

#[test]
fn ac_11_07_moves_where_it_faces_near_walls() {
    // A wall across the north path of a truck at (20, 18): x 15..=25 at y = 21.
    let mut map = MapGrid::open(40, 40);
    for x in 15..=25 {
        map.set_blocked(Cell { x, y: 21 }, true);
    }
    let mut world = sandbox(map);
    let truck = kind(&world, "ua-supply-truck");
    let id = world.spawn(0, truck, centre(20, 18));
    let goal = centre(20, 24);
    world.enqueue(Command::Move {
        units: vec![id],
        target: goal,
    });
    let mut turned = false;
    for _ in 0..600 {
        world.step();
        let unit = world.unit(id).unwrap();
        turned |= unit.heading != Angle(0);
        assert!(
            world.map().is_passable(cell_of(unit.pos)),
            "the truck never enters a blocked cell"
        );
        if matches!(unit.order, Order::Idle { .. }) {
            break;
        }
    }
    let unit = world.unit(id).unwrap();
    assert_eq!(
        cell_of(unit.pos),
        cell_of(goal),
        "the truck reaches the goal around the wall"
    );
    assert!(
        matches!(unit.order, Order::Idle { .. }),
        "the truck arrives within 600 ticks"
    );
    assert!(turned, "the truck turns its hull to go around the wall");
}

#[test]
fn ac_11_16_short_reverse() {
    for id_name in ["ua-supply-truck", "ua-bradley"] {
        // Two tiles behind: reverse. Five tiles behind: no reverse.
        let mut world = sandbox(MapGrid::open(40, 40));
        let type_id = kind(&world, id_name);
        let motion = world.rules().ty(type_id).motion;
        let id = world.spawn(0, type_id, centre(20, 20));
        world.enqueue(Command::Move {
            units: vec![id],
            target: centre(20, 18),
        });
        world.step();
        assert!(
            world.unit(id).unwrap().reversing,
            "{id_name}: reverses for a 2-tile back move"
        );
        let mut ticks = 0;
        loop {
            let before = world.unit(id).unwrap().pos;
            world.step();
            ticks += 1;
            let unit = world.unit(id).unwrap().clone();
            let displacement = unit.pos - before;
            if displacement != FxVec2::ZERO {
                let dir = unit.heading.dir();
                assert!(
                    parallel_to(displacement, dir),
                    "{id_name}: drives along its hull axis"
                );
                assert!(
                    dot(displacement, dir) < 0,
                    "{id_name}: the rear faces the goal"
                );
            }
            assert!(
                unit.speed <= motion.reverse_speed,
                "{id_name}: speed within reverse_speed"
            );
            if matches!(unit.order, Order::Idle { .. }) || ticks > 600 {
                break;
            }
        }
        let unit = world.unit(id).unwrap();
        assert!(!unit.reversing, "{id_name}: reversing clears on arrival");
        assert!(
            unit.heading.delta(Angle(0)).abs() <= deg_to_units(10),
            "{id_name}: heading within 10° of Angle(0)"
        );

        let mut world = sandbox(MapGrid::open(40, 40));
        let id = world.spawn(0, type_id, centre(20, 20));
        world.enqueue(Command::Move {
            units: vec![id],
            target: centre(20, 15),
        });
        world.step();
        assert!(
            !world.unit(id).unwrap().reversing,
            "{id_name}: no reverse for a 5-tile back move"
        );
    }
}
