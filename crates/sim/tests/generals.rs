//! Spec 63: player rank and General's powers (AC-63-01..AC-63-09).

mod common;

use common::saves::load_example;
use sim::fixed::FxVec2;
use sim::hash::state_hash;
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::save::{load_state, save_state};
use sim::snapshot::encode_match_snapshot;
use sim::world::{Command, World};

fn sandbox() -> World {
    World::sandbox(Ruleset::builtin(), MapGrid::open(60, 40), &[0, 1])
}

fn kind(world: &World, id: &str) -> u16 {
    world.rules().type_index(id).unwrap()
}

fn power(world: &World, id: &str) -> u16 {
    world
        .rules()
        .general
        .powers
        .iter()
        .position(|p| p.id == id)
        .unwrap_or_else(|| panic!("no power {id}")) as u16
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn buy(world: &mut World, player: u8, id: &str) {
    let power = power(world, id);
    world.enqueue_as(player, Command::BuyPower { power });
    world.step();
}

fn cast(world: &mut World, player: u8, id: &str, target: FxVec2) {
    let power = power(world, id);
    world.enqueue_as(player, Command::CastPower { power, target });
    world.step();
}

fn owned(world: &World, player: u8) -> usize {
    world.player(player).unwrap().powers().len()
}

/// Kills a 1 hit point enemy truck with `killer`; it is worth 60 points.
fn kill_truck(world: &mut World, killer: u32) {
    let enemy = world.spawn(1, kind(world, "ru-supply-truck"), at(1500, 1000));
    world.set_hp(enemy, 1);
    world.enqueue_as(
        0,
        Command::Attack {
            units: vec![killer],
            target: enemy,
        },
    );
    for _ in 0..300 {
        world.step();
        if world.entity(enemy).is_none() {
            return;
        }
    }
    panic!("the truck survived");
}

#[test]
fn ac_63_01_rank_derives_from_skill_points_and_each_rank_grants_points() {
    let mut world = sandbox();
    assert_eq!(world.general_rank(0), 1, "a new player is rank 1");
    assert_eq!(world.general_points(0), 1);
    for (xp, rank, points) in [
        (299, 1, 1),
        (300, 2, 2),
        (800, 3, 3),
        (1600, 4, 4),
        (3000, 5, 7),
    ] {
        world.set_general_xp(0, xp);
        assert_eq!(world.general_rank(0), rank, "{xp} skill points");
        assert_eq!(world.general_points(0), points, "{xp} skill points");
    }
    world.set_general_xp(0, 99_999);
    assert_eq!(
        world.player(0).unwrap().general_xp(),
        3000,
        "capped at rank 5"
    );
}

#[test]
fn ac_63_02_destroying_an_enemy_earns_its_experience_value_as_skill_points() {
    let mut world = sandbox();
    let tank = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(1000, 1000));
    kill_truck(&mut world, tank);
    assert_eq!(world.player(0).unwrap().general_xp(), 60);
    assert_eq!(
        world.player(1).unwrap().general_xp(),
        0,
        "the victim earns none"
    );
    for _ in 0..4 {
        kill_truck(&mut world, tank);
    }
    assert_eq!(world.general_rank(0), 2, "300 skill points reach rank 2");
    assert_eq!(world.general_points(0), 2, "and grant a point");
}

#[test]
fn ac_63_03_buying_needs_rank_points_faction_and_is_once() {
    let mut world = sandbox();
    buy(&mut world, 0, "emergency-repair");
    assert_eq!(owned(&world, 0), 0, "rank 2 is needed");
    buy(&mut world, 0, "recon-scan");
    assert_eq!(owned(&world, 0), 1);
    assert_eq!(world.general_points(0), 0, "the point is spent");
    buy(&mut world, 0, "recon-scan");
    assert_eq!(owned(&world, 0), 1, "not twice");
    world.set_general_xp(0, 300);
    assert_eq!(world.general_points(0), 1);
    buy(&mut world, 0, "emergency-repair");
    assert_eq!(owned(&world, 0), 2);
    world.set_general_xp(0, 1600);
    buy(&mut world, 0, "paradrop-russia");
    assert_eq!(owned(&world, 0), 2, "another faction's power is refused");
    buy(&mut world, 0, "artillery-barrage");
    assert_eq!(owned(&world, 0), 3);
    assert_eq!(world.general_points(0), 0, "4 granted, 1 + 1 + 2 spent");
    buy(&mut world, 0, "paradrop-ukraine");
    assert_eq!(owned(&world, 0), 3, "it costs 3, none is left");
}

#[test]
fn ac_63_04_a_power_is_cast_at_a_target_then_recharges() {
    let mut world = sandbox();
    let cell = Cell { x: 30, y: 20 };
    let explored = |world: &World, x, y| world.fog(0, Cell { x, y }) > 0;
    cast(&mut world, 0, "recon-scan", at(3050, 2050));
    assert!(
        !explored(&world, cell.x, cell.y),
        "not bought: nothing happens"
    );
    buy(&mut world, 0, "recon-scan");
    cast(&mut world, 0, "recon-scan", at(3050, 2050));
    assert!(explored(&world, cell.x, cell.y));
    assert!(explored(&world, cell.x + 14, cell.y), "inside 15 tiles");
    assert!(!explored(&world, cell.x + 16, cell.y), "outside the radius");
    assert!(world.fog(1, cell) == 0, "only the caster sees");
    let ready = world.player(0).unwrap().powers()[0].ready_tick;
    assert_eq!(ready, world.tick() - 1 + 900, "900 ticks of recharge");
    cast(&mut world, 0, "recon-scan", at(1000, 1000));
    assert!(!explored(&world, 10, 10), "still recharging");
    while world.tick() < ready {
        world.step();
    }
    cast(&mut world, 0, "recon-scan", at(1000, 1000));
    assert!(explored(&world, 10, 10), "recharged");
}

