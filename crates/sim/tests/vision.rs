//! AC-03-11 and AC-03-12: vision phase, fog queries and entity visibility.

use sim::entity::OBSERVER;
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

#[test]
fn ac_03_11_visibility_and_exploration() {
    let mut world = World::sandbox(test_rules(), MapGrid::open(40, 24), &[0, 0]);
    assert_eq!(world.spawn(0, 9, at(1050, 1050)), 0);

    world.step();

    // Sight 6 around (10.5, 10.5).
    assert_eq!(world.fog(0, Cell { x: 16, y: 10 }), 2);
    assert_eq!(world.fog(0, Cell { x: 14, y: 14 }), 2);
    assert_eq!(world.fog(0, Cell { x: 17, y: 10 }), 0);
    assert_eq!(world.fog(0, Cell { x: 15, y: 15 }), 0);
    assert_eq!(world.fog(OBSERVER, Cell { x: 0, y: 0 }), 2);

    // Move to (30.5, 10.5) and run 220 more steps.
    world.enqueue(Command::Move {
        units: vec![0],
        target: at(3050, 1050),
    });
    for _ in 0..220 {
        world.step();
    }

    // (5, 10) was explored on the way, (30, 10) is currently visible and
    // (0, 0) was never seen.
    assert_eq!(world.fog(0, Cell { x: 5, y: 10 }), 1);
    assert_eq!(world.fog(0, Cell { x: 30, y: 10 }), 2);
    assert_eq!(world.fog(0, Cell { x: 0, y: 0 }), 0);
}

#[test]
fn ac_03_12_entity_visibility() {
    let mut world = World::sandbox(test_rules(), MapGrid::open(40, 24), &[0, 0]);
    assert_eq!(world.spawn(0, 9, at(1050, 1050)), 0);
    assert_eq!(world.spawn(1, 7, at(1450, 1050)), 1);
    assert_eq!(world.spawn(1, 7, at(2550, 2050)), 2);
    assert_eq!(world.place_building(1, 3, Cell { x: 30, y: 2 }, true), 3);

    world.step();

    // Player 0 sees dozer 1 (4 tiles away, sight 6) but not dozer 2 or the
    // building far to the east.
    assert!(world.is_entity_visible(0, 1));
    assert!(!world.is_entity_visible(0, 2));
    assert!(!world.is_entity_visible(0, 3));

    // Player 1 sees the soldier four tiles from its dozer.
    assert!(world.is_entity_visible(1, 0));

    // The observer sees everything, and every entity sees its owner.
    assert!(world.is_entity_visible(OBSERVER, 2));
    for entity in world.entities() {
        assert!(
            world.is_entity_visible(entity.owner, entity.id),
            "entity {} is not visible to its owner {}",
            entity.id,
            entity.owner
        );
    }
}
