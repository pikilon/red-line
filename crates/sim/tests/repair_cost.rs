//! Spec 38 §3: repairing units and buildings costs credits (AC-38-06..08).

use sim::entity::{EntityId, Order};
use sim::fixed::{Fx, FxVec2};
use sim::map::{Cell, MapGrid};
use sim::rules::Ruleset;
use sim::world::{Command, World};

fn spawn(world: &mut World, id: &str, x: i32, y: i32) -> EntityId {
    let kind = world.rules().type_index(id).unwrap();
    world.spawn(
        0,
        kind,
        FxVec2::new(
            Fx::from_raw(x * 65536 + 32768),
            Fx::from_raw(y * 65536 + 32768),
        ),
    )
}

fn credits(world: &World) -> u32 {
    world.player(0).unwrap().credits
}

fn idle(world: &World, id: EntityId) -> bool {
    matches!(world.entity(id).unwrap().order, Order::Idle { .. })
}

/// A leopard (750 hp, 1200 credits) at half health beside its factory.
fn pad_world(credits: u32) -> (World, EntityId) {
    let mut world = World::sandbox(Ruleset::builtin(), MapGrid::open(40, 24), &[0, 0]);
    let factory = world.place_building(
        0,
        world.rules().type_index("ua-vehicle-factory").unwrap(),
        Cell { x: 10, y: 10 },
        true,
    );
    let tank = spawn(&mut world, "ua-leopard-2a4", 9, 10);
    world.set_hp(tank, 375);
    world.set_credits(0, credits);
    world.enqueue(Command::RepairVehicle {
        units: vec![tank],
        factory,
    });
    (world, tank)
}

#[test]
fn ac_38_06_repairing_half_a_tank_costs_a_quarter_of_its_price() {
    let (mut world, tank) = pad_world(1000);
    let mut last = credits(&world);
    for _ in 0..80 {
        world.step();
        assert!(credits(&world) <= last, "credits only go down");
        last = credits(&world);
    }
    assert_eq!(world.entity(tank).unwrap().hp, 750);
    assert_eq!(credits(&world), 1000 - 300);
}

#[test]
fn ac_38_07_repair_stops_when_funds_run_out() {
    let (mut world, tank) = pad_world(100);
    for _ in 0..80 {
        world.step();
    }
    let hp = world.entity(tank).unwrap().hp;
    assert!(hp > 375 && hp < 750, "only the affordable part is restored");
    assert_eq!(credits(&world), 0);
    assert!(idle(&world, tank));
}

#[test]
fn ac_38_08_dozer_repair_is_paid_and_stops_without_funds() {
    let mut world = World::sandbox(Ruleset::builtin(), MapGrid::open(40, 24), &[0, 0]);
    // Power plant: 1000 hp, 600 credits; half the hp back costs 150.
    let building = world.place_building(
        0,
        world.rules().type_index("ua-power-plant").unwrap(),
        Cell { x: 10, y: 10 },
        true,
    );
    let dozer = spawn(&mut world, "ua-dozer", 8, 10);
    world.set_hp(building, 500);
    world.set_credits(0, 1000);
    world.enqueue(Command::RepairBuilding {
        units: vec![dozer],
        building,
    });
    for _ in 0..2000 {
        world.step();
    }
    assert_eq!(world.entity(building).unwrap().hp, 1000);
    assert_eq!(credits(&world), 1000 - 150);

    world.set_hp(building, 500);
    world.set_credits(0, 0);
    world.enqueue(Command::RepairBuilding {
        units: vec![dozer],
        building,
    });
    for _ in 0..60 {
        world.step();
    }
    // Without credits only the sub-credit rounding slack is restored.
    assert!(world.entity(building).unwrap().hp <= 503);
    assert_eq!(credits(&world), 0);
    assert!(idle(&world, dozer));
}
