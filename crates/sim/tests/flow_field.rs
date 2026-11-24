use sim::fixed::Fx;
use sim::fixed::FxVec2;
use sim::flow::{Dir8, FlowField, UNREACHABLE, can_step};
use sim::map::{Cell, MapGrid};
use sim::world::{Command, World};

fn c(x: i32, y: i32) -> Cell {
    Cell { x, y }
}

#[test]
fn ac_02_08_integration_field_open_map() {
    let map = MapGrid::open(8, 8);
    let field = FlowField::compute(&map, c(0, 0));
    assert_eq!(field.goal(), c(0, 0));
    assert_eq!(field.integration(c(0, 0)), 0);
    assert_eq!(field.integration(c(3, 0)), 30);
    assert_eq!(field.integration(c(3, 1)), 34);
    assert_eq!(field.integration(c(3, 3)), 42);
    assert_eq!(field.integration(c(7, 7)), 98);
}

#[test]
fn ac_02_09_direction_field_open_map() {
    let map = MapGrid::open(8, 8);
    let field = FlowField::compute(&map, c(0, 0));
    assert_eq!(field.direction(c(3, 3)), Some(Dir8::NW));
    assert_eq!(field.direction(c(3, 0)), Some(Dir8::W));
    assert_eq!(field.direction(c(0, 3)), Some(Dir8::N));
    assert_eq!(field.direction(c(0, 0)), None);
    let ne = Dir8::NE.unit_vector();
    assert_eq!(ne.x, Fx::from_raw(46341));
    assert_eq!(ne.y, Fx::from_raw(-46341));
}

#[test]
fn ac_02_10_no_corner_cutting() {
    let mut map = MapGrid::open(3, 3);
    map.set_blocked(c(1, 0), true);
    let field = FlowField::compute(&map, c(2, 0));
    assert_eq!(field.integration(c(0, 0)), 40);
    assert_eq!(field.direction(c(0, 0)), Some(Dir8::S));
    assert_eq!(field.direction(c(1, 1)), Some(Dir8::E));
    assert!(!can_step(&map, c(1, 1), Dir8::NE));
}

// Only the flow-field part of AC-02-11 exists yet (P1-04, #13); the
// `World::new` assertions (unit ordered to an unreachable goal stays idle) are
// appended to this test by the world issue (P1-05, #14).
#[test]
fn ac_02_11_unreachable_cells() {
    let mut map = MapGrid::open(5, 5);
    for y in 0..5 {
        map.set_blocked(c(2, y), true);
    }
    let field = FlowField::compute(&map, c(4, 2));
    assert_eq!(field.integration(c(0, 0)), UNREACHABLE);
    assert_eq!(field.direction(c(0, 0)), None);

    // Spec 04 §5.2: the unit walks to the reachable cell closest to the goal.
    let mut world = World::new(map);
    let start = FxVec2::new(Fx::from_raw(32768), Fx::from_raw(32768));
    let id = world.spawn_unit_at(start);
    world.enqueue(Command::Move {
        units: vec![id],
        target: FxVec2::new(Fx::from_raw(294912), Fx::from_raw(163840)),
    });
    for _ in 0..600 {
        world.step();
    }
    let unit = world.unit(id).unwrap();
    assert_eq!(sim::map::cell_of(unit.pos), c(1, 2));
}

fn run_to(world: &mut World, id: sim::world::EntityId, x: i32, y: i32) -> Cell {
    world.enqueue(Command::Move {
        units: vec![id],
        target: sim::map::cell_center(c(x, y)),
    });
    for _ in 0..900 {
        world.step();
    }
    sim::map::cell_of(world.unit(id).unwrap().pos)
}

#[test]
fn unreachable_island_goal_goes_to_nearest_shore() {
    // Land 0..=9, a 3-wide moat at x=10..=12, an island at x>=13.
    let mut map = MapGrid::open(16, 7);
    for y in 0..7 {
        for x in 10..=12 {
            map.set_blocked(c(x, y), true);
        }
    }
    let mut world = World::new(map);
    let id = world.spawn_unit_at(sim::map::cell_center(c(1, 3)));
    // Goal on the island: ends on the near bank, on the goal's row.
    assert_eq!(run_to(&mut world, id, 14, 5), c(9, 5));
    // Goal in the water: the §5.1 ring snap picks the bank cell first.
    assert_eq!(run_to(&mut world, id, 11, 1), c(9, 0));
}

#[test]
fn reachable_goal_is_unchanged() {
    let mut map = MapGrid::open(16, 7);
    map.set_blocked(c(8, 3), true);
    let mut world = World::new(map);
    let id = world.spawn_unit_at(sim::map::cell_center(c(1, 3)));
    assert_eq!(run_to(&mut world, id, 12, 3), c(12, 3));
}

#[test]
fn closest_reachable_ties_break_by_row_then_column() {
    let mut map = MapGrid::open(5, 5);
    for y in 0..5 {
        map.set_blocked(c(2, y), true);
    }
    // Goal (4,2) is cut off; (1,2) is the unique closest.
    assert_eq!(
        sim::flow::closest_reachable(&map, c(0, 0), c(4, 2), |_| true),
        Some(c(1, 2))
    );
    // Blocked start: nothing.
    assert_eq!(
        sim::flow::closest_reachable(&map, c(2, 2), c(4, 2), |_| true),
        None
    );
}
