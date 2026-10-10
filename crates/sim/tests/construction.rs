//! AC-03-19..AC-03-23: construction by dozers.

use sim::entity::{HarvestPhase, Order};
use sim::fixed::FxVec2;
use sim::map::{Cell, MapGrid, cell_of};
use sim::rules::{Ruleset, fx_centi};
use sim::world::{Command, World};

fn test_rules() -> Ruleset {
    Ruleset::from_json(include_str!("fixtures/test-rules.json")).unwrap()
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn cell(x: i32, y: i32) -> Cell {
    Cell { x, y }
}

fn sandbox(map: MapGrid) -> World {
    let mut world = World::sandbox(test_rules(), map, &[0, 0]);
    world.explore_all(0);
    world
}

/// AC-03-19 setup: explored map for player 0 and a dozer at `(x, y)` centi.
fn with_dozer(x: u32, y: u32) -> (World, u32) {
    let mut world = sandbox(MapGrid::open(40, 24));
    let dozer = world.spawn(0, 7, at(x, y));
    (world, dozer)
}

fn construct(dozer: u32, kind: u16, x: i32, y: i32) -> Command {
    Command::Construct {
        dozer,
        kind,
        origin: cell(x, y),
    }
}

fn steps(world: &mut World, count: u32) {
    for _ in 0..count {
        world.step();
    }
}

fn progress(world: &World, id: u32) -> u32 {
    world.entity(id).unwrap().site.as_ref().unwrap().progress
}

fn complete(world: &World, id: u32) -> bool {
    world.entity(id).unwrap().site.as_ref().unwrap().complete
}

#[test]
fn ac_03_19_construction_progress_and_hit_points() {
    let (mut world, dozer) = with_dozer(950, 650);
    let building = world.next_entity_id();
    world.enqueue(construct(dozer, 3, 10, 6));
    world.step();
    assert_eq!(world.player(0).unwrap().credits, 700);
    let site = world.entity(building).unwrap();
    assert_eq!(site.kind, 3);
    assert!(!complete(&world, building));
    assert_eq!(progress(&world, building), 100);
    assert_eq!(world.entity(building).unwrap().hp, 58);
    assert!(!world.map().is_passable(cell(10, 6)));
    assert_eq!(
        world.entity(dozer).unwrap().order,
        Order::Build {
            order_id: 1,
            building
        }
    );
    steps(&mut world, 9);
    assert_eq!(world.entity(building).unwrap().hp, 220);
    steps(&mut world, 9);
    assert!(!complete(&world, building));
    world.step();
    assert!(complete(&world, building));
    assert_eq!(world.entity(building).unwrap().hp, 400);
    assert_eq!(
        world.entity(dozer).unwrap().order,
        Order::Idle { last_order_id: 1 }
    );
    assert_eq!(world.player(0).unwrap().power(), (0, 0));
    world.step();
    assert_eq!(world.player(0).unwrap().power(), (10, 0));
}

fn assert_rejected(mut world: World, command: Command, as_player: u8, credits: u32, dozer: u32) {
    let entities = world.entities().len();
    world.enqueue_as(as_player, command.clone());
    world.step();
    assert_eq!(world.player(0).unwrap().credits, credits, "{command:?}");
    assert_eq!(world.entities().len(), entities, "{command:?}");
    assert_eq!(
        world.entity(dozer).unwrap().order,
        Order::Idle { last_order_id: 0 },
        "{command:?}"
    );
}

#[test]
fn ac_03_20_placement_validation() {
    let blocked_map = || {
        let mut map = MapGrid::open(40, 24);
        map.set_blocked(cell(30, 5), true);
        map
    };
    let setup = || {
        let mut world = sandbox(blocked_map());
        let dozer = world.spawn(0, 7, at(950, 650));
        (world, dozer)
    };

    let (world, dozer) = setup();
    assert_rejected(world, construct(dozer, 3, 39, 5), 0, 1000, dozer);
    let (world, dozer) = setup();
    assert_rejected(world, construct(dozer, 3, 29, 4), 0, 1000, dozer);
    let (mut world, dozer) = setup();
    world.place_building(0, 3, cell(14, 6), true);
    assert_rejected(world, construct(dozer, 3, 15, 7), 0, 1000, dozer);
    let (mut world, dozer) = setup();
    world.spawn(0, 9, at(2550, 650));
    assert_rejected(world, construct(dozer, 3, 25, 6), 0, 1000, dozer);
    let (mut world, dozer) = setup();
    world.set_credits(0, 299);
    assert_rejected(world, construct(dozer, 3, 10, 6), 0, 299, dozer);
    let (world, dozer) = setup();
    assert_rejected(world, construct(dozer, 2, 10, 6), 0, 1000, dozer);
    let (world, dozer) = setup();
    assert_rejected(world, construct(dozer, 5, 10, 6), 0, 1000, dozer);
    let (mut world, dozer) = setup();
    world.place_building(0, 3, cell(20, 15), false);
    let credits = world.player(0).unwrap().credits;
    assert_rejected(world, construct(dozer, 5, 10, 6), 0, credits, dozer);

    let mut world = World::sandbox(test_rules(), blocked_map(), &[0, 0]);
    let dozer = world.spawn(0, 7, at(950, 650));
    assert_rejected(world, construct(dozer, 3, 10, 6), 0, 1000, dozer);

    let (mut world, _) = setup();
    let foreign = world.spawn(1, 7, at(950, 850));
    assert_rejected(world, construct(foreign, 3, 10, 8), 0, 1000, foreign);
    let (mut world, _) = setup();
    let soldier = world.spawn(0, 9, at(950, 850));
    assert_rejected(world, construct(soldier, 3, 10, 8), 0, 1000, soldier);

    let (mut world, first) = setup();
    let second = world.spawn(0, 7, at(950, 850));
    world.enqueue(construct(first, 3, 10, 6));
    world.enqueue(construct(second, 3, 11, 7));
    world.step();
    assert_eq!(world.player(0).unwrap().credits, 700);
    assert_eq!(
        world.entity(second).unwrap().order,
        Order::Idle { last_order_id: 0 }
    );
}

#[test]
fn ac_03_21_dozer_travels_to_the_site_and_sites_block_paths() {
    let (mut world, dozer) = with_dozer(650, 650);
    let building = world.next_entity_id();
    world.enqueue(construct(dozer, 3, 20, 10));
    world.step();
    let soldier = world.spawn(0, 9, at(1550, 1150));
    world.enqueue(Command::Move {
        units: vec![soldier],
        target: at(2750, 1150),
    });
    let mut done_at = None;
    let mut idle_at = None;
    for tick in 2..=400 {
        world.step();
        let c = cell_of(world.entity(soldier).unwrap().pos);
        assert!(
            !((20..=21).contains(&c.x) && (10..=11).contains(&c.y)),
            "soldier entered the site at tick {tick}"
        );
        if done_at.is_none() && complete(&world, building) {
            done_at = Some(tick);
        }
        if idle_at.is_none() && matches!(world.entity(soldier).unwrap().order, Order::Idle { .. }) {
            idle_at = Some(tick);
        }
    }
    assert!(done_at.unwrap() <= 200, "{done_at:?}");
    assert!(idle_at.is_some());
}

#[test]
fn ac_03_22_stop_and_resume() {
    let (mut world, first) = with_dozer(950, 650);
    let second = world.spawn(0, 7, at(950, 750));
    let foreign = world.spawn(1, 7, at(1050, 950));
    let building = world.next_entity_id();
    world.enqueue(construct(first, 3, 10, 6));
    steps(&mut world, 5);
    assert_eq!(progress(&world, building), 500);

    world.enqueue(Command::Stop { units: vec![first] });
    steps(&mut world, 5);
    assert_eq!(progress(&world, building), 500);
    assert_eq!(
        world.entity(first).unwrap().order,
        Order::Idle { last_order_id: 1 }
    );

    world.enqueue_as(
        1,
        Command::Resume {
            units: vec![foreign],
            building,
        },
    );
    world.step();
    assert_eq!(
        world.entity(foreign).unwrap().order,
        Order::Idle { last_order_id: 0 }
    );
    assert_eq!(progress(&world, building), 500);

    world.enqueue(Command::Resume {
        units: vec![first, second],
        building,
    });
    world.step();
    assert_eq!(progress(&world, building), 600);
    for dozer in [first, second] {
        assert_eq!(
            world.entity(dozer).unwrap().order,
            Order::Build {
                order_id: 2,
                building
            }
        );
    }
    steps(&mut world, 14);
    assert!(complete(&world, building));

    world.enqueue(Command::Resume {
        units: vec![first],
        building,
    });
    world.step();
    assert_eq!(
        world.entity(first).unwrap().order,
        Order::Idle { last_order_id: 2 }
    );
}

#[test]
fn ac_03_23_free_unit_on_completion() {
    let (mut world, dozer) = with_dozer(950, 650);
    let depot = world.place_depot(cell(20, 2), 300);
    let center = world.next_entity_id();
    world.enqueue(construct(dozer, 4, 10, 6));
    steps(&mut world, 30);
    assert!(complete(&world, center));
    assert_eq!(world.player(0).unwrap().credits, 600);
    let truck = world.entity(center + 1).unwrap();
    assert_eq!((truck.kind, truck.owner), (8, 0));
    // Spawned at the exit cell (11, 8) centre, then one harvest step east.
    assert_eq!((truck.pos.x.raw(), truck.pos.y.raw()), (766771, 557056));
    assert_eq!(
        truck.order,
        Order::Harvest {
            order_id: 2,
            depot,
            center: None,
            phase: HarvestPhase::ToDepot,
            timer: 0,
        }
    );
}