#[test]
fn ac_63_05_emergency_repair_heals_own_vehicles_in_the_area_only() {
    let mut world = sandbox();
    world.set_general_xp(0, 300);
    let near = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(2000, 2000));
    let far = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(5000, 2000));
    let foot = world.spawn(0, kind(&world, "ua-rifleman"), at(2100, 2000));
    let enemy = world.spawn(1, kind(&world, "ru-t-72b3"), at(2100, 2100));
    let max = world.max_hp(world.entity(near).unwrap());
    for id in [near, far, foot, enemy] {
        world.set_hp(id, 10);
    }
    buy(&mut world, 0, "recon-scan");
    world.set_general_xp(0, 800);
    buy(&mut world, 0, "emergency-repair");
    cast(&mut world, 0, "emergency-repair", at(2000, 2000));
    assert_eq!(world.entity(near).unwrap().hp, 10 + max / 2);
    assert_eq!(world.entity(far).unwrap().hp, 10, "outside the area");
    assert_eq!(
        world.entity(foot).unwrap().hp,
        10,
        "infantry are not vehicles"
    );
    assert!(
        world.entity(enemy).unwrap().hp <= 10,
        "enemies are not healed"
    );
}

#[test]
fn ac_63_06_the_barrage_hurts_enemy_ground_units_in_the_area_only() {
    let mut world = sandbox();
    world.set_general_xp(0, 800);
    let foe = world.spawn(1, kind(&world, "ru-supply-truck"), at(3000, 2000));
    let far = world.spawn(1, kind(&world, "ru-supply-truck"), at(4500, 2000));
    let own = world.spawn(0, kind(&world, "ua-supply-truck"), at(3000, 2100));
    let (foe_hp, far_hp, own_hp) = (
        world.entity(foe).unwrap().hp,
        world.entity(far).unwrap().hp,
        world.entity(own).unwrap().hp,
    );
    buy(&mut world, 0, "artillery-barrage");
    assert_eq!(owned(&world, 0), 1);
    cast(&mut world, 0, "artillery-barrage", at(3000, 2000));
    assert!(world.entity(foe).unwrap().hp < foe_hp, "the target is hit");
    assert_eq!(world.entity(far).unwrap().hp, far_hp, "far away is safe");
    assert_eq!(world.entity(own).unwrap().hp, own_hp, "own units are safe");
}

#[test]
fn ac_63_07_the_paradrop_lands_the_factions_infantry() {
    let mut world = sandbox();
    world.set_general_xp(0, 1600);
    let rifle = kind(&world, "ua-rifleman");
    let count = |world: &World| {
        world
            .entities()
            .iter()
            .filter(|e| e.owner == 0 && e.kind == rifle)
            .count()
    };
    buy(&mut world, 0, "paradrop-ukraine");
    assert_eq!(owned(&world, 0), 1);
    cast(&mut world, 0, "paradrop-ukraine", at(3000, 2000));
    assert_eq!(count(&world), 5);
}

#[test]
fn ac_63_08_rank_and_powers_are_hashed_saved_and_deterministic() {
    let run = || {
        let (mut world, _, _) = load_example("generals-powers");
        buy(&mut world, 0, "recon-scan");
        buy(&mut world, 0, "artillery-barrage");
        cast(&mut world, 0, "artillery-barrage", at(5600, 2300));
        world
    };
    let (a, b) = (run(), run());
    assert_eq!(state_hash(&a), state_hash(&b));
    let mut other = run();
    other.set_general_xp(0, 901);
    assert_ne!(
        state_hash(&a),
        state_hash(&other),
        "skill points are hashed"
    );
    let (loaded, _, _) = load_state(&save_state(&a, 1, &[]).unwrap()).unwrap();
    assert_eq!(state_hash(&loaded), state_hash(&a));
    assert_eq!(
        loaded.player(0).unwrap().powers(),
        a.player(0).unwrap().powers()
    );
    assert_eq!(loaded.general_rank(0), 3);
}

#[test]
fn ac_63_09_the_snapshot_carries_rank_and_powers_and_the_example_save_is_rank_3() {
    let (mut world, _, _) = load_example("generals-powers");
    assert_eq!(world.general_rank(0), 3);
    assert_eq!(world.general_points(0), 3);
    assert_eq!(world.general_rank(1), 1, "the opponent starts at rank 1");
    let barrage = power(&world, "artillery-barrage");
    world.enqueue_as(0, Command::BuyPower { power: barrage });
    world.step();
    let snapshot = encode_match_snapshot(&world, 0);
    let tail: Vec<i32> = snapshot[snapshot.len() - 6..].to_vec();
    assert_eq!(tail[0], 1, "one ranked player");
    assert_eq!(&tail[1..4], &[0, 900, 1], "player, skill points, one power");
    assert_eq!(tail[4], i32::from(barrage));
}
