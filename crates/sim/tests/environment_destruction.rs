//! Spec 31 block 1: the `environment-destruction` example save plays out as the
//! owner expects (bushes flattened, grove burning, buildings in rubble, bridge
//! broken) and replays to the same hash.

mod common;

use common::saves::{load_example, run};
use sim::hash::state_hash;
use sim::world::World;

fn ids(world: &World, wanted: &str) -> Vec<(u32, u8, bool)> {
    world
        .features()
        .iter()
        .filter(|row| world.rules().feature_types[row.kind as usize].id == wanted)
        .map(|row| (row.hp, row.state, row.alive))
        .collect()
}

fn play(ticks: u32) -> World {
    let (mut world, _, mut ais) = load_example("environment-destruction");
    run(&mut world, &mut ais, ticks);
    world
}

#[test]
fn the_demo_flattens_burns_collapses_and_breaks() {
    let (start, _, _) = load_example("environment-destruction");
    let bushes = ids(&start, "bush").len();
    let pines = ids(&start, "pine").len();
    assert!(bushes >= 5 && pines >= 10);

    let world = play(900);
    // The tank on the lane flattened the bushes and fences next to it.
    let lane_bushes = world
        .features()
        .iter()
        .filter(|row| row.y == 7 && world.rules().feature_types[row.kind as usize].id == "bush")
        .count();
    assert!(lane_bushes > 0);
    assert!(
        world
            .features()
            .iter()
            .filter(|row| row.y == 7 && world.rules().feature_types[row.kind as usize].id == "bush")
            .all(|row| !row.alive),
        "the lane bushes are flattened"
    );
    assert!(
        ids(&world, "fence").iter().all(|&(_, _, alive)| !alive),
        "the fences are flattened"
    );
    // The grove burned: stumps stand where pines were.
    assert!(
        ids(&world, "tree-stump").len() >= 3,
        "the fire felled several pines"
    );
    // Both buildings collapsed into rubble.
    assert!(ids(&world, "house-small").is_empty());
    assert!(ids(&world, "shop").is_empty());
    assert_eq!(ids(&world, "rubble-2x2").len(), 2);
    // The bridge is broken.
    let bridge = ids(&world, "wooden-bridge");
    assert!(bridge.iter().all(|&(_, state, alive)| state >= 2 || !alive));
}

#[test]
fn the_demo_replays_to_the_same_hash() {
    assert_eq!(state_hash(&play(700)), state_hash(&play(700)));
}
