//! AC-03-07: sandbox helpers, ownership-restricted Move and per-type speed.

use sim::fixed::FxVec2;
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::world::{Command, Order, World};

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
