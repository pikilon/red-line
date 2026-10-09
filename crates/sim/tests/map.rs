use sim::map::{Cell, MapGrid};

fn c(x: i32, y: i32) -> Cell {
    Cell { x, y }
}

#[test]
fn ac_02_05_tech_slice_layout() {
    let map = MapGrid::tech_slice();
    assert_eq!(map.width(), 128);
    assert_eq!(map.height(), 128);
    for (x, y) in [(0, 0), (127, 5), (61, 30), (33, 33), (95, 90)] {
        assert!(!map.is_passable(c(x, y)), "({x},{y}) should be blocked");
    }
    for (x, y) in [(61, 63), (20, 20), (100, 20), (64, 64)] {
        assert!(map.is_passable(c(x, y)), "({x},{y}) should be passable");
    }
    let tiles = map.tiles();
    assert_eq!(tiles.len(), 16384);
    assert_eq!(tiles[0], 1);
    assert_eq!(tiles[20 * 128 + 20], 0);
    assert!(!map.is_passable(c(-1, 0)));
    assert!(!map.is_passable(c(128, 0)));
}
