//! Spec 61: stealth and detection.

mod common;

use common::saves::load_example;
use sim::entity::OBSERVER;
use sim::fixed::FxVec2;
use sim::map::MapGrid;
use sim::rules::{Ruleset, fx_centi};
use sim::save::{load_state, save_state};
use sim::snapshot::{ENTITY_STRIDE, FLAG_STEALTHED, MATCH_HEADER_LEN, encode_match_snapshot};
use sim::world::{Command, World};

fn at(x: u32, y: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x), fx_centi(y))
}

fn kind(rules: &Ruleset, id: &str) -> u16 {
    rules.type_index(id).unwrap_or_else(|| panic!("type {id}"))
}

/// Player 0: a stealth Stugna team (id 0). Player 1: a T-72 (id 1) 5 tiles away.
fn setup() -> World {
    let rules = Ruleset::builtin();
    let team = kind(&rules, "ua-stugna-team");
    let tank = kind(&rules, "ru-t-72b3");
    let mut world = World::sandbox(rules, MapGrid::open(60, 30), &[0, 1]);
    assert_eq!(world.spawn(0, team, at(2000, 1500)), 0);
    assert_eq!(world.spawn(1, tank, at(2500, 1500)), 1);
    world
}

fn hidden(world: &World) -> bool {
    !world.is_entity_visible(1, 0)
}

#[test]
fn ac_61_01_hidden_from_the_enemy_only() {
    let mut world = setup();
    world.step();
    assert!(hidden(&world));
    assert!(world.is_entity_visible(0, 0));
    assert!(world.is_entity_visible(OBSERVER, 0));
}

#[test]
fn ac_61_02_not_targeted_while_hidden() {
    let mut world = setup();
    world.enqueue(Command::Attack {
        units: vec![1],
        target: 0,
    });
    world.step();
    assert!(matches!(
        world.entity(1).unwrap().order,
        sim::entity::Order::Idle { .. }
    ));
    assert!(hidden(&world));
}

#[test]
fn ac_61_03_firing_exposes_then_hides_again() {
    let mut world = setup();
    world.step();
    assert!(hidden(&world));
    world.enqueue(Command::Attack {
        units: vec![0],
        target: 1,
    });
    let mut exposed = false;
    for _ in 0..60 {
        world.step();
        exposed |= !hidden(&world);
    }
    assert!(exposed, "the shot gives the team away");
    let delay = world
        .rules()
        .ty(world.entity(0).unwrap().kind)
        .stealth
        .unwrap()
        .delay_ticks;
    assert!(world.entity(0).unwrap().exposed <= delay);
}

#[test]
fn ac_61_04_moving_exposes() {
    let mut world = setup();
    world.step();
    world.enqueue(Command::Move {
        units: vec![0],
        target: at(1800, 1500),
    });
    world.step();
    world.step();
    assert!(!hidden(&world));
    for _ in 0..400 {
        world.step();
    }
    assert!(
        hidden(&world),
        "hides again once stopped and the delay passed"
    );
}

#[test]
fn ac_61_05_detector_range() {
    let rules = Ruleset::builtin();
    let team = kind(&rules, "ua-stugna-team");
    let scout = kind(&rules, "ru-brdm-scout");
    let mut world = World::sandbox(rules, MapGrid::open(80, 30), &[0, 1]);
    assert_eq!(world.spawn(0, team, at(2000, 1500)), 0);
    // 13 tiles away: outside the 10-tile range.
    assert_eq!(world.spawn(1, scout, at(3300, 1500)), 1);
    for _ in 0..40 {
        world.step();
    }
    assert!(hidden(&world));
    // A second scout inside the range exposes it within one scan period.
    world.spawn(1, scout, at(2800, 1500));
    for _ in 0..16 {
        world.step();
    }
    assert!(!hidden(&world));
}

#[test]
fn ac_61_06_exposed_is_saved_and_hashed() {
    let (mut world, seed, ais) = load_example("stealth");
    let id = world.entities()[0].id;
    world.step();
    let plain = sim::hash::state_hash(&world);
    world.enqueue(Command::Move {
        units: vec![id],
        target: at(3500, 1450),
    });
    world.step();
    world.step();
    assert_ne!(sim::hash::state_hash(&world), plain);
    assert!(world.entity(id).unwrap().exposed > 0);
    let state = save_state(&world, seed, &ais).unwrap();
    let (loaded, _, _) = load_state(&state).unwrap();
    assert_eq!(
        loaded.entity(id).unwrap().exposed,
        world.entity(id).unwrap().exposed
    );
    assert_eq!(
        sim::hash::state_hash(&loaded),
        sim::hash::state_hash(&world)
    );
}

fn flags_of(snapshot: &[i32], id: i32) -> Option<i32> {
    let count = snapshot[MATCH_HEADER_LEN - 1] as usize;
    (0..count)
        .map(|i| &snapshot[MATCH_HEADER_LEN + i * ENTITY_STRIDE..][..ENTITY_STRIDE])
        .find(|row| row[0] == id)
        .map(|row| row[6])
}

#[test]
fn ac_61_07_snapshot_flag_for_owner_only() {
    let mut world = setup();
    world.step();
    let own = encode_match_snapshot(&world, 0);
    let flags = flags_of(&own, 0).expect("owner sees it");
    assert_ne!(flags & FLAG_STEALTHED, 0);
    let enemy = encode_match_snapshot(&world, 1);
    assert!(flags_of(&enemy, 0).is_none());
}
