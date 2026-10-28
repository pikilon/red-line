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
                    assert!(
                        terrain.bridge_at(cell) != 0 || !terrain.is_passable(cell),
                        "deep water at {cell:?}"
                    );
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
        if def.family == "bridge" {
            continue; // a deck is walkable (see the bridge tests below)
        }
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

/// Spec 26 section 17: deck cells open over deep water, nothing else does.
#[test]
fn bridge_decks_are_passable_over_deep_water_and_the_rest_of_the_river_is_not() {
    let rules = Ruleset::builtin();
    let map = rules.map("demo-bridges").unwrap();
    let world = World::skirmish(rules.clone(), "demo-bridges", 1).unwrap();
    let terrain = world.terrain();
    let (mut deck_over_deep, mut deep_without_deck) = (0, 0);
    for y in 0..i32::from(map.height) {
        for x in 0..i32::from(map.width) {
            let cell = c(x, y);
            if terrain.water_depth_at(cell) != WATER_DEEP {
                continue;
            }
            if terrain.bridge_at(cell) != 0 {
                deck_over_deep += 1;
                assert!(
                    terrain.is_passable(cell),
                    "deck over deep water at {cell:?}"
                );
            } else {
                deep_without_deck += 1;
                assert!(!terrain.is_passable(cell), "open deep water at {cell:?}");
            }
        }
    }
    // Three decks of 4 deep columns: 2 + 2 + 2 lanes.
    assert_eq!(deck_over_deep, 4 * (2 + 2 + 2));
    assert!(deep_without_deck > 100);
}

/// Orders `unit` to `target` and returns every cell it entered; panics if it
/// does not arrive.
fn walk(world: &mut World, unit: u32, target: FxVec2) -> Vec<Cell> {
    world.enqueue(Command::Move {
        units: vec![unit],
        target,
    });
    let mut cells = Vec::new();
    for _ in 0..6000 {
        world.step();
        let u = world.unit(unit).unwrap();
        cells.push(cell_of(u.pos));
        if matches!(u.order, Order::Idle { .. }) {
            break;
        }
    }
    assert_eq!(cell_of(world.unit(unit).unwrap().pos), cell_of(target));
    cells
}

#[test]
fn a_unit_crosses_the_deep_river_only_by_a_bridge() {
    let rules = Ruleset::builtin();
    let mut world = World::skirmish(rules, "demo-bridges", 1).unwrap();
    // West bank to east bank at the row of the one-lane wooden bridge.
    let id = world.spawn_unit_at(centre(22, 24));
    let cells = walk(&mut world, id, centre(42, 24));
    let in_deep: Vec<_> = cells
        .iter()
        .filter(|&&cell| world.terrain().water_depth_at(cell) == WATER_DEEP)
        .collect();
    assert!(!in_deep.is_empty(), "the unit must cross the deep river");
    for cell in in_deep {
        assert_ne!(
            world.terrain().bridge_at(*cell),
            0,
            "left the deck at {cell:?}"
        );
    }

    // Starting on the south road it still has to find a deck: nothing else is open.
    let id = world.spawn_unit_at(centre(22, 30));
    let cells = walk(&mut world, id, centre(42, 30));
    assert!(cells.iter().all(|&cell| {
        world.terrain().water_depth_at(cell) != WATER_DEEP || world.terrain().bridge_at(cell) != 0
    }));
}

#[test]
fn legacy_and_bridgeless_maps_have_no_deck_layer() {
    let rules = Ruleset::builtin();
    for id in ["first-line", "demo-forest", "demo-ground"] {
        assert!(rules.map(id).unwrap().bridges.is_empty());
        let world = World::skirmish(rules.clone(), id, 1).unwrap();
        assert_eq!(world.terrain().bridge_at(c(5, 5)), 0);
    }
}

/// A unit driving the road line over the two-lane wooden bridge stays on the
/// deck centre: the road runs on the boundary between rows 23 and 24, so the
/// deck must be those two rows.
#[test]
fn a_unit_crosses_the_wooden_bridge_along_its_centre() {
    let rules = Ruleset::builtin();
    let mut world = World::skirmish(rules, "demo-bridges", 1).unwrap();
    let road = FxVec2::new(Fx::from_int(22), Fx::from_int(24));
    let id = world.spawn_unit_at(road);
    world.enqueue(Command::Move {
        units: vec![id],
        target: FxVec2::new(Fx::from_int(42), Fx::from_int(24)),
    });
    let mut on_deck = 0;
    for _ in 0..6000 {
        world.step();
        let u = world.unit(id).unwrap();
        if world.terrain().water_depth_at(cell_of(u.pos)) == WATER_DEEP {
            on_deck += 1;
            let y = f64::from(u.pos.y.raw()) / 65536.0;
            assert!((23.6..24.4).contains(&y), "off the deck centre: y = {y}");
        }
        if matches!(u.order, Order::Idle { .. }) {
            break;
        }
    }
    assert!(on_deck > 10);
}
