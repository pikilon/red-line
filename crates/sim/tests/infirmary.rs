//! AC-40-01..06: damaged infantry heal inside an own barracks (spec 40).

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

/// An open sandbox with one complete barracks at (10, 10)..(12, 12).
fn sandbox() -> (World, EntityId) {
    let mut world = World::sandbox(Ruleset::builtin(), MapGrid::open(40, 24), &[0, 0]);
    let barracks = world.place_building(
        0,
        world.rules().type_index("ua-barracks").unwrap(),
        Cell { x: 10, y: 10 },
        true,
    );
    (world, barracks)
}

fn spawn(world: &mut World, id: &str, x: i32, y: i32) -> EntityId {
    let kind = world.rules().type_index(id).unwrap();
    world.spawn(0, kind, centre(x, y))
}

fn max_hp(world: &World, id: EntityId) -> u32 {
    world.rules().ty(world.entity(id).unwrap().kind).hp
}

fn step_until_aboard(world: &mut World, id: EntityId, limit: u32) -> bool {
    for _ in 0..limit {
        world.step();
        if world.entity(id).unwrap().aboard.is_some() {
            return true;
        }
    }
    false
}

#[test]
fn ac_40_01_patient_heals_and_leaves_after_thirty_ticks() {
    let (mut world, barracks) = sandbox();
    let patient = spawn(&mut world, "ua-rifleman", 8, 11);
    let max = max_hp(&world, patient);
    world.set_hp(patient, max / 2);
    world.enqueue(Command::HealAt {
        units: vec![patient],
        building: barracks,
    });
    assert!(step_until_aboard(&mut world, patient, 60));
    for _ in 0..10 {
        world.step();
    }
    let mid = world.entity(patient).unwrap();
    assert!(mid.hp > max / 2 && mid.hp < max, "healing is gradual");
    assert!(mid.aboard.is_some(), "still inside the barracks");

    for _ in 0..30 {
        world.step();
        if world.entity(patient).unwrap().aboard.is_none() {
            break;
        }
    }
    let done = world.entity(patient).unwrap();
    assert_eq!(done.hp, max, "the patient is whole");
    assert!(done.aboard.is_none(), "and leaves automatically");
    assert!(matches!(done.order, Order::Idle { .. }));
}

#[test]
fn ac_40_02_full_health_wrong_units_and_wrong_buildings_are_rejected() {
    let (mut world, barracks) = sandbox();
    let hq = world.place_building(
        0,
        world.rules().type_index("ua-hq").unwrap(),
        Cell { x: 20, y: 10 },
        true,
    );
    let incomplete = world.place_building(
        0,
        world.rules().type_index("ua-barracks").unwrap(),
        Cell { x: 20, y: 16 },
        false,
    );
    let enemy_pad = world.place_building(
        1,
        world.rules().type_index("ua-barracks").unwrap(),
        Cell { x: 30, y: 10 },
        true,
    );
    let full = spawn(&mut world, "ua-rifleman", 8, 10);
    let tank = spawn(&mut world, "ua-leopard-2a4", 8, 11);
    let patient = spawn(&mut world, "ua-rifleman", 8, 12);
    world.set_hp(tank, max_hp(&world, tank) / 2);
    world.set_hp(patient, max_hp(&world, patient) / 2);
    assert!(
        !world.can_heal_at(full, barracks),
        "full health never enters"
    );
    assert!(!world.can_heal_at(tank, barracks), "vehicles never heal");
    assert!(!world.can_heal_at(patient, hq), "the HQ is no infirmary");
    assert!(!world.can_heal_at(patient, incomplete));
    assert!(!world.can_heal_at(patient, enemy_pad), "own building only");
    world.enqueue(Command::HealAt {
        units: vec![full, tank],
        building: barracks,
    });
    world.step();
    assert!(matches!(
        world.entity(full).unwrap().order,
        Order::Idle { .. }
    ));
    assert!(matches!(
        world.entity(tank).unwrap().order,
        Order::Idle { .. }
    ));
}

