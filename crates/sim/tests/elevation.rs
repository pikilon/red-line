//! Spec 30: terrain elevation, cliffs and ground height.

use sim::fixed::{Fx, FxVec2};
use sim::map::{Cell, MapGrid, cell_of};
use sim::rules::Ruleset;
use sim::world::{Command, Order, World};

fn c(x: i32, y: i32) -> Cell {
    Cell { x, y }
}

/// A position in quarter tiles.
fn quarters(x: i32, y: i32) -> FxVec2 {
    FxVec2::new(Fx::from_raw(x * 16384), Fx::from_raw(y * 16384))
}

/// A `size x size` grid whose corners all sit at `height(x, y)`.
fn grid(size: u16, height: impl Fn(i32, i32) -> u8) -> MapGrid {
    let mut map = MapGrid::open(size, size);
    let mut heights = Vec::new();
    for y in 0..=i32::from(size) {
        for x in 0..=i32::from(size) {
            heights.push(height(x, y));
        }
    }
    map.set_heights(heights);
    map
}

#[test]
fn ac_30_01_ground_height_follows_the_cell_triangles() {
    // One cell: corners (0,0)=0, (1,0)=16, (0,1)=32, (1,1)=48 steps.
    let map = grid(1, |x, y| (x * 16 + y * 32) as u8);
    let at = |x: i32, y: i32| map.ground_height(quarters(x, y)).raw();
    assert_eq!(at(0, 0), 0);
    assert_eq!(at(4, 0), 65536); // 16 steps = 1 tile
    assert_eq!(at(0, 4), 2 * 65536);
    assert_eq!(at(4, 4), 3 * 65536);
    // A plane stays a plane on both sides of the diagonal.
    assert_eq!(at(2, 1), 32768 + 32768);
    assert_eq!(at(1, 2), 16384 + 65536);
    // Off the map it clamps to the edge.
    assert_eq!(at(-12, 0), 0);
    assert_eq!(at(36, 36), 3 * 65536);
}

#[test]
fn ac_30_02_diagonal_split_matches_zero_hour() {
    // Only (1,1) is raised: the lower-right triangle rises, the upper-left one
    // too, both through the shared diagonal.
    let map = grid(1, |x, y| if x == 1 && y == 1 { 32 } else { 0 });
    // On the (0,0)-(1,1) diagonal the height is half of 2 tiles.
    assert_eq!(map.ground_height(quarters(2, 2)).raw(), 65536);
    // Below the diagonal (fx > fy): h = 32 * fy steps.
    assert_eq!(map.ground_height(quarters(3, 1)).raw(), 32768);
    // Above it (fy > fx): h = 32 * fx steps.
    assert_eq!(map.ground_height(quarters(1, 3)).raw(), 32768);
}

#[test]
fn ac_30_03_flat_maps_have_no_height() {
    let map = MapGrid::open(8, 8);
    assert!(map.heights().is_empty());
    assert_eq!(map.ground_height(quarters(14, 10)), Fx::ZERO);
    assert!(!map.is_cliff(c(3, 3)));
}

#[test]
fn ac_30_04_steep_cells_are_cliffs_and_block() {
    // A plateau 2 tiles high (32 steps) over corners x >= 8 with a sheer edge,
    // and a gentle ramp of 8 steps per cell elsewhere.
    let map = grid(16, |x, y| {
        if x >= 8 {
            32
        } else if y >= 12 {
            (x * 4) as u8
        } else {
            0
        }
    });
    for y in 0..12 {
        assert!(map.is_cliff(c(7, y)), "edge cell (7,{y}) is a cliff");
        assert!(!map.is_passable(c(7, y)));
    }
    // 15 steps of spread is not a cliff; 16 is.
    let shallow = grid(2, |x, _| if x >= 1 { 15 } else { 0 });
    assert!(!shallow.is_cliff(c(0, 0)));
    let steep = grid(2, |x, _| if x >= 1 { 16 } else { 0 });
    assert!(steep.is_cliff(c(0, 0)));
    // The plateau top and the ramp stay passable.
    assert!(map.is_passable(c(10, 4)));
    assert!(map.is_passable(c(3, 13)));
    assert!(!map.is_cliff(c(6, 13)));
}

#[test]
fn ac_30_05_units_never_cross_a_cliff() {
    // Plateau over x >= 16 except a gentle ramp in rows 26..=29.
    let mut world = World::new(grid(32, |x, y| {
        if (26..=30).contains(&y) {
            (x.min(16) * 2) as u8
        } else if x >= 16 {
            32
        } else {
            0
        }
    }));
    let id = world.spawn_unit_at(quarters(34, 18));
    let target = quarters(98, 18);
    world.enqueue(Command::Move {
        units: vec![id],
        target,
    });
    let mut used_ramp = false;
    for _ in 0..3000 {
        world.step();
        let unit = world.unit(id).unwrap();
        let cell = cell_of(unit.pos);
        assert!(
            !world.terrain().is_cliff(cell),
            "unit stepped on cliff {cell:?}"
        );
        if (26..=29).contains(&cell.y) && cell.x == 16 {
            used_ramp = true;
        }
        if matches!(unit.order, Order::Idle { .. }) {
            break;
        }
    }
    let unit = world.unit(id).unwrap();
    assert!(used_ramp, "the unit climbed by the ramp");
    assert_eq!(cell_of(unit.pos), cell_of(target));
    // It stands on the plateau: 32 steps = 2 tiles up.
    assert_eq!(world.ground_height(unit.pos), Fx::from_int(2));
}

#[test]
fn ac_30_06_first_line_has_hills_and_cliffs() {
    let rules = Ruleset::builtin();
    let map = rules.map("first-line").unwrap();
    let heights = map.corner_heights();
    assert_eq!(heights.len(), 129 * 129);
    let world = World::skirmish(rules.clone(), "first-line", 1).unwrap();
    let terrain = world.terrain();
    let cliffs = (0..128)
        .flat_map(|y| (0..128).map(move |x| c(x, y)))
        .filter(|&cell| terrain.is_cliff(cell))
        .count();
    assert!(cliffs > 40, "first-line has cliffs ({cliffs})");
    assert!(
        heights.iter().any(|&h| h >= 32),
        "first-line has high ground"
    );
    // Starts stay on open ground.
    for start in &map.starts {
        let hq = c(start.hq[0], start.hq[1]);
        assert!(!terrain.is_cliff(hq));
    }
}
