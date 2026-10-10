//! AC-03-24, AC-03-25: harvesting.

use sim::entity::{HarvestPhase, Order};
use sim::fixed::FxVec2;
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::world::{Command, World};

fn test_rules() -> Ruleset {
    Ruleset::from_json(include_str!("fixtures/test-rules.json")).unwrap()
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn sandbox() -> World {
    World::sandbox(test_rules(), MapGrid::open(40, 24), &[0, 0])
}

fn steps(world: &mut World, count: u32) {
    for _ in 0..count {
        world.step();
    }
}

#[test]
fn ac_03_24_truck_cycle() {
    let mut world = sandbox();
    world.place_building(0, 4, Cell { x: 10, y: 10 }, true);
    let depot = world.place_depot(Cell { x: 10, y: 13 }, 250);
    let truck = world.spawn(0, 8, at(1050, 1250));

    world.enqueue(Command::Harvest {
        units: vec![truck],
        depot,
    });

    world.step();
    match world.entity(truck).unwrap().order {
        Order::Harvest { phase, timer, .. } => {
            assert_eq!(phase, HarvestPhase::Loading);
            assert_eq!(timer, 3);
        }
        other => panic!("expected Harvest order, got {other:?}"),
    }

    steps(&mut world, 3);
    let truck_entity = world.entity(truck).unwrap();
    assert_eq!(truck_entity.cargo, 100);
    match truck_entity.order {
        Order::Harvest { phase, .. } => {
            assert_eq!(phase, HarvestPhase::ToCenter);
        }
        other => panic!("expected Harvest order, got {other:?}"),
    }
    assert_eq!(world.entity(depot).unwrap().hp, 150);

    world.step();
    match world.entity(truck).unwrap().order {
        Order::Harvest { phase, timer, .. } => {
            assert_eq!(phase, HarvestPhase::Unloading);
            assert_eq!(timer, 2);
        }
        other => panic!("expected Harvest order, got {other:?}"),
    }

    steps(&mut world, 2);
    assert_eq!(world.player(0).unwrap().credits, 1100);
    assert_eq!(world.entity(truck).unwrap().cargo, 0);

    steps(&mut world, 7);
    assert_eq!(world.player(0).unwrap().credits, 1200);

    steps(&mut world, 7);
    assert_eq!(world.player(0).unwrap().credits, 1250);
    assert_eq!(world.entity(depot).unwrap().hp, 0);

    world.step();
    assert_eq!(
        world.entity(truck).unwrap().order,
        Order::Idle { last_order_id: 1 }
    );
}

#[test]
fn ac_03_25_depot_exhaustion_and_sharing() {
    let mut world = sandbox();
    world.place_building(0, 4, Cell { x: 10, y: 10 }, true);
    let depot1 = world.place_depot(Cell { x: 10, y: 13 }, 100);
    let depot2 = world.place_depot(Cell { x: 20, y: 13 }, 500);
    let truck = world.spawn(0, 8, at(1050, 1250));

    world.enqueue(Command::Harvest {
        units: vec![truck],
        depot: depot1,
    });

    steps(&mut world, 7);
    assert_eq!(world.player(0).unwrap().credits, 1100);

    world.step();
    match world.entity(truck).unwrap().order {
        Order::Harvest { depot, .. } => {
            assert_eq!(depot, depot2);
        }
        other => panic!("expected Harvest order, got {other:?}"),
    }

    while world.tick() < 300 && world.player(0).unwrap().credits < 1200 {
        world.step();
    }
    assert_eq!(world.player(0).unwrap().credits, 1200);
    assert_eq!(world.entity(depot2).unwrap().hp, 400);

    let mut world = sandbox();
    world.place_building(0, 4, Cell { x: 10, y: 10 }, true);
    let depot = world.place_depot(Cell { x: 10, y: 13 }, 150);
    let truck1 = world.spawn(0, 8, at(1050, 1250));
    let truck2 = world.spawn(0, 8, at(1150, 1250));

    world.enqueue(Command::Harvest {
        units: vec![truck1, truck2],
        depot,
    });

    steps(&mut world, 4);
    assert_eq!(world.entity(truck1).unwrap().cargo, 100);
    assert_eq!(world.entity(truck2).unwrap().cargo, 50);
    assert_eq!(world.entity(depot).unwrap().hp, 0);

    steps(&mut world, 3);
    assert_eq!(world.player(0).unwrap().credits, 1150);
}
