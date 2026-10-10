//! AC-03-07: sandbox helpers, ownership-restricted Move and per-type speed.

use sim::fixed::FxVec2;
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::world::{Command, Order, Outcome, SimError, World};

fn test_rules() -> Ruleset {
    Ruleset::from_json(include_str!("fixtures/test-rules.json")).unwrap()
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

#[test]
fn ac_03_07_sandbox_ownership_and_speed() {
    let mut world = World::sandbox(test_rules(), MapGrid::open(16, 16), &[0, 0]);
    assert_eq!(world.spawn(0, 9, at(250, 250)), 0);
    assert_eq!(world.spawn(1, 9, at(1250, 250)), 1);
    assert_eq!(world.place_building(0, 3, Cell { x: 5, y: 5 }, true), 2);

    world.enqueue_as(
        1,
        Command::Move {
            units: vec![0, 1, 2],
            target: at(1250, 1250),
        },
    );
    world.step();

    // Player 1 cannot order player 0's unit or building.
    assert_eq!(
        world.entity(0).unwrap().order,
        Order::Idle { last_order_id: 0 }
    );
    assert_eq!(
        world.entity(2).unwrap().order,
        Order::Idle { last_order_id: 0 }
    );

    // Entity 1 moved one soldier step (fx_centi(10) = 6553).
    let e1 = world.entity(1).unwrap();
    assert!(matches!(e1.order, Order::Move { order_id: 1, .. }));
    assert_eq!((e1.pos.x.raw(), e1.pos.y.raw()), (819200, 170393));

    let e2 = world.entity(2).unwrap();
    assert_eq!(e2.hp, 400);
    let site = e2.site.as_ref().expect("a building has a site");
    assert!(site.complete);
    assert_eq!(site.origin, Cell { x: 5, y: 5 });
    assert_eq!((e2.pos.x.raw(), e2.pos.y.raw()), (393216, 393216));
    assert_eq!(world.next_entity_id(), 3);

    // enqueue is enqueue_as(0, ..): player 0 moves its own unit.
    world.enqueue(Command::Move {
        units: vec![0],
        target: at(1250, 1250),
    });
    world.step();
    assert!(matches!(world.entity(0).unwrap().order, Order::Move { .. }));
}

#[test]
fn ac_03_09_skirmish_setup() {
    let world = World::skirmish(test_rules(), "test-field", 1).unwrap();

    // Two players, both faction 0 (`alpha`), starting credits.
    assert_eq!(world.players().len(), 2);
    for player in world.players() {
        assert_eq!(player.credits, 1000);
        assert_eq!(player.faction, 0);
    }

    // Entities in normative id order: depots, then per start HQ and dozer.
    let depot0 = world.entity(0).unwrap();
    assert_eq!(depot0.kind, 1);
    assert_eq!(depot0.owner, 255);
    assert_eq!(depot0.hp, 300);
    assert_eq!((depot0.pos.x.raw(), depot0.pos.y.raw()), (589824, 327680));

    let depot1 = world.entity(1).unwrap();
    assert_eq!(depot1.kind, 1);
    assert_eq!(depot1.owner, 255);
    assert_eq!((depot1.pos.x.raw(), depot1.pos.y.raw()), (2031616, 1245184));

    let hq0 = world.entity(2).unwrap();
    assert_eq!(hq0.kind, 2);
    assert_eq!(hq0.owner, 0);
    assert_eq!(hq0.hp, 1000);
    assert!(hq0.site.as_ref().unwrap().complete);
    assert_eq!((hq0.pos.x.raw(), hq0.pos.y.raw()), (229376, 753664));

    let dozer0 = world.entity(3).unwrap();
    assert_eq!(dozer0.kind, 7);
    assert_eq!(dozer0.owner, 0);
    assert_eq!((dozer0.pos.x.raw(), dozer0.pos.y.raw()), (425984, 753664));

    let hq1 = world.entity(4).unwrap();
    assert_eq!(hq1.kind, 2);
    assert_eq!(hq1.owner, 1);
    assert_eq!(hq1.site.as_ref().unwrap().origin, Cell { x: 35, y: 11 });
    assert_eq!((hq1.pos.x.raw(), hq1.pos.y.raw()), (2392064, 819200));

    let dozer1 = world.entity(5).unwrap();
    assert_eq!(dozer1.kind, 7);
    assert_eq!(dozer1.owner, 1);
    assert_eq!((dozer1.pos.x.raw(), dozer1.pos.y.raw()), (2195456, 819200));

    assert_eq!(world.next_entity_id(), 6);

    // Navigation blocks footprints and the terrain rectangle.
    for cell in [
        Cell { x: 2, y: 10 },
        Cell { x: 4, y: 12 },
        Cell { x: 8, y: 4 },
        Cell { x: 9, y: 5 },
        Cell { x: 19, y: 6 },
    ] {
        assert!(!world.map().is_passable(cell), "nav should block {cell:?}");
    }
    assert!(!world.terrain().is_passable(Cell { x: 19, y: 6 }));
    assert!(world.terrain().is_passable(Cell { x: 2, y: 10 }));
    assert!(world.terrain().is_passable(Cell { x: 8, y: 4 }));

    assert_eq!(world.outcome(), Outcome::Ongoing);

    // Initial visibility from the owned entities.
    assert_eq!(world.fog(0, Cell { x: 3, y: 11 }), 2);
    assert_eq!(world.fog(0, Cell { x: 36, y: 12 }), 0);

    match World::skirmish(test_rules(), "nope", 1) {
        Ok(_) => panic!("an unknown map must fail"),
        Err(error) => assert_eq!(error, SimError::UnknownMap { id: "nope".into() }),
    }
}
