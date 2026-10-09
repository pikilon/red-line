use sim::map::{Cell, MapGrid, cell_center, cell_of};
use sim::world::{MAX_UNITS, Order, SimError, World};

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

#[test]
fn ac_02_06_tech_slice_spawn() {
    let world = World::tech_slice(7, 500).unwrap();
    assert_eq!(world.tick(), 0);
    let units = world.units();
    assert_eq!(units.len(), 500);
    for (i, unit) in units.iter().enumerate() {
        assert_eq!(unit.id, i as u32);
        assert_eq!(unit.order, Order::Idle { last_order_id: 0 });
        let center = cell_center(cell_of(unit.pos));
        assert!((unit.pos.x.raw() - center.x.raw()).abs() <= 16384);
        assert!((unit.pos.y.raw() - center.y.raw()).abs() <= 16384);
    }
    assert_eq!(cell_of(units[0].pos), c(4, 4));
    assert_eq!(cell_of(units[52].pos), c(56, 4));
    assert_eq!(cell_of(units[53].pos), c(4, 5));
    let again = World::tech_slice(7, 500).unwrap();
    assert_eq!(world.units(), again.units());
}

#[test]
fn ac_02_07_unit_cap() {
    assert_eq!(
        World::tech_slice(1, 2001).err(),
        Some(SimError::TooManyUnits {
            requested: 2001,
            max: 2000
        })
    );
    assert_eq!(MAX_UNITS, 2000);
    assert_eq!(World::tech_slice(1, 2000).unwrap().units().len(), 2000);
}
