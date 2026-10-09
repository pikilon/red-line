use sim::map::{Cell, MapGrid};

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
}
