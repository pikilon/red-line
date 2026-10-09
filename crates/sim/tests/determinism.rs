use sim::fixed::{Fx, FxVec2};
use sim::hash::{fnv1a64, state_hash};
use sim::map::MapGrid;
use sim::snapshot::encode_snapshot;
use sim::world::{Command, World};

fn raw(x: i32, y: i32) -> FxVec2 {
    FxVec2::new(Fx::from_raw(x), Fx::from_raw(y))
}

fn range(start: u32, end: u32) -> Vec<u32> {
    (start..end).collect()
}

/// Mirrors `crates/sim/tests/fixtures/tech-slice-script.json`.
fn run_script(seed: u64) -> World {
    let mut world = World::tech_slice(seed, 500).unwrap();
    for tick in 0..600 {
        if tick == 0 {
            world.enqueue(Command::Move {
                units: range(0, 250),
                target: raw(6586368, 1343488),
            });
            world.enqueue(Command::Move {
                units: range(250, 500),
                target: raw(6586368, 6586368),
            });
        }
        if tick == 300 {
            world.enqueue(Command::Move {
                units: range(0, 100),
                target: raw(1343488, 6586368),
            });
        }
        world.step();
    }
    world
}

#[test]
fn ac_02_19_same_seed_same_hash() {
    let a = run_script(42);
    let b = run_script(42);
    assert_eq!(state_hash(&a), state_hash(&b));
    let c = run_script(43);
    assert_ne!(state_hash(&a), state_hash(&c));
}

#[test]
fn ac_02_20_hash_definition() {
    assert_eq!(fnv1a64(b""), 0xcbf29ce484222325);
    assert_eq!(fnv1a64(b"a"), 0xaf63dc4c8601ec8c);

    let mut slice = World::tech_slice(42, 10).unwrap();
    let before = state_hash(&slice);
    slice.enqueue(Command::Move {
        units: vec![0],
        target: raw(6586368, 1343488),
    });
    slice.step();
    assert_ne!(state_hash(&slice), before);
}

#[test]
fn ac_02_21_snapshot_layout() {
    let mut world = World::new(MapGrid::open(8, 8));
    world.spawn_unit_at(raw(98304, 98304));
    world.spawn_unit_at(raw(163840, 163840));
    world.enqueue(Command::Move {
        units: vec![1],
        target: raw(425984, 163840),
    });
    world.step();
    assert_eq!(
        encode_snapshot(&world),
        vec![1, 2, 0, 98304, 98304, 0, 1, 176947, 163840, 1]
    );
}

/// World of AC-03-08: an open 4 x 4 map with one placeholder unit at (2.5, 2.5)
/// and a pending move to (0.5, 3.5).
fn hash_v2_world() -> World {
    let mut world = World::new(MapGrid::open(4, 4));
    world.spawn_unit_at(raw(163840, 163840));
    world.enqueue(Command::Move {
        units: vec![0],
        target: raw(32768, 229376),
    });
    world
}

#[test]
fn ac_03_08_state_hash_v2() {
    let empty = World::new(MapGrid::open(4, 4));
    let bytes: [u8; 39] = [
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 255, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    assert_eq!(state_hash(&empty), fnv1a64(&bytes));

    let mut a = hash_v2_world();
    let before = state_hash(&a);
    a.step();
    assert_ne!(state_hash(&a), before);

    let mut a = hash_v2_world();
    let mut b = hash_v2_world();
    for _ in 0..100 {
        a.step();
        b.step();
    }
    assert_eq!(state_hash(&a), state_hash(&b));
}
