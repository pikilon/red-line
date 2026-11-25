//! Spec 64: superweapons (AC-64-01..AC-64-07).

mod common;

use common::saves::load_example;
use sim::fixed::FxVec2;
use sim::hash::state_hash;
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::save::{load_state, save_state};
use sim::snapshot::encode_match_snapshot;
use sim::world::{Command, World};

const RECHARGE: u32 = 5400;

fn sandbox() -> World {
    World::sandbox(Ruleset::builtin(), MapGrid::open(80, 50), &[0, 1])
}

fn kind(world: &World, id: &str) -> u16 {
    world.rules().type_index(id).unwrap()
}

fn power(world: &World) -> u16 {
    world
        .rules()
        .general
        .powers
        .iter()
        .position(|p| p.id == "strike-ukraine")
        .unwrap() as u16
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn ready_tick(world: &World, player: u8) -> Option<u32> {
    let power = power(world);
    world
        .player(player)?
        .powers()
        .iter()
        .find(|o| o.power == power)
        .map(|o| o.ready_tick)
}

fn fire(world: &mut World, player: u8, target: FxVec2) {
    let power = power(world);
    world.enqueue_as(player, Command::CastPower { power, target });
    world.step();
}

/// Player 0 with a finished battery and `plants` power plants.
fn armed(plants: i32) -> (World, u32) {
    let mut world = sandbox();
    let plant = kind(&world, "ua-power-plant");
    for i in 0..plants {
        world.place_building(0, plant, Cell { x: 5 + i * 4, y: 5 }, true);
    }
    let battery = kind(&world, "ua-atacms-battery");
    let id = world.place_building(0, battery, Cell { x: 10, y: 20 }, true);
    world.step();
    (world, id)
}

fn count(world: &World, owner: u8, id: &str) -> usize {
    world
        .entities()
        .iter()
        .filter(|e| e.owner == owner && world.rules().ty(e.kind).id == id)
        .count()
}

#[test]
fn ac_64_01_a_finished_building_starts_the_countdown_and_the_power_is_not_for_sale() {
    let mut world = sandbox();
    let battery = kind(&world, "ua-atacms-battery");
    world.place_building(0, battery, Cell { x: 10, y: 20 }, false);
    world.step();
    assert_eq!(ready_tick(&world, 0), None, "a foundation charges nothing");
    let (mut world, _) = armed(2);
    assert_eq!(ready_tick(&world, 0), Some(RECHARGE));
    assert_eq!(ready_tick(&world, 1), None);
    let power = power(&world);
    world.enqueue_as(1, Command::BuyPower { power });
    world.step();
    assert_eq!(ready_tick(&world, 1), None, "never bought");
}

#[test]
fn ac_64_02_a_player_may_own_only_one_of_each_superweapon() {
    let (mut world, _) = armed(2);
    world.set_credits(0, 100_000);
    world.set_credits(1, 100_000);
    let battery = kind(&world, "ua-atacms-battery");
    let site = kind(&world, "ua-missile-site");
    let cell = Cell { x: 40, y: 30 };
    world.place_building(1, site, Cell { x: 20, y: 30 }, true);
    assert!(!world.can_construct(0, battery, cell), "already has one");
    assert!(
        world.superweapon_taken(0, battery),
        "the limit counts foundations too"
    );
    assert!(!world.superweapon_taken(1, battery));
}

#[test]
fn ac_64_03_firing_hits_the_area_hard_then_the_countdown_restarts() {
    let (mut world, _) = armed(2);
    let plant = kind(&world, "ru-power-plant");
    let near = world.place_building(1, plant, Cell { x: 49, y: 29 }, true);
    let far = world.place_building(1, plant, Cell { x: 70, y: 45 }, true);
    let own = world.place_building(
        0,
        kind(&world, "ua-power-plant"),
        Cell { x: 52, y: 29 },
        true,
    );
    let hp = world.entity(near).unwrap().hp;
    fire(&mut world, 0, at(5000, 3000));
    assert_eq!(world.entity(near).unwrap().hp, hp, "not charged yet");
    while world.tick() < RECHARGE {
        world.step();
    }
    fire(&mut world, 0, at(5000, 3000));
    let hurt = world.entity(near).map_or(0, |e| e.hp);
    assert!(hurt < hp / 2, "heavy damage: {hurt} of {hp}");
    assert_eq!(world.entity(far).unwrap().hp, hp, "outside the area");
    assert_eq!(world.entity(own).unwrap().hp, hp, "own units are spared");
    assert_eq!(ready_tick(&world, 0), Some(world.tick() - 1 + RECHARGE));
}

#[test]
fn ac_64_04_low_power_halts_the_countdown_and_blocks_firing() {
    let (mut world, _) = armed(0);
    let start = ready_tick(&world, 0).unwrap();
    for _ in 0..30 {
        world.step();
    }
    assert_eq!(ready_tick(&world, 0), Some(start + 30), "pushed back");
    // Charged but unpowered: it cannot fire.
    let power = power(&world);
    world.grant_power(0, power, 0);
    let tank = kind(&world, "ru-t-72b3");
    let enemy = world.spawn(1, tank, at(5000, 3000));
    let hp = world.entity(enemy).unwrap().hp;
    fire(&mut world, 0, at(5000, 3000));
    assert_eq!(world.entity(enemy).unwrap().hp, hp);
}

#[test]
fn ac_64_05_losing_the_building_keeps_the_timer_and_a_rebuild_does_not_reset_it() {
    let (mut world, building) = armed(2);
    for _ in 0..100 {
        world.step();
    }
    world.set_hp(building, 0);
    world.step();
    assert!(world.entity(building).is_none());
    assert_eq!(ready_tick(&world, 0), Some(RECHARGE), "the timer survives");
    let battery = kind(&world, "ua-atacms-battery");
    world.place_building(0, battery, Cell { x: 30, y: 20 }, true);
    world.step();
    assert_eq!(ready_tick(&world, 0), Some(RECHARGE), "a rebuild keeps it");
}

#[test]
fn ac_64_06_the_countdown_is_hashed_saved_deterministic_and_public() {
    let run = || load_example("superweapons").0;
    let (a, b) = (run(), run());
    assert_eq!(state_hash(&a), state_hash(&b));
    let (loaded, _, _) = load_state(&save_state(&a, 1, &[]).unwrap()).unwrap();
    assert_eq!(state_hash(&loaded), state_hash(&a));
    assert_eq!(ready_tick(&loaded, 0), ready_tick(&a, 0));
    // The enemy's snapshot lists player 0's timer.
    let snapshot = encode_match_snapshot(&a, 1);
    let tail = &snapshot[snapshot.len() - 11..];
    assert_eq!(tail[0], 2, "both players have a countdown");
    assert_eq!(&tail[1..6], &[0, 0, 1, i32::from(power(&a)), 0]);
    assert_eq!(tail[10], 2700, "and the enemy sees Russia's own timer");
}

#[test]
fn ac_64_07_the_example_save_has_a_charged_battery_that_fires() {
    let (mut world, _, _) = load_example("superweapons");
    assert_eq!(ready_tick(&world, 0), Some(0));
    let tanks = count(&world, 1, "ru-t-72b3");
    assert_eq!(tanks, 3);
    let power = power(&world);
    world.enqueue_as(
        0,
        Command::CastPower {
            power,
            target: at(5650, 2300),
        },
    );
    world.step();
    assert!(count(&world, 1, "ru-t-72b3") < tanks, "the column is hit");
}
