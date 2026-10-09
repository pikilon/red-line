use sim::fixed::{Fx, FxVec2};
use sim::map::{Cell, MapGrid, cell_of};
use sim::world::{Command, Order, World};

// Only the `nearest_passable` part of AC-02-12 exists yet (P1-03); the world
// order-remap assertions are added with the movement issue.
#[test]
fn ac_02_12_blocked_target_remap() {
    let map = MapGrid::tech_slice();
    assert_eq!(
        map.nearest_passable(Cell { x: 61, y: 30 }),
        Some(Cell { x: 59, y: 28 })
    );
    assert_eq!(
        map.nearest_passable(Cell { x: 20, y: 20 }),
        Some(Cell { x: 20, y: 20 })
    );

    let mut world = World::tech_slice(1, 1).unwrap();
    world.enqueue(Command::Move {
        units: vec![0],
        target: raw(4030464, 1998848),
    });
    world.step();
    let Order::Move { target, .. } = world.unit(0).unwrap().order else {
        panic!("unit 0 should have a move order");
    };
    assert_eq!(target, raw(3899392, 1867776));
}

fn raw(x: i32, y: i32) -> FxVec2 {
    FxVec2::new(Fx::from_raw(x), Fx::from_raw(y))
}

fn is_idle(order: Order) -> bool {
    matches!(order, Order::Idle { .. })
}

fn single_unit_open_world() -> World {
    let mut world = World::new(MapGrid::open(32, 32));
    let id = world.spawn_unit_at(raw(163840, 163840));
    world.enqueue(Command::Move {
        units: vec![id],
        target: raw(819200, 163840),
    });
    world
}

#[test]
fn ac_02_13_unit_moves_at_unit_speed() {
    let mut world = single_unit_open_world();
    world.step();
    assert_eq!(world.unit(0).unwrap().pos, raw(176947, 163840));
    assert_eq!(world.tick(), 1);
}

#[test]
fn ac_02_14_unit_arrives_exactly() {
    let mut world = single_unit_open_world();
    for _ in 0..60 {
        world.step();
    }
    let unit = world.unit(0).unwrap();
    assert_eq!(unit.pos, raw(819200, 163840));
    assert_eq!(unit.order, Order::Idle { last_order_id: 1 });
    assert_eq!(world.flow_field_count(), 0);
}

#[test]
fn ac_02_15_units_route_through_the_gap() {
    let mut world = World::new(MapGrid::tech_slice());
    let target = raw(6586368, 1343488);
    let id = world.spawn_unit_at(raw(1343488, 1343488));
    world.enqueue(Command::Move {
        units: vec![id],
        target,
    });
    let mut crossed_gap = false;
    let mut arrived = false;
    while world.tick() < 1500 {
        world.step();
        let unit = world.unit(id).unwrap().clone();
        let cell = cell_of(unit.pos);
        assert!(
            world.map().is_passable(cell),
            "tick {}: unit in blocked cell {cell:?}",
            world.tick()
        );
        crossed_gap |= (60..=63).contains(&cell.x) && (60..=67).contains(&cell.y);
        if is_idle(unit.order) {
            assert_eq!(unit.pos, target);
            arrived = true;
            break;
        }
    }
    assert!(arrived, "unit did not arrive before tick 1500");
    assert!(world.tick() < 1500);
    assert!(crossed_gap, "unit never passed through the wall gap");
}

#[test]
fn ac_02_18_flow_field_cache() {
    let mut world = World::tech_slice(1, 10).unwrap();
    world.enqueue(Command::Move {
        units: (0..5).collect(),
        target: raw(6569984, 1327104),
    });
    world.enqueue(Command::Move {
        units: (5..10).collect(),
        target: raw(6602752, 1359872),
    });
    world.step();
    assert_eq!(world.flow_field_count(), 1);
    assert_eq!(world.next_order_id(), 3);
    let mut steps = 1;
    while steps < 1500 && !world.units().iter().all(|u| is_idle(u.order)) {
        world.step();
        steps += 1;
    }
    assert!(world.units().iter().all(|u| is_idle(u.order)));
    assert_eq!(world.flow_field_count(), 0);
}

#[test]
fn ac_02_16_group_arrives_separated() {
    let mut world = World::new(MapGrid::open(64, 64));
    for y in 5..=14 {
        for x in 5..=14 {
            world.spawn_unit_at(raw((x << 16) + 32768, (y << 16) + 32768));
        }
    }
    let target = raw(2654208, 2654208);
    world.enqueue(Command::Move {
        units: (0..100).collect(),
        target,
    });
    for _ in 0..600 {
        world.step();
    }
    let units = world.units();
    assert_eq!(units.len(), 100);
    for unit in units {
        assert_eq!(
            unit.order,
            Order::Idle { last_order_id: 1 },
            "unit {} did not arrive",
            unit.id
        );
        assert!(
            (unit.pos - target).length() <= Fx::from_int(12),
            "unit {} is too far from the target: {:?}",
            unit.id,
            unit.pos
        );
    }
    for (i, a) in units.iter().enumerate() {
        for b in &units[i + 1..] {
            assert!(
                (a.pos - b.pos).length() >= Fx::from_raw(16384),
                "units {} and {} overlap: {:?} {:?}",
                a.id,
                b.id,
                a.pos,
                b.pos
            );
        }
    }
}

/// Fixture command: `(tick, unit_range_start, unit_range_end, target)`.
type ScriptCommand = (u32, u32, u32, FxVec2);

/// Reads `tests/fixtures/tech-slice-script.json` without a JSON dependency:
/// the fixture's integers appear in a fixed order (seed, units, ticks, then
/// tick, unitRange[0], unitRange[1], target[0], target[1] per command).
fn fixture_script() -> (u32, u32, u32, Vec<ScriptCommand>) {
    let text = include_str!("fixtures/tech-slice-script.json");
    let numbers: Vec<i64> = text
        .split(|c: char| !(c.is_ascii_digit() || c == '-'))
        .filter(|token| !token.is_empty())
        .map(|token| token.parse().unwrap())
        .collect();
    let (header, rest) = numbers.split_at(3);
    assert_eq!(rest.len() % 5, 0, "malformed fixture script");
    let commands = rest
        .chunks(5)
        .map(|c| {
            (
                c[0] as u32,
                c[1] as u32,
                c[2] as u32,
                raw(c[3] as i32, c[4] as i32),
            )
        })
        .collect();
    (
        header[0] as u32,
        header[1] as u32,
        header[2] as u32,
        commands,
    )
}

#[test]
fn ac_02_17_units_never_enter_blocked_cells() {
    let (seed, units, ticks, commands) = fixture_script();
    assert_eq!(commands.len(), 3);
    let mut world = World::tech_slice(u64::from(seed), units).unwrap();
    for t in 0..ticks {
        for &(tick, start, end, target) in &commands {
            if tick == t {
                world.enqueue(Command::Move {
                    units: (start..end).collect(),
                    target,
                });
            }
        }
        world.step();
        for unit in world.units() {
            let cell = cell_of(unit.pos);
            assert!(
                world.map().is_passable(cell),
                "tick {}: unit {} in blocked cell {cell:?}",
                world.tick(),
                unit.id
            );
        }
    }
}
