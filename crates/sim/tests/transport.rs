//! AC-34-01..07: infantry riding vehicles (spec 34).

use sim::entity::{EntityId, Order};
use sim::fixed::{Fx, FxVec2};
use sim::hash::state_hash;
use sim::map::{MapGrid, cell_of};
use sim::rules::{Ruleset, TypeId};
use sim::save::{load_state, save_state};
use sim::snapshot::{FLAG_ABOARD, FLAG_INSIDE, encode_match_snapshot};
use sim::world::{Command, World};

fn centre(x: i32, y: i32) -> FxVec2 {
    FxVec2::new(
        Fx::from_raw(x * 65536 + 32768),
        Fx::from_raw(y * 65536 + 32768),
    )
}

fn sandbox(armed: bool) -> World {
    let mut rules = Ruleset::builtin();
    if !armed {
        for ty in &mut rules.types {
            ty.weapon = -1;
        }
    }
    World::sandbox(rules, MapGrid::open(40, 40), &[0, 1])
}

fn kind(world: &World, id: &str) -> TypeId {
    world.rules().type_index(id).expect("builtin type exists")
}

fn spawn(world: &mut World, owner: u8, id: &str, x: i32, y: i32) -> EntityId {
    let kind = kind(world, id);
    world.spawn(owner, kind, centre(x, y))
}

fn run(world: &mut World, ticks: u32) {
    for _ in 0..ticks {
        world.step();
    }
}

/// A Bradley of player 0 at (20, 20) with `riders` riflemen boarded.
fn loaded_bradley(world: &mut World, riders: u32) -> (EntityId, Vec<EntityId>) {
    let bradley = spawn(world, 0, "ua-bradley", 20, 20);
    let units: Vec<EntityId> = (0..riders)
        .map(|i| {
            spawn(
                world,
                0,
                "ua-rifleman",
                14 + (i as i32 % 4),
                18 + (i as i32 / 4),
            )
        })
        .collect();
    world.enqueue_as(
        0,
        Command::Board {
            units: units.clone(),
            carrier: bradley,
        },
    );
    run(world, 200);
    (bradley, units)
}

#[test]
fn ac_32_01_infantry_walk_to_the_vehicle_and_board_it() {
    let mut world = sandbox(false);
    let (bradley, units) = loaded_bradley(&mut world, 3);
    assert_eq!(world.riders(bradley), units);
    for &id in &units {
        let rider = world.entity(id).unwrap();
        assert_eq!(rider.aboard, Some(bradley));
        assert!(matches!(rider.order, Order::Idle { .. }));
    }
}

#[test]
fn ac_32_02_only_own_free_infantry_fit_and_slots_limit_them() {
    let mut world = sandbox(false);
    let bradley = spawn(&mut world, 0, "ua-bradley", 20, 20);
    let tank = spawn(&mut world, 0, "ua-leopard-2a4", 10, 10);
    let foe = spawn(&mut world, 1, "ru-rifleman", 22, 22);
    let mine = spawn(&mut world, 0, "ua-rifleman", 18, 20);
    assert!(world.can_board(mine, bradley));
    assert!(!world.can_board(tank, bradley), "vehicles do not ride");
    assert!(!world.can_board(foe, bradley), "enemies do not board");
    assert!(!world.can_board(mine, tank), "a tank carries nobody");

    let slots = world.transport_def(bradley).unwrap().slots;
    let units: Vec<EntityId> = (0..slots + 2)
        .map(|i| spawn(&mut world, 0, "ua-rifleman", 10 + i as i32, 25))
        .collect();
    world.enqueue_as(
        0,
        Command::Board {
            units,
            carrier: bradley,
        },
    );
    run(&mut world, 300);
    assert_eq!(world.riders(bradley).len() as u32, slots);
}

#[test]
fn ac_32_03_riders_move_with_the_vehicle_and_are_hidden_from_the_enemy() {
    let mut world = sandbox(false);
    let (bradley, units) = loaded_bradley(&mut world, 2);
    world.enqueue_as(
        0,
        Command::Move {
            units: vec![bradley],
            target: centre(30, 30),
        },
    );
    run(&mut world, 200);
    let vehicle = world.entity(bradley).unwrap().pos;
    assert_eq!(cell_of(vehicle), cell_of(centre(30, 30)));
    assert!(
        units
            .iter()
            .all(|&id| world.entity(id).unwrap().pos == vehicle)
    );

    spawn(&mut world, 1, "ru-rifleman", 31, 31);
    world.refresh_visibility();
    let rows = |viewer: u8| {
        let snapshot = encode_match_snapshot(&world, viewer);
        let count = snapshot[7] as usize;
        (0..count)
            .map(|i| {
                (
                    snapshot[8 + i * 11],
                    snapshot[8 + i * 11 + 6],
                    snapshot[8 + i * 11 + 7],
                )
            })
            .collect::<Vec<_>>()
    };
    let own = rows(0);
    let rider = own.iter().find(|row| row.0 == units[0] as i32).unwrap();
    assert_eq!(
        rider.1 & (FLAG_INSIDE | FLAG_ABOARD),
        FLAG_INSIDE | FLAG_ABOARD
    );
    assert_eq!(rider.2, bradley as i32, "progress holds the vehicle id");
    assert!(rows(1).iter().all(|row| row.0 != units[0] as i32));
}

