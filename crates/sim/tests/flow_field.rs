use sim::fixed::Fx;
use sim::flow::{Dir8, FlowField, UNREACHABLE, can_step};
use sim::map::{Cell, MapGrid};

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
}
