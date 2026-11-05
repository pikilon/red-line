//! AC-28-01..05: vehicles driving over infantry (spec 28).

use sim::entity::EntityId;
use sim::fixed::{Fx, FxVec2};
use sim::map::MapGrid;
use sim::rules::{Ruleset, TypeId};
use sim::world::{Command, World};

/// Centre of tile `(x, y)` in world units.
fn centre(x: i32, y: i32) -> FxVec2 {
    FxVec2::new(
        Fx::from_raw(x * 65536 + 32768),
        Fx::from_raw(y * 65536 + 32768),
    )
}

/// Two players on an open map, with every weapon removed so that only the
/// vehicles' contact hurts the soldiers. Soldiers do not dodge (spec 28 §6
/// is tested on its own below).
fn sandbox() -> World {
    dodge_sandbox(0, 0)
}

/// `sandbox` with the dodge of spec 28 §6 set to `lookahead` and `miss`.
fn dodge_sandbox(lookahead: u32, miss: u32) -> World {
    let mut rules = Ruleset::builtin();
    for ty in &mut rules.types {
        ty.weapon = -1;
    }
    rules.crush_dodge_lookahead_centi = lookahead;
    rules.crush_dodge_miss_one_in = miss;
    World::sandbox(rules, MapGrid::open(40, 40), &[0, 1])
}

/// Drives a tank from (10, 20) to (22, 20) at an enemy rifleman on (15, 20)
/// who walks to `walk_to` (or stands, with `None`); true if he survives.
fn soldier_survives_tank(world: &mut World, walk_to: Option<FxVec2>) -> bool {
    let tank = kind(world, "ua-leopard-2a4");
    let rifleman = kind(world, "ru-rifleman");
    let car = world.spawn(0, tank, centre(10, 20));
    let soldier = world.spawn(1, rifleman, centre(15, 20));
    world.enqueue(Command::Move {
        units: vec![car],
        target: centre(22, 20),
    });
    if let Some(target) = walk_to {
        world.enqueue_as(
            1,
            Command::Move {
                units: vec![soldier],
                target,
            },
        );
    }
    for _ in 0..600 {
        world.step();
    }
    world.unit(soldier).is_some()
}

#[test]
fn ac_28_09_an_idle_soldier_steps_out_of_a_tanks_way() {
    let mut world = dodge_sandbox(150, 0);
    assert!(soldier_survives_tank(&mut world, None));
}

#[test]
fn ac_28_10_a_walking_soldier_sidesteps_a_tank() {
    let mut world = dodge_sandbox(150, 0);
    assert!(soldier_survives_tank(&mut world, Some(centre(5, 20))));
}

#[test]
fn ac_28_11_a_soldier_who_never_reacts_is_crushed() {
    let mut world = dodge_sandbox(150, 1);
    assert!(!soldier_survives_tank(&mut world, None));
}

#[test]
fn ac_28_12_the_shipped_rules_make_soldiers_dodge() {
    let rules = Ruleset::builtin();
    assert!(rules.crush_dodge_lookahead_centi > 0);
    assert!(rules.crush_dodge_miss_one_in > 1);
}

fn kind(world: &World, id: &str) -> TypeId {
    world.rules().type_index(id).expect("builtin type exists")
}

fn infantry_hp(world: &World) -> u32 {
    world.rules().ty(kind(world, "ru-rifleman")).hp
}

/// Drives `vehicle` (player 0) from tile (10, 20) to (22, 20) through a
/// rifleman of `soldier_owner` standing on (15, 20); returns the world and
/// the soldier's id after `ticks` steps.
fn drive_through(vehicle: &str, soldier_owner: u8, ticks: u32) -> (World, EntityId) {
    let mut world = sandbox();
    let vehicle = kind(&world, vehicle);
    let rifleman = kind(&world, "ru-rifleman");
    let car = world.spawn(0, vehicle, centre(10, 20));
    let soldier = world.spawn(soldier_owner, rifleman, centre(15, 20));
    world.enqueue(Command::Move {
        units: vec![car],
        target: centre(22, 20),
    });
    for _ in 0..ticks {
        world.step();
    }
    (world, soldier)
}

#[test]
fn ac_25_01_tracked_vehicle_crushes_enemy_infantry() {
    let mut world = sandbox();
    let tank = kind(&world, "ua-leopard-2a4");
    assert!(world.rules().ty(tank).motion.crusher_level > 0);
    let rifleman = kind(&world, "ru-rifleman");
    let car = world.spawn(0, tank, centre(10, 20));
    let soldier = world.spawn(1, rifleman, centre(15, 20));
    world.enqueue(Command::Move {
        units: vec![car],
        target: centre(22, 20),
    });
    let start = world.unit(soldier).unwrap().pos;
    let mut crushed = false;
    for _ in 0..600 {
        world.step();
        let Some(man) = world.unit(soldier) else {
            crushed = true;
            break;
        };
        // He is not pushed aside: the tank drives over him.
        assert_eq!(man.pos, start, "a crushable soldier is not pushed apart");
    }
    assert!(crushed, "the tank kills the enemy soldier it drives over");
}

#[test]
fn ac_25_02_tracked_vehicle_spares_friendly_infantry() {
    let (world, soldier) = drive_through("ua-leopard-2a4", 0, 600);
    let man = world
        .unit(soldier)
        .expect("a friendly soldier is never crushed");
    assert_eq!(man.hp, infantry_hp(&world));
}

#[test]
fn ac_25_03_a_standing_tank_crushes_nobody() {
    let mut world = sandbox();
    let tank = kind(&world, "ua-leopard-2a4");
    let rifleman = kind(&world, "ru-rifleman");
    world.spawn(0, tank, centre(10, 20));
    let soldier = world.spawn(1, rifleman, centre(10, 20));
    for _ in 0..30 {
        world.step();
    }
    let man = world.unit(soldier).expect("only a moving crusher crushes");
    assert_eq!(man.hp, infantry_hp(&world));
}

#[test]
fn ac_25_04_wheeled_vehicle_shoves_enemy_infantry_aside() {
    let (world, soldier) = drive_through("ua-supply-truck", 1, 600);
    let truck = kind(&world, "ua-supply-truck");
    let motion = world.rules().ty(truck).motion;
    assert_eq!(motion.crusher_level, 0, "wheels do not crush");
    let man = world
        .unit(soldier)
        .expect("a wheeled vehicle does not crush");
    let full = infantry_hp(&world);
    assert!(man.hp < full, "the shove hurts him");
    assert_eq!((full - man.hp) % motion.shove_damage, 0);
    assert!(
        (man.pos.y - centre(15, 20).y).raw().abs() > Fx::from_raw(65536 / 4).raw(),
        "he is thrown sideways out of the path"
    );
}

#[test]
fn ac_25_05_wheeled_vehicle_does_not_hurt_friendly_infantry() {
    let (world, soldier) = drive_through("ua-supply-truck", 0, 600);
    let man = world.unit(soldier).unwrap();
    assert_eq!(man.hp, infantry_hp(&world));
}