#[test]
fn ac_32_04_disembark_lets_riders_out_one_at_a_time() {
    let mut world = sandbox(false);
    let (bradley, units) = loaded_bradley(&mut world, 3);
    let exit_ticks = world.transport_def(bradley).unwrap().exit_ticks;
    world.enqueue_as(0, Command::Disembark { carrier: bradley });
    run(&mut world, 1);
    assert_eq!(world.riders(bradley).len(), 2, "the first leaves at once");
    run(&mut world, exit_ticks);
    assert_eq!(
        world.riders(bradley).len(),
        2,
        "the next waits the exit delay"
    );
    run(&mut world, 1);
    assert_eq!(world.riders(bradley).len(), 1);
    run(&mut world, exit_ticks + 1);
    assert!(world.riders(bradley).is_empty());
    assert!(world.entity(bradley).unwrap().unloading.is_none());
    for &id in &units {
        let unit = world.entity(id).unwrap();
        assert_eq!(unit.aboard, None);
        assert_ne!(
            cell_of(unit.pos),
            cell_of(world.entity(bradley).unwrap().pos)
        );
    }
}

#[test]
fn ac_32_05_only_vehicles_with_fire_ports_let_riders_shoot() {
    for (vehicle, fires) in [("ua-kozak-scout", true), ("ua-bradley", false)] {
        let mut rules = Ruleset::builtin();
        // Unarmed vehicles: only a rider's rifle can hurt the target.
        let car = rules.type_index(vehicle).unwrap();
        rules.types[car as usize].weapon = -1;
        let mut world = World::sandbox(rules, MapGrid::open(40, 40), &[0, 1]);
        let carrier = spawn(&mut world, 0, vehicle, 20, 20);
        let rider = spawn(&mut world, 0, "ua-rifleman", 18, 20);
        world.enqueue_as(
            0,
            Command::Board {
                units: vec![rider],
                carrier,
            },
        );
        run(&mut world, 60);
        assert_eq!(world.entity(rider).unwrap().aboard, Some(carrier));
        let rifleman = kind(&world, "ru-rifleman");
        let target = world.spawn(1, rifleman, centre(23, 20));
        let rules_hp = world.rules().ty(rifleman).hp;
        world.set_hp(target, rules_hp);
        let hp = world.entity(target).unwrap().hp;
        run(&mut world, 60);
        let hurt = world.entity(target).is_none_or(|e| e.hp < hp);
        assert_eq!(hurt, fires, "{vehicle}");
    }
}

#[test]
fn ac_32_06_a_destroyed_vehicle_kills_or_ejects_its_riders() {
    // Bradley: 10% damage, survivors thrown out.
    let mut world = sandbox(false);
    let (bradley, units) = loaded_bradley(&mut world, 2);
    let max = world.entity(units[0]).unwrap().hp;
    world.set_hp(bradley, 0);
    run(&mut world, 1);
    assert!(world.entity(bradley).is_none());
    for &id in &units {
        let unit = world.entity(id).expect("survives");
        assert_eq!(unit.aboard, None);
        assert_eq!(unit.hp, max - max / 10);
    }

    // Kozak: 100% damage, riders die with it.
    let mut world = sandbox(false);
    let kozak = spawn(&mut world, 0, "ua-kozak-scout", 20, 20);
    let rider = spawn(&mut world, 0, "ua-rifleman", 18, 20);
    world.enqueue_as(
        0,
        Command::Board {
            units: vec![rider],
            carrier: kozak,
        },
    );
    run(&mut world, 60);
    assert_eq!(world.entity(rider).unwrap().aboard, Some(kozak));
    world.set_hp(kozak, 0);
    run(&mut world, 1);
    assert!(world.entity(rider).is_none());
}

#[test]
fn ac_32_07_riders_change_the_hash_and_survive_a_save() {
    // A save needs a map id: the open demo-ground skirmish.
    let mut world = World::skirmish(Ruleset::builtin(), "demo-ground", 7).unwrap();
    let before = state_hash(&world);
    let (bradley, units) = loaded_bradley(&mut world, 2);
    world.enqueue_as(0, Command::Disembark { carrier: bradley });
    run(&mut world, 1);
    let after = state_hash(&world);
    assert_ne!(before, after);
    let saved = save_state(&world, 7, &[]).unwrap();
    let (mut loaded, _, _) = load_state(&saved).unwrap();
    assert_eq!(state_hash(&loaded), after);
    assert_eq!(loaded.entity(units[1]).unwrap().aboard, Some(bradley));
    assert!(loaded.entity(bradley).unwrap().unloading.is_some());
    run(&mut world, 20);
    run(&mut loaded, 20);
    assert_eq!(state_hash(&loaded), state_hash(&world));
}
