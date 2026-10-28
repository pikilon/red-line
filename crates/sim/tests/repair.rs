//! AC-35-01..05: infantry and dozers repair bridges, and workers add up (spec 35).

use sim::entity::{EntityId, Order};
use sim::fixed::{Fx, FxVec2};
use sim::hash::state_hash;
use sim::map::Cell;
use sim::rules::Ruleset;
use sim::save::{load_state, save_state};
use sim::world::{Command, World};

fn centre(x: i32, y: i32) -> FxVec2 {
    FxVec2::new(
        Fx::from_raw(x * 65536 + 32768),
        Fx::from_raw(y * 65536 + 32768),
    )
}

/// demo-bridges with its first bridge (deck (28, 9)..(35, 10)) broken at 0 hp.
fn broken_bridge() -> (World, u32) {
    let mut world = World::skirmish(Ruleset::builtin(), "demo-bridges", 1).unwrap();
    let bridge = world
        .repair_job_at(Cell { x: 30, y: 9 })
        .expect("bridge deck");
    let hp = world.features()[bridge as usize].hp;
    assert!(world.damage_feature(bridge as usize, hp));
    assert!(world.needs_repair(bridge));
    (world, bridge)
}

fn spawn(world: &mut World, id: &str, x: i32, y: i32) -> EntityId {
    let kind = world.rules().type_index(id).unwrap();
    world.spawn(0, kind, centre(x, y))
}

fn repair(world: &mut World, units: Vec<EntityId>, feature: u32) {
    world.enqueue_as(0, Command::Repair { units, feature });
}

/// Ticks until `feature` is back at full hit points (or `limit`).
fn ticks_to_full(world: &mut World, feature: u32, limit: u32) -> u32 {
    for tick in 0..limit {
        if !world.needs_repair(feature) {
            return tick;
        }
        world.step();
    }
    limit
}

#[test]
fn ac_33_01_infantry_reopen_a_broken_bridge() {
    let (mut world, bridge) = broken_bridge();
    assert!(!world.features()[bridge as usize].alive);
    let units: Vec<EntityId> = (0..3)
        .map(|i| spawn(&mut world, "ua-rifleman", 25, 8 + i))
        .collect();
    repair(&mut world, units.clone(), bridge);
    let ticks = ticks_to_full(&mut world, bridge, 20_000);
    assert!(ticks < 20_000, "the bridge is whole again");
    let row = world.features()[bridge as usize];
    assert!(row.alive);
    assert_eq!(row.state, 0);
    world.step();
    for id in units {
        assert!(matches!(
            world.entity(id).unwrap().order,
            Order::Idle { .. }
        ));
    }
}

#[test]
fn ac_33_02_more_workers_finish_faster_and_a_dozer_counts_triple() {
    let time = |riflemen: i32, dozers: i32| {
        let (mut world, bridge) = broken_bridge();
        let mut units: Vec<EntityId> = (0..riflemen)
            .map(|i| spawn(&mut world, "ua-rifleman", 25, 7 + i))
            .collect();
        units.extend((0..dozers).map(|i| spawn(&mut world, "ua-dozer", 24, 8 + 2 * i)));
        repair(&mut world, units, bridge);
        ticks_to_full(&mut world, bridge, 40_000)
    };
    let one = time(1, 0);
    let three = time(3, 0);
    let dozer = time(0, 1);
    assert!(three < one, "{three} < {one}");
    assert!(dozer < one, "{dozer} < {one}");
    // Workers beyond the cap add nothing.
    assert_eq!(time(6, 0), time(9, 0));
}

#[test]
fn ac_33_03_vehicles_other_than_dozers_and_whole_bridges_take_no_work() {
    let (mut world, bridge) = broken_bridge();
    let tank = spawn(&mut world, "ua-leopard-2a4", 22, 9);
    let rifleman = spawn(&mut world, "ua-rifleman", 25, 9);
    assert!(!world.can_repair(tank, bridge));
    assert!(world.can_repair(rifleman, bridge));
    let other = world.repair_job_at(Cell { x: 30, y: 23 }).unwrap();
    assert!(!world.needs_repair(other), "an intact bridge needs nothing");
}

#[test]
fn ac_33_04_repair_survives_a_save() {
    let (mut world, bridge) = broken_bridge();
    let unit = spawn(&mut world, "ua-rifleman", 25, 9);
    repair(&mut world, vec![unit], bridge);
    for _ in 0..300 {
        world.step();
    }
    let saved = save_state(&world, 1, &[]).unwrap();
    let (mut loaded, _, _) = load_state(&saved).unwrap();
    assert_eq!(state_hash(&loaded), state_hash(&world));
    for _ in 0..300 {
        world.step();
        loaded.step();
    }
    assert_eq!(state_hash(&loaded), state_hash(&world));
}
