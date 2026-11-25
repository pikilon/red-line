//! Spec 57: the score-screen counters.

use sim::fixed::FxVec2;
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::snapshot::encode_match_snapshot;
use sim::world::{Command, World};

fn sandbox() -> World {
    let rules = Ruleset::from_json(include_str!("fixtures/test-rules.json")).unwrap();
    let mut world = World::sandbox(rules, MapGrid::open(40, 24), &[0, 0]);
    world.explore_all(0);
    world
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn steps(world: &mut World, count: u32) {
    for _ in 0..count {
        world.step();
    }
}

fn build_power(world: &mut World) {
    let dozer = world.spawn(0, 7, at(950, 650));
    world.enqueue_as(
        0,
        Command::Construct {
            dozer,
            kind: 3,
            origin: Cell { x: 10, y: 6 },
        },
    );
}

#[test]
fn ac_57_01_nothing_counted_at_the_start() {
    let world = sandbox();
    for id in 0..2 {
        assert_eq!(world.player(id).unwrap().stats().to_array(), [0; 8]);
    }
}

#[test]
fn ac_57_02_a_kill_is_a_loss_for_the_victim_and_a_kill_for_the_killer() {
    let mut world = sandbox();
    let tank = world.spawn(0, 10, at(550, 550));
    let soldier = world.spawn(1, 9, at(1050, 550));
    world.refresh_visibility();
    world.enqueue_as(
        0,
        Command::Attack {
            units: vec![tank],
            target: soldier,
        },
    );
    steps(&mut world, 200);
    assert!(world.entity(soldier).is_none());
    let (winner, loser) = (
        world.player(0).unwrap().stats(),
        world.player(1).unwrap().stats(),
    );
    assert_eq!((winner.units_destroyed, winner.units_lost), (1, 0));
    assert_eq!((loser.units_lost, loser.units_destroyed), (1, 0));
    assert_eq!(winner.buildings_destroyed + loser.buildings_lost, 0);
}

#[test]
fn ac_57_03_production_is_built_and_paid_for() {
    let mut world = sandbox();
    world.place_building(0, 3, Cell { x: 0, y: 0 }, true);
    let factory = world.place_building(0, 5, Cell { x: 4, y: 0 }, true);
    world.set_credits(0, 1000);
    world.enqueue_as(
        0,
        Command::Produce {
            building: factory,
            kind: 9,
        },
    );
    world.step();
    assert_eq!(world.player(0).unwrap().stats().money_spent, 50);
    assert_eq!(world.player(0).unwrap().stats().units_built, 0);
    steps(&mut world, 400);
    let stats = world.player(0).unwrap().stats();
    assert_eq!((stats.units_built, stats.money_spent), (1, 50));
}

#[test]
fn ac_57_04_a_cancelled_order_is_not_money_spent() {
    let mut world = sandbox();
    world.place_building(0, 3, Cell { x: 0, y: 0 }, true);
    let factory = world.place_building(0, 5, Cell { x: 4, y: 0 }, true);
    world.set_credits(0, 1000);
    world.enqueue_as(
        0,
        Command::Produce {
            building: factory,
            kind: 9,
        },
    );
    world.step();
    world.enqueue_as(0, Command::Cancel { building: factory });
    world.step();
    assert_eq!(world.player(0).unwrap().stats().money_spent, 0);
}

#[test]
fn ac_57_05_a_finished_building_is_counted_and_a_foundation_is_not() {
    let mut world = sandbox();
    build_power(&mut world);
    world.step();
    let stats = world.player(0).unwrap().stats();
    assert_eq!((stats.buildings_built, stats.money_spent), (0, 300));
    steps(&mut world, 400);
    assert_eq!(world.player(0).unwrap().stats().buildings_built, 1);
}

#[test]
fn ac_57_06_the_snapshot_carries_the_counters_once_counting_starts() {
    let mut world = sandbox();
    world.step();
    let quiet = encode_match_snapshot(&world, 0).len();
    build_power(&mut world);
    world.step();
    let snapshot = encode_match_snapshot(&world, 0);
    // air 0, upgrades 0, two players; spent 300 by player 0.
    let tail = &snapshot[snapshot.len() - 21..];
    assert_eq!(&tail[..3], &[0, 0, 2]);
    assert_eq!(&tail[3..12], &[0, 0, 0, 0, 0, 0, 0, 0, 300]);
    assert_eq!(&tail[12..], &[1, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert!(snapshot.len() > quiet);
}
