//! AC-11-08, AC-11-09, AC-11-11: turret aim and fire gating (spec 11 §5.3).

use sim::angle::Angle;
use sim::fixed::{Fx, FxVec2};
use sim::map::MapGrid;
use sim::rules::Ruleset;
use sim::world::{Command, World};

fn centre(x: i32, y: i32) -> FxVec2 {
    FxVec2::new(
        Fx::from_raw(x * 65536 + 32768),
        Fx::from_raw(y * 65536 + 32768),
    )
}

fn world() -> World {
    World::sandbox(Ruleset::builtin(), MapGrid::open(40, 40), &[0, 1])
}

fn kind(world: &World, id: &str) -> u16 {
    world.rules().type_index(id).expect("builtin type exists")
}

#[test]
fn ac_11_09_moving_tank_turns_turret_to_target_without_hull() {
    let mut world = world();
    let bradley = kind(&world, "ua-bradley");
    let enemy = kind(&world, "ru-t-72b3");
    let id = world.spawn(0, bradley, centre(20, 20));
    // Enemy 4 tiles to the east (90° off the hull heading of Angle(0)).
    world.spawn(1, enemy, centre(24, 20));
    for _ in 0..30 {
        world.step();
    }
    let unit = world.unit(id).unwrap();
    assert_eq!(unit.heading, Angle(0), "turret aims; the hull stays put");
    assert_ne!(unit.turret, Angle(0), "turret has swung towards the enemy");
}

#[test]
fn ac_11_11_turret_recentres_when_the_target_is_gone() {
    let mut world = world();
    let bradley = kind(&world, "ua-bradley");
    let id = world.spawn(0, bradley, centre(20, 20));
    world.enqueue(Command::Move {
        units: vec![id],
        target: centre(20, 30),
    });
    // Force a stray turret angle, then drive: with no target it recentres.
    let mut state = world.unit(id).unwrap().locomotion();
    state.turret = Angle(16384);
    world.set_locomotion_state(id, state);
    for _ in 0..60 {
        world.step();
    }
    assert_eq!(world.unit(id).unwrap().turret, Angle(0));
}
