//! AC-36-03..04: amphibious vehicles cross deep water; other vehicles cannot (spec 36).

use sim::fixed::{Fx, FxVec2};
use sim::hash::state_hash;
use sim::map::{MapGrid, WATER_DEEP, cell_of};
use sim::rules::Ruleset;
use sim::save::{load_state, save_state};
use sim::world::{Command, World};

fn centre(x: i32, y: i32) -> FxVec2 {
    FxVec2::new(
        Fx::from_raw(x * 65536 + 32768),
        Fx::from_raw(y * 65536 + 32768),
    )
}

/// Drives `vehicle` (player 1) across the demo-bridges river, between its
/// bridges; returns whether it ever stood on deep water and the ticks it took.
fn cross(vehicle: &str) -> (bool, u32, World) {
    let mut world = World::skirmish(Ruleset::builtin(), "demo-bridges", 1).unwrap();
    let kind = world.rules().type_index(vehicle).unwrap();
    let unit = world.spawn(1, kind, centre(22, 16));
    world.enqueue_as(
        1,
        Command::Move {
            units: vec![unit],
            target: centre(42, 16),
        },
    );
    let water = map_water(&world);
    let mut wet = false;
    for tick in 0..3000 {
        world.step();
        let pos = world.entity(unit).unwrap().pos;
        // Deep water off the bridge decks.
        wet |= water.water_depth_at(cell_of(pos)) == WATER_DEEP
            && world.repair_job_at(cell_of(pos)).is_none();
        if cell_of(pos) == cell_of(centre(42, 16)) {
            return (wet, tick, world);
        }
    }
    (wet, 3000, world)
}

fn map_water(world: &World) -> MapGrid {
    world.terrain().clone()
}

#[test]
fn ac_36_03_an_amphibious_vehicle_swims_across_and_a_tank_takes_a_bridge() {
    assert!(
        Ruleset::builtin()
            .ty(Ruleset::builtin().type_index("ru-bmp-2").unwrap())
            .amphibious
    );
    let (bmp_wet, bmp_ticks, _) = cross("ru-bmp-2");
    let (tank_wet, tank_ticks, _) = cross("ru-t-72b3");
    assert!(bmp_wet, "the BMP-2 swims");
    assert!(!tank_wet, "the T-72 never enters deep water");
    assert!(bmp_ticks < 3000 && tank_ticks < 3000, "both arrive");
    assert!(
        bmp_ticks < tank_ticks,
        "swimming is the short way: {bmp_ticks} < {tank_ticks}"
    );
}

#[test]
fn ac_36_04_a_swimming_vehicle_survives_a_save() {
    let mut world = World::skirmish(Ruleset::builtin(), "demo-bridges", 1).unwrap();
    let kind = world.rules().type_index("ru-bmp-2").unwrap();
    let unit = world.spawn(1, kind, centre(22, 16));
    world.enqueue_as(
        1,
        Command::Move {
            units: vec![unit],
            target: centre(42, 16),
        },
    );
    for _ in 0..120 {
        world.step();
    }
    let saved = save_state(&world, 1, &[]).unwrap();
    let (mut loaded, _, _) = load_state(&saved).unwrap();
    assert_eq!(state_hash(&loaded), state_hash(&world));
    for _ in 0..300 {
        world.step();
        loaded.step();
    }
    assert_eq!(state_hash(&loaded), state_hash(&world));
}
