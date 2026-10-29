//! AC-36-01..02: a port depot pays supply trucks without running out (spec 36).

use sim::entity::{EntityId, Order};
use sim::rules::{Category, Ruleset};
use sim::world::{Command, World};

fn depot_of(world: &World, id: &str) -> EntityId {
    let kind = world.rules().type_index(id).unwrap();
    world
        .entities()
        .iter()
        .find(|e| e.kind == kind)
        .map(|e| e.id)
        .expect("depot on the map")
}

/// Ticks until the first truck load is paid, and the depot's stock after
/// `ticks`, for a Ukrainian truck harvesting `depot` on demo-coast.
fn harvest(depot_id: &str, ticks: u32) -> (u32, u32, u32) {
    let mut world = World::skirmish(Ruleset::builtin(), "demo-coast", 1).unwrap();
    let center = world.rules().type_index("ua-supply-center").unwrap();
    world.place_building(0, center, sim::map::Cell { x: 20, y: 24 }, true);
    let depot = depot_of(&world, depot_id);
    let truck = world.rules().type_index("ua-supply-truck").unwrap();
    let pos = world.entity(depot).unwrap().pos;
    let truck = world.spawn(
        0,
        truck,
        sim::fixed::FxVec2::new(pos.x, pos.y + sim::fixed::Fx::from_int(3)),
    );
    let stock = world.entity(depot).unwrap().hp;
    let credits = world.player(0).unwrap().credits;
    world.enqueue_as(
        0,
        Command::Harvest {
            units: vec![truck],
            depot,
        },
    );
    let mut first = 0;
    for tick in 0..ticks {
        world.step();
        if first == 0 && world.player(0).unwrap().credits > credits {
            first = tick;
        }
    }
    assert!(matches!(
        world.entity(truck).unwrap().order,
        Order::Harvest { .. }
    ));
    (first, stock, world.entity(depot).unwrap().hp)
}

#[test]
fn ac_36_01_a_port_pays_and_never_runs_out() {
    let ruleset = Ruleset::builtin();
    let port = ruleset.type_index("port-depot").unwrap();
    assert_eq!(ruleset.ty(port).category, Category::Depot);
    assert!(ruleset.ty(port).infinite);
    let (first, before, after) = harvest("port-depot", 3000);
    assert!(first > 0, "the truck brought a load home");
    assert_eq!(before, after, "the port keeps its stock");
}

#[test]
fn ac_36_02_a_supply_depot_still_empties() {
    let (_, before, after) = harvest("supply-depot", 3000);
    assert!(after < before);
}