#[test]
fn ac_40_03_at_most_ten_patients_per_barracks() {
    let (mut world, barracks) = sandbox();
    let spots = [
        (8, 8),
        (9, 8),
        (10, 8),
        (11, 8),
        (12, 8),
        (13, 8),
        (8, 9),
        (13, 9),
        (8, 10),
        (13, 10),
        (8, 11),
        (13, 11),
    ];
    let mut patients = Vec::new();
    for (x, y) in spots {
        let id = spawn(&mut world, "ua-rifleman", x, y);
        world.set_hp(id, max_hp(&world, id) / 2);
        patients.push(id);
    }
    world.enqueue(Command::HealAt {
        units: patients.clone(),
        building: barracks,
    });
    for _ in 0..120 {
        world.step();
        if world.patients(barracks).len() == 10 {
            break;
        }
    }
    assert_eq!(world.patients(barracks).len(), 10);
    assert_eq!(world.infirmary_def().unwrap().slots, 10);
    let outside = patients
        .iter()
        .copied()
        .find(|id| world.entity(*id).unwrap().aboard.is_none())
        .expect("two patients wait outside");
    assert!(
        !world.can_heal_at(outside, barracks),
        "the barracks is full"
    );
}

#[test]
fn ac_40_04_healing_survives_a_save() {
    let mut world = World::skirmish(Ruleset::builtin(), "first-line", 9).unwrap();
    let barracks = world.place_building(
        0,
        world.rules().type_index("ua-barracks").unwrap(),
        Cell { x: 12, y: 66 },
        true,
    );
    let patient = spawn(&mut world, "ua-rifleman", 10, 66);
    let max = max_hp(&world, patient);
    world.set_hp(patient, max / 2);
    world.enqueue(Command::HealAt {
        units: vec![patient],
        building: barracks,
    });
    assert!(step_until_aboard(&mut world, patient, 60));
    for _ in 0..5 {
        world.step();
    }
    let saved = save_state(&world, 9, &[]).unwrap();
    let (mut loaded, _, _) = load_state(&saved).unwrap();
    assert_eq!(state_hash(&loaded), state_hash(&world));
    for _ in 0..100 {
        world.step();
        loaded.step();
    }
    assert_eq!(state_hash(&loaded), state_hash(&world));
    assert_eq!(world.entity(patient).unwrap().hp, max);
    assert_eq!(loaded.entity(patient).unwrap().hp, max);
    assert!(world.entity(patient).unwrap().aboard.is_none());
    assert!(loaded.entity(patient).unwrap().aboard.is_none());
}

#[test]
fn ac_40_05_production_continues_while_infantry_heal() {
    let (mut world, barracks) = sandbox();
    let patient = spawn(&mut world, "ua-rifleman", 8, 11);
    let max = max_hp(&world, patient);
    world.set_hp(patient, max / 2);
    let produced = world
        .rules()
        .ty(world.entity(barracks).unwrap().kind)
        .produces[0];
    world.enqueue(Command::Produce {
        building: barracks,
        kind: produced,
    });
    world.enqueue(Command::HealAt {
        units: vec![patient],
        building: barracks,
    });
    assert!(step_until_aboard(&mut world, patient, 60));
    for _ in 0..10 {
        world.step();
    }
    let progress = world.entity(barracks).unwrap().site.as_ref().unwrap().queue[0].progress;
    assert!(progress > 0, "production advances during healing");
    for _ in 0..40 {
        world.step();
    }
    assert_eq!(world.entity(patient).unwrap().hp, max);
    assert!(world.entity(patient).unwrap().aboard.is_none());
}

#[test]
fn ac_40_06_a_destroyed_barracks_ejects_its_patients() {
    let (mut world, barracks) = sandbox();
    let patient = spawn(&mut world, "ua-rifleman", 8, 11);
    let max = max_hp(&world, patient);
    world.set_hp(patient, max / 2);
    world.enqueue(Command::HealAt {
        units: vec![patient],
        building: barracks,
    });
    assert!(step_until_aboard(&mut world, patient, 60));
    let hp = world.entity(patient).unwrap().hp;
    world.set_hp(barracks, 0);
    world.step();
    let ejected = world.entity(patient).unwrap();
    assert!(ejected.aboard.is_none(), "the patient leaves the wreck");
    assert_eq!(ejected.hp, hp, "ejecting deals no damage");
    assert!(matches!(ejected.order, Order::Idle { .. }));
    assert!(world.entity(barracks).is_none());
    assert!(world.patients(barracks).is_empty());
}
