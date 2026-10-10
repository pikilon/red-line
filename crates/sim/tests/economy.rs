//! AC-03-13..AC-03-18: power, production speed, production queues and rally.

use sim::economy::production_speed_percent;
use sim::fixed::{Fx, FxVec2};
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::world::{Command, Order, World};

fn test_rules() -> Ruleset {
    Ruleset::from_json(include_str!("fixtures/test-rules.json")).unwrap()
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn sandbox() -> World {
    World::sandbox(test_rules(), MapGrid::open(40, 24), &[0, 0])
}

/// Complete `power` at (0, 0) and `factory` at (10, 10) for player 0.
fn factory_world() -> (World, u32) {
    let mut world = sandbox();
    world.place_building(0, 3, Cell { x: 0, y: 0 }, true);
    let factory = world.place_building(0, 5, Cell { x: 10, y: 10 }, true);
    (world, factory)
}

fn produce(world: &mut World, building: u32, kind: u16) {
    world.enqueue(Command::Produce { building, kind });
}

#[test]
fn ac_03_13_production_speed() {
    for (produced, consumed, expected) in [
        (0, 0, 100),
        (10, 0, 100),
        (10, 10, 100),
        (10, 20, 50),
        (5, 20, 25),
        (1, 20, 25),
        (0, 4, 25),
        (19, 20, 75),
    ] {
        assert_eq!(
            production_speed_percent(produced, consumed, 25, 75),
            expected,
            "({produced}, {consumed})"
        );
    }
}

#[test]
fn ac_03_14_power_totals() {
    let mut world = sandbox();
    world.place_building(0, 3, Cell { x: 0, y: 0 }, true);
    world.place_building(0, 4, Cell { x: 4, y: 0 }, true);
    world.place_building(0, 5, Cell { x: 8, y: 0 }, true);
    world.place_building(0, 6, Cell { x: 12, y: 0 }, false);
    world.step();
    assert_eq!(world.player(0).unwrap().power(), (10, 8));
    assert_eq!(world.player(1).unwrap().power(), (0, 0));
}

#[test]
fn ac_03_15_production_timing_payment_and_exit() {
    let (mut world, factory) = factory_world();
    let before = world.next_entity_id();
    produce(&mut world, factory, 9);
    world.step();
    assert_eq!(world.player(0).unwrap().credits, 950);
    let queue = &world.entity(factory).unwrap().site.as_ref().unwrap().queue;
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].progress, 100);
    for _ in 1..9 {
        world.step();
    }
    assert!(world.entity(before).is_none());
    world.step();
    assert!(
        world
            .entity(factory)
            .unwrap()
            .site
            .as_ref()
            .unwrap()
            .queue
            .is_empty()
    );
    let soldier = world.entity(before).unwrap();
    assert_eq!((soldier.kind, soldier.owner, soldier.hp), (9, 0, 50));
    assert_eq!(soldier.order, Order::Idle { last_order_id: 0 });
    assert_eq!(soldier.pos.x.raw(), 753664);
    assert_eq!(soldier.pos.y.raw(), 884736);
}

#[test]
fn ac_03_16_queue_rules() {
    let (mut world, factory) = factory_world();
    for _ in 0..4 {
        produce(&mut world, factory, 9);
    }
    world.step();
    let len = |w: &World| w.entity(factory).unwrap().site.as_ref().unwrap().queue.len();
    assert_eq!((len(&world), world.player(0).unwrap().credits), (3, 850));
    world.enqueue(Command::Cancel { building: factory });
    world.step();
    assert_eq!((len(&world), world.player(0).unwrap().credits), (2, 900));

    produce(&mut world, factory, 7);
    world.step();
    assert_eq!(len(&world), 2);

    let incomplete = world.place_building(0, 5, Cell { x: 20, y: 10 }, false);
    produce(&mut world, incomplete, 9);
    world.enqueue_as(
        1,
        Command::Produce {
            building: factory,
            kind: 9,
        },
    );
    world.step();
    assert_eq!(len(&world), 2);
    assert!(
        world
            .entity(incomplete)
            .unwrap()
            .site
            .as_ref()
            .unwrap()
            .queue
            .is_empty()
    );

    world.set_credits(0, 40);
    produce(&mut world, factory, 9);
    world.step();
    assert_eq!((len(&world), world.player(0).unwrap().credits), (2, 40));

    world.set_credits(0, 1000);
    produce(&mut world, factory, 10);
    world.step();
    assert_eq!(len(&world), 2);
    world.place_building(0, 4, Cell { x: 30, y: 10 }, true);
    produce(&mut world, factory, 10);
    world.step();
    assert_eq!(len(&world), 3);
}

#[test]
fn ac_03_17_low_power_slows_production() {
    let mut world = sandbox();
    let factory = world.place_building(0, 5, Cell { x: 10, y: 10 }, true);
    let id = world.next_entity_id();
    produce(&mut world, factory, 9);
    for _ in 0..39 {
        world.step();
    }
    assert!(world.entity(id).is_none());
    world.step();
    assert!(world.entity(id).is_some());
}

#[test]
fn ac_03_18_rally_point() {
    let (mut world, factory) = factory_world();
    let power = 0;
    let id = world.next_entity_id();
    world.enqueue(Command::Rally {
        building: factory,
        target: at(1550, 2050),
    });
    world.enqueue(Command::Rally {
        building: power,
        target: at(1550, 2050),
    });
    produce(&mut world, factory, 9);
    for _ in 0..10 {
        world.step();
    }
    assert_eq!(
        world.entity(id).unwrap().order,
        Order::Move {
            order_id: 1,
            target: FxVec2::new(Fx::from_raw(1015808), Fx::from_raw(1343488)),
            goal: Cell { x: 15, y: 20 },
        }
    );
    assert_eq!(world.entity(power).unwrap().site.as_ref().unwrap().rally, None);
}
