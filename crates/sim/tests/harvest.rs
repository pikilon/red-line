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

fn credits_after(world: &mut World, limit: u32, wanted: u32) {
    for _ in 0..limit {
        if world.player(0).unwrap().credits >= wanted {
            return;
        }
        world.step();
    }
}

fn aboard_count(world: &World, building: sim::entity::EntityId) -> usize {
    world
        .entities()
        .iter()
        .filter(|e| e.aboard == Some(building))
        .count()
}

#[test]
fn ac_03_24_truck_cycle() {
    let mut world = sandbox();
    let center = world.place_building(0, 4, Cell { x: 10, y: 10 }, true);
    let depot = world.place_depot(Cell { x: 10, y: 13 }, 250);
    let truck = world.spawn(0, 8, at(1050, 1250));

    world.enqueue(Command::Harvest {
        units: vec![truck],
        depot,
    });

    // The truck drives into the depot bay to load (spec 55).
    world.step();
    match world.entity(truck).unwrap().order {
        Order::Harvest { phase, timer, .. } => {
            assert_eq!(phase, HarvestPhase::Loading);
            assert_eq!(timer, 3);
        }
        other => panic!("expected Harvest order, got {other:?}"),
    }
    assert_eq!(world.entity(truck).unwrap().aboard, Some(depot));

    steps(&mut world, 3);
    let truck_entity = world.entity(truck).unwrap();
    assert_eq!(truck_entity.cargo, 100);
    assert_eq!(truck_entity.aboard, None, "the truck left the depot bay");
    assert_eq!(world.entity(depot).unwrap().hp, 150);

    // Then it unloads inside the supply center.
    let mut inside = false;
    for _ in 0..200 {
        world.step();
        if world.entity(truck).unwrap().aboard == Some(center) {
            inside = true;
            break;
        }
    }
    assert!(inside, "the truck unloads inside the supply center");
    credits_after(&mut world, 100, 1100);
    assert_eq!(world.player(0).unwrap().credits, 1100);
    assert_eq!(world.entity(truck).unwrap().cargo, 0);

    credits_after(&mut world, 400, 1250);
    assert_eq!(world.player(0).unwrap().credits, 1250);
    assert_eq!(world.entity(depot).unwrap().hp, 0);
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

    credits_after(&mut world, 100, 1100);
    assert_eq!(world.player(0).unwrap().credits, 1100);

    for _ in 0..50 {
        world.step();
        if matches!(
            world.entity(truck).unwrap().order,
            Order::Harvest { depot, .. } if depot == depot2
        ) {
            break;
        }
    }
    match world.entity(truck).unwrap().order {
        Order::Harvest { depot, .. } => {
            assert_eq!(depot, depot2);
        }
        other => panic!("expected Harvest order, got {other:?}"),
    }

    credits_after(&mut world, 600, 1200);
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

    credits_after(&mut world, 400, 1150);
    assert_eq!(world.player(0).unwrap().credits, 1150);
}

/// Spec 55: at most two trucks load inside a depot at once; the third waits
/// outside until one drives out.
#[test]
fn ac_55_01_at_most_two_trucks_inside_a_depot() {
    let mut world = sandbox();
    world.place_building(0, 4, Cell { x: 10, y: 10 }, true);
    let depot = world.place_depot(Cell { x: 10, y: 13 }, 900);
    let trucks: Vec<_> = (0..3)
        .map(|i| world.spawn(0, 8, at(1050 + i * 40, 1250)))
        .collect();
    world.enqueue(Command::Harvest {
        units: trucks.clone(),
        depot,
    });

    world.step();
    assert_eq!(aboard_count(&world, depot), 2);
    for _ in 0..2 {
        world.step();
        assert!(aboard_count(&world, depot) <= 2);
    }
    let waiting = trucks
        .iter()
        .find(|&&t| world.entity(t).unwrap().aboard.is_none())
        .copied()
        .expect("one truck waits outside");
    assert!(matches!(
        world.entity(waiting).unwrap().order,
        Order::Harvest {
            phase: HarvestPhase::ToDepot,
            ..
        }
    ));

    // When the first two drive out, the third drives in.
    let mut entered = false;
    for _ in 0..30 {
        world.step();
        assert!(aboard_count(&world, depot) <= 2);
        if world.entity(waiting).unwrap().aboard == Some(depot) {
            entered = true;
            break;
        }
    }
    assert!(entered, "the queued truck enters once a slot frees");
}
