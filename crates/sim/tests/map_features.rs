//! Spec 26 Phase 1: terrain layers and feature footprints on the nav grid.

use sim::fixed::{Fx, FxVec2};
use sim::map::{Cell, WATER_DEEP, WATER_SHALLOW, cell_of};
use sim::rules::{FeatureBlocks, Ruleset};
use sim::world::{Command, Order, World};

fn c(x: i32, y: i32) -> Cell {
    Cell { x, y }
}

/// The centre of cell `(x, y)`.
fn centre(x: i32, y: i32) -> FxVec2 {
    let half = Fx::from_raw(32768);
    FxVec2::new(Fx::from_int(x) + half, Fx::from_int(y) + half)
}

#[test]
fn legacy_maps_have_no_layers_and_no_features() {
    let rules = Ruleset::builtin();
    for id in ["first-line", "showcase"] {
        let map = rules.map(id).unwrap();
        assert!(map.ground.is_empty() && map.roads.is_empty() && map.water.is_empty());
        assert!(map.features.is_empty());
        let world = World::skirmish(rules.clone(), id, 1).unwrap();
        let terrain = world.terrain();
        for y in 0..i32::from(map.height) {
            for x in 0..i32::from(map.width) {
                assert_eq!(terrain.water_at(c(x, y)), 0);
                assert_eq!(terrain.road_at(c(x, y)), 0);
                assert_eq!(terrain.ground_at(c(x, y)), 0);
            }
        }
    }
}

#[test]
fn deep_water_and_solid_footprints_block_shallows_and_roads_do_not() {
    let rules = Ruleset::builtin();
    let world = World::skirmish(rules.clone(), "landscape-lab", 1).unwrap();
    let terrain = world.terrain();
    let map = rules.map("landscape-lab").unwrap();

    let mut deep = 0;
    let mut shallow = 0;
    let mut roads = 0;
    for y in 0..i32::from(map.height) {
        for x in 0..i32::from(map.width) {
            let cell = c(x, y);
            match terrain.water_depth_at(cell) {
                WATER_DEEP => {
                    deep += 1;
                    assert!(!terrain.is_passable(cell), "deep water at {cell:?}");
                }
                WATER_SHALLOW => {
                    shallow += 1;
                    assert!(terrain.is_passable(cell), "shallow water at {cell:?}");
                }
                _ => {}
            }
            if terrain.road_at(cell) != 0 {
                roads += 1;
                assert!(terrain.is_passable(cell) || terrain.water_depth_at(cell) != 0);
            }
        }
    }
    assert!(deep > 100 && shallow > 20 && roads > 20);

    // Every footprint of a solid feature is blocked; the instance list is in
    // row order (the data compiler sorts it).
    assert!(map.features.len() > 20);
    let mut last = (0, 0);
    for f in &map.features {
        assert!(
            (f.y, f.x) >= last,
            "features are sorted by row, then column"
        );
        last = (f.y, f.x);
        let def = &rules.feature_types[f.kind as usize];
        assert_ne!(def.blocks, FeatureBlocks::None);
        let (w, h) = if f.rot % 2 == 1 {
            (def.footprint[1], def.footprint[0])
        } else {
            (def.footprint[0], def.footprint[1])
        };
        for y in f.y..f.y + h {
            for x in f.x..f.x + w {
                assert!(!terrain.is_passable(c(x, y)), "{} at {x},{y}", def.id);
            }
        }
    }
    // The 2x2 house at (38, 38) covers four cells.
    for (x, y) in [(38, 38), (39, 38), (38, 39), (39, 39)] {
        assert!(!terrain.is_passable(c(x, y)));
    }
}

#[test]
fn a_unit_crosses_the_river_by_the_ford() {
    let rules = Ruleset::builtin();
    let mut world = World::skirmish(rules, "landscape-lab", 1).unwrap();
    let id = world.spawn_unit_at(centre(24, 35));
    let target = centre(38, 35);
    world.enqueue(Command::Move {
        units: vec![id],
        target,
    });
    for _ in 0..4000 {
        world.step();
        let unit = world.unit(id).unwrap();
        assert!(
            world.terrain().water_depth_at(cell_of(unit.pos)) != WATER_DEEP,
            "stepped into deep water"
        );
        if matches!(unit.order, Order::Idle { .. }) {
            break;
        }
    }
    assert_eq!(cell_of(world.unit(id).unwrap().pos), cell_of(target));
}
