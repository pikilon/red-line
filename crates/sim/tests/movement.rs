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
        let unit = *world.unit(id).unwrap();
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
