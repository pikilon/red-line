//! Spec 49: attack-move and guard orders (AC-49-01..AC-49-06).

use sim::fixed::FxVec2;
use sim::map::MapGrid;
use sim::rules::{Ruleset, fx_centi};
use sim::world::{Command, Order, World};

const TANK: u16 = 10;
const TRUCK: u16 = 8;

fn sandbox() -> World {
    let rules = Ruleset::from_json(include_str!("fixtures/test-rules.json")).unwrap();
    World::sandbox(rules, MapGrid::open(40, 24), &[0, 0])
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn steps(world: &mut World, count: u32) {
    for _ in 0..count {
        world.step();
    }
}

fn alive(world: &World, id: u32) -> bool {
    world.entity(id).is_some_and(|entity| entity.hp > 0)
}

#[test]
fn ac_49_01_attack_move_fights_on_the_way_then_resumes() {
    let mut world = sandbox();
    let tank = world.spawn(0, TANK, at(250, 1050));
    // A truck beside the road, inside the tank's sight (6) as it passes.
    let truck = world.spawn(1, TRUCK, at(1550, 1350));
    world.enqueue_as(
        0,
        Command::AttackMove {
            units: vec![tank],
            target: at(3050, 1050),
        },
    );
    let mut engaged = false;
    for _ in 0..800 {
        world.step();
        if let Some(Order::AttackMove {
            engaging: Some(enemy),
            ..
        }) = world.entity(tank).map(|e| e.order)
        {
            engaged |= enemy == truck;
        }
    }
    assert!(engaged, "the tank engages the truck it meets");
    assert!(!alive(&world, truck), "the truck is destroyed");
    let unit = world.entity(tank).unwrap();
    assert!(matches!(unit.order, Order::Idle { .. }));
    assert!((unit.pos - at(3050, 1050)).length() < fx_centi(100));
}

/// Ticks until `tank` is idle after `command`, at most 2000.
fn ticks_to_arrive(command: impl Fn(u32) -> Command) -> u32 {
    let mut world = sandbox();
    let tank = world.spawn(0, TANK, at(250, 1050));
    world.spawn(1, TRUCK, at(1550, 1350));
    world.enqueue_as(0, command(tank));
    for tick in 1..=2000 {
        world.step();
        if matches!(world.entity(tank).unwrap().order, Order::Idle { .. }) {
            return tick;
        }
    }
    2000
}

#[test]
fn ac_49_02_plain_move_does_not_stop_for_the_same_enemy() {
    let target = at(3050, 1050);
    let moving = ticks_to_arrive(|tank| Command::Move {
        units: vec![tank],
        target,
    });
    let attack_moving = ticks_to_arrive(|tank| Command::AttackMove {
        units: vec![tank],
        target,
    });
    assert!(moving < attack_moving, "{moving} < {attack_moving}");
}

#[test]
fn ac_49_03_unarmed_units_in_an_attack_move_just_move() {
    let mut world = sandbox();
    let truck = world.spawn(0, TRUCK, at(250, 1050));
    world.enqueue_as(
        0,
        Command::AttackMove {
            units: vec![truck],
            target: at(1050, 1050),
        },
    );
    world.step();
    assert!(matches!(
        world.entity(truck).unwrap().order,
        Order::Move { .. }
    ));
}

#[test]
fn ac_49_04_guard_engages_an_enemy_in_the_area_and_returns_to_the_post() {
    let mut world = sandbox();
    let tank = world.spawn(0, TANK, at(1050, 1050));
    // 9 tiles away: outside its sight (6) and cannon (6), inside the inner guard
    // radius (180% of sight = 10.8).
    let truck = world.spawn(1, TRUCK, at(1950, 1050));
    world.enqueue_as(
        0,
        Command::Guard {
            units: vec![tank],
            target: at(1050, 1050),
        },
    );
    steps(&mut world, 3);
    assert!(matches!(
        world.entity(tank).unwrap().order,
        Order::Guard { target: Some(t), .. } if t == truck
    ));
    steps(&mut world, 600);
    assert!(!alive(&world, truck));
    let unit = world.entity(tank).unwrap();
    assert!(matches!(unit.order, Order::Guard { target: None, .. }));
    assert!((unit.pos - at(1050, 1050)).length() <= fx_centi(13));
}

#[test]
fn ac_49_05_guard_ignores_enemies_beyond_the_inner_radius() {
    let mut world = sandbox();
    let tank = world.spawn(0, TANK, at(1050, 1050));
    let truck = world.spawn(1, TRUCK, at(2450, 1050));
    world.enqueue_as(
        0,
        Command::Guard {
            units: vec![tank],
            target: at(1050, 1050),
        },
    );
    steps(&mut world, 100);
    assert!(alive(&world, truck));
    assert_eq!(world.entity(tank).unwrap().pos, at(1050, 1050));
}

#[test]
fn ac_49_06_guard_gives_up_a_chase_beyond_the_outer_radius() {
    let mut world = sandbox();
    let tank = world.spawn(0, TANK, at(1050, 1050));
    let truck = world.spawn(1, TRUCK, at(1950, 1050));
    world.enqueue_as(
        0,
        Command::Guard {
            units: vec![tank],
            target: at(1050, 1050),
        },
    );
    // The truck (twice the tank's speed) runs away along the road.
    world.enqueue_as(
        1,
        Command::Move {
            units: vec![truck],
            target: at(3850, 1050),
        },
    );
    steps(&mut world, 400);
    assert!(alive(&world, truck), "the faster truck escapes");
    let unit = world.entity(tank).unwrap();
    assert!(matches!(unit.order, Order::Guard { target: None, .. }));
    assert!((unit.pos - at(1050, 1050)).length() <= fx_centi(13));
}

#[test]
fn stop_ends_attack_move_and_guard() {
    let mut world = sandbox();
    let a = world.spawn(0, TANK, at(250, 1050));
    let b = world.spawn(0, TANK, at(250, 1550));
    world.enqueue_as(
        0,
        Command::AttackMove {
            units: vec![a],
            target: at(3050, 1050),
        },
    );
    world.enqueue_as(
        0,
        Command::Guard {
            units: vec![b],
            target: at(1050, 1550),
        },
    );
    steps(&mut world, 5);
    world.enqueue_as(0, Command::Stop { units: vec![a, b] });
    world.step();
    for id in [a, b] {
        assert!(matches!(
            world.entity(id).unwrap().order,
            Order::Idle { .. }
        ));
    }
}
