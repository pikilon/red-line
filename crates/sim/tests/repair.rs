//! AC-35-01..05: infantry and dozers repair bridges, and workers add up (spec 35).

use sim::entity::{EntityId, Order};
use sim::fixed::{Fx, FxVec2};
use sim::hash::state_hash;
use sim::map::{Cell, MapGrid};
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

fn building_world() -> (World, EntityId, EntityId, EntityId, EntityId) {
    let mut world = World::sandbox(Ruleset::builtin(), MapGrid::open(40, 24), &[0, 0]);
    let building = world.place_building(
        0,
        world.rules().type_index("ua-power-plant").unwrap(),
        Cell { x: 10, y: 10 },
        true,
    );
    let max = world.rules().ty(world.entity(building).unwrap().kind).hp;
    world.set_hp(building, max / 2);
    let first = spawn(&mut world, "ua-dozer", 8, 10);
    let second = spawn(&mut world, "ua-dozer", 8, 11);
    let rifleman = spawn(&mut world, "ua-rifleman", 8, 12);
    (world, building, first, second, rifleman)
}

#[test]
fn ac_38_01_one_dozer_repairs_once_a_second_until_full() {
    let (mut world, building, first, second, rifleman) = building_world();
    let max = world.rules().ty(world.entity(building).unwrap().kind).hp;
    let initial = max / 2;
    let gain = max * 21 / 1000;
    world.enqueue(Command::RepairBuilding {
        units: vec![first, second, rifleman],
        building,
    });
    world.step();
    assert_eq!(world.entity(building).unwrap().hp, initial + gain);
    assert!(matches!(
        world.entity(rifleman).unwrap().order,
        Order::Idle { .. }
    ));
    for _ in 0..14 {
        world.step();
    }
    assert_eq!(world.entity(building).unwrap().hp, initial + gain);
    world.step();
    assert_eq!(world.entity(building).unwrap().hp, initial + gain * 2);
    for _ in 0..2000 {
        if world.entity(building).unwrap().hp == max {
            break;
        }
        world.step();
    }
    assert_eq!(world.entity(building).unwrap().hp, max);
    for id in [first, second] {
        assert!(matches!(
            world.entity(id).unwrap().order,
            Order::Idle { .. }
        ));
    }
}

#[test]
fn ac_38_02_building_repair_rejects_wrong_workers_and_targets() {
    let (mut world, building, first, _, rifleman) = building_world();
    let max = world.rules().ty(world.entity(building).unwrap().kind).hp;
    world.set_hp(building, max);
    let enemy = world.place_building(
        1,
        world.rules().type_index("ua-power-plant").unwrap(),
        Cell { x: 20, y: 10 },
        true,
    );
    world.set_hp(enemy, 1);
    let incomplete = world.place_building(
        0,
        world.rules().type_index("ua-power-plant").unwrap(),
        Cell { x: 25, y: 10 },
        false,
    );
    world.set_hp(incomplete, 1);
    for target in [building, enemy, incomplete] {
        world.enqueue(Command::RepairBuilding {
            units: vec![first],
            building: target,
        });
    }
    world.enqueue(Command::RepairBuilding {
        units: vec![rifleman],
        building: enemy,
    });
    world.step();
    assert!(matches!(
        world.entity(first).unwrap().order,
        Order::Idle { .. }
    ));
    assert!(matches!(
        world.entity(rifleman).unwrap().order,
        Order::Idle { .. }
    ));
    assert_eq!(world.entity(enemy).unwrap().hp, 1);
    assert_eq!(world.entity(incomplete).unwrap().hp, 1);
}

#[test]
fn ac_38_03_building_repair_survives_a_save() {
    let mut world = World::skirmish(Ruleset::builtin(), "demo-ground", 7).unwrap();
    let building = world
        .entities()
        .iter()
        .find(|entity| entity.owner == 0 && entity.site.as_ref().is_some_and(|site| site.complete))
        .expect("complete building")
        .id;
    let dozer = world
        .entities()
        .iter()
        .find(|entity| entity.owner == 0 && !world.rules().ty(entity.kind).builds.is_empty())
        .expect("dozer")
        .id;
    let max = world.rules().ty(world.entity(building).unwrap().kind).hp;
    world.set_hp(building, max / 2);
    world.enqueue(Command::RepairBuilding {
        units: vec![dozer],
        building,
    });
    for _ in 0..30 {
        world.step();
    }
    let saved = save_state(&world, 7, &[]).unwrap();
    let (mut loaded, _, _) = load_state(&saved).unwrap();
    assert_eq!(state_hash(&loaded), state_hash(&world));
    for _ in 0..300 {
        world.step();
        loaded.step();
    }
    assert_eq!(state_hash(&loaded), state_hash(&world));
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
