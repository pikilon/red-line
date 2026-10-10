//! AC-03-11 and AC-03-12: vision phase, fog queries and entity visibility.

use sim::entity::{Ghost, OBSERVER};
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

#[test]
fn ac_03_35_last_seen_buildings() {
    let mut world = World::sandbox(test_rules(), MapGrid::open(40, 24), &[0, 0]);
    assert_eq!(world.place_building(1, 3, Cell { x: 20, y: 10 }, true), 0);
    assert_eq!(world.spawn(0, 7, at(1650, 1150)), 1);

    // The dozer sees the enemy power plant and remembers it.
    world.step();
    assert!(world.is_entity_visible(0, 0));
    assert_eq!(
        world.player(0).unwrap().ghosts().get(&0),
        Some(&Ghost {
            kind: 3,
            owner: 1,
            origin: Cell { x: 20, y: 10 },
        })
    );

    // Out of sight the entity is hidden but the ghost stays.
    world.enqueue(Command::Move {
        units: vec![1],
        target: at(250, 1150),
    });
    for _ in 0..80 {
        world.step();
    }
    assert!(!world.is_entity_visible(0, 0));
    assert!(world.player(0).unwrap().ghosts().contains_key(&0));

    // Destroyed while unseen: the entity is gone and the ghost stays.
    world.set_hp(0, 0);
    world.step();
    assert!(world.entity(0).is_none());
    assert!(world.player(0).unwrap().ghosts().contains_key(&0));

    // Seen again, the stale ghost is forgotten.
    world.enqueue(Command::Move {
        units: vec![1],
        target: at(1650, 1150),
    });
    for _ in 0..80 {
        world.step();
    }
    assert!(world.player(0).unwrap().ghosts().is_empty());
}

#[test]
fn ac_03_38_fog_encoding_and_filtering() {
    use sim::snapshot::{
        ENTITY_STRIDE, FLAG_GHOST, MATCH_HEADER_LEN, encode_fog, encode_match_snapshot,
    };

    // Entity ids of a match snapshot, in the order it lists them.
    let ids = |snapshot: &[i32]| -> Vec<i32> {
        let count = snapshot[7] as usize;
        (0..count)
            .map(|row| snapshot[MATCH_HEADER_LEN + row * ENTITY_STRIDE])
            .collect()
    };

    // The AC-03-12 world: a player 0 soldier and three player 1 entities.
    let mut world = World::sandbox(test_rules(), MapGrid::open(40, 24), &[0, 0]);
    world.spawn(0, 9, at(1050, 1050));
    world.spawn(1, 7, at(1450, 1050));
    world.spawn(1, 7, at(2550, 2050));
    world.place_building(1, 3, Cell { x: 30, y: 2 }, true);
    world.step();

    let fog = encode_fog(&world, 0);
    assert_eq!(fog.len(), 40 * 24);
    assert_eq!(fog[10 * 40 + 16], 2);
    assert!(encode_fog(&world, OBSERVER).iter().all(|&value| value == 2));

    // Only the own soldier and the enemy dozer four tiles away are visible.
    let player = encode_match_snapshot(&world, 0);
    assert_eq!(ids(&player), vec![0, 1]);
    assert_eq!(player[MATCH_HEADER_LEN + 2 * ENTITY_STRIDE], 0);

    // The observer sees every entity, without credits, power or queues.
    let observer = encode_match_snapshot(&world, OBSERVER);
    assert_eq!(ids(&observer), vec![0, 1, 2, 3]);
    assert_eq!(observer[1], i32::from(OBSERVER));
    assert_eq!(&observer[2..5], &[0, 0, 0]);
    assert_eq!(observer[MATCH_HEADER_LEN + 4 * ENTITY_STRIDE], 0);

    // The AC-03-35 world once the dozer left: the destroyed power plant is a
    // ghost drawn at its footprint centre, without hit points or target.
    let mut world = World::sandbox(test_rules(), MapGrid::open(40, 24), &[0, 0]);
    assert_eq!(world.place_building(1, 3, Cell { x: 20, y: 10 }, true), 0);
    assert_eq!(world.spawn(0, 7, at(1650, 1150)), 1);
    world.step();
    world.enqueue(Command::Move {
        units: vec![1],
        target: at(250, 1150),
    });
    for _ in 0..80 {
        world.step();
    }
    assert!(!world.is_entity_visible(0, 0));

    let snapshot = encode_match_snapshot(&world, 0);
    assert_eq!(ids(&snapshot), vec![0, 1]);
    assert_eq!(
        &snapshot[MATCH_HEADER_LEN..MATCH_HEADER_LEN + ENTITY_STRIDE],
        &[0, 1, 3, 1376256, 720896, -1, FLAG_GHOST, 0, -1]
    );
}
