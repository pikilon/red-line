//! AC-05-05: `World::can_construct` (spec 05 §5.2, §9).
//!
//! Committed in the RED phase (D-08). The implementer must make this pass
//! without modifying it.

use sim::map::Cell;
use sim::rules::Ruleset;
use sim::world::World;

fn cell(x: i32, y: i32) -> Cell {
    Cell { x, y }
}

#[test]
fn ac_05_05_can_construct() {
    let mut world = World::skirmish(Ruleset::builtin(), "first-line", 1).unwrap();
    let power = world.rules().type_index("ua-power-plant").unwrap();
    let barracks = world.rules().type_index("ua-barracks").unwrap();

    assert!(world.can_construct(0, power, cell(18, 64)));
    // The HQ occupies its own origin.
    assert!(!world.can_construct(0, power, cell(12, 60)));
    // `ua-barracks` requires a power plant, which player 0 does not own yet.
    assert!(!world.can_construct(0, barracks, cell(18, 64)));
    // Far from the start, so still unexplored.
    assert!(!world.can_construct(0, power, cell(100, 60)));

    // No credits: the power plant is unaffordable.
    world.set_credits(0, 0);
    assert!(!world.can_construct(0, power, cell(18, 64)));
}

// AC-05-06..AC-05-08: AI skeleton and economy (spec 05 §5.3, §5.4 steps 1-3).
//
// Committed in the RED phase (D-08). The implementer must make these pass
// without modifying them.

use sim::ai::Ai;
use sim::fixed::FxVec2;
use sim::rules::{TypeId, fx_centi};
use sim::world::Command;

fn skirmish() -> World {
    World::skirmish(Ruleset::builtin(), "first-line", 1).unwrap()
}

fn truck_kind(world: &World) -> TypeId {
    world.rules().type_index("ua-supply-truck").unwrap()
}

fn ukraine_ai(world: &World) -> Ai {
    Ai::new(world, 0, "ukraine-balanced", 1).unwrap()
}

#[test]
fn ac_05_06_ai_new_errors() {
    let world = skirmish();

    assert_eq!(
        Ai::new(&world, 0, "unknown", 1).unwrap_err(),
        "unknown personality unknown"
    );
    assert_eq!(
        Ai::new(&world, 5, "ukraine-balanced", 1).unwrap_err(),
        "unknown player 5"
    );
    assert_eq!(
        Ai::new(&world, 1, "ukraine-balanced", 1).unwrap_err(),
        "personality ukraine-balanced is for faction ukraine, player 1 plays russia"
    );
    assert_eq!(
        Ai::new(&world, 1, "russia-balanced", 1).unwrap().player(),
        1
    );
}

#[test]
fn ac_05_07_idle_trucks_harvest_nearest_depot() {
    let mut world = skirmish();
    // The starting dozer's cell; depot 0 sits at (12, 54).
    let truck = world.spawn(
        0,
        truck_kind(&world),
        FxVec2::new(fx_centi(1850), fx_centi(6150)),
    );
    let mut ai = ukraine_ai(&world);

    let commands = ai.think(&world);
    assert!(
        commands.contains(&Command::Harvest {
            units: vec![truck],
            depot: 0,
        }),
        "expected a Harvest of truck {truck} to depot 0, got {commands:?}"
    );
}

#[test]
fn ac_05_08_trucks_up_to_harvesters() {
    let mut world = skirmish();
    let truck = truck_kind(&world);
    let center = world.rules().type_index("ua-supply-center").unwrap();
    world.set_credits(0, 10_000);
    let supply_center = world.place_building(0, center, cell(18, 64), true);
    let mut ai = ukraine_ai(&world);

    let commands = ai.think(&world);
    let produced: Vec<&Command> = commands
        .iter()
        .filter(|command| {
            matches!(
                command,
                Command::Produce { building, kind }
                    if *building == supply_center && *kind == truck
            )
        })
        .collect();
    assert_eq!(
        produced.len(),
        1,
        "expected exactly one truck Produce at {supply_center}, got {commands:?}"
    );

    // With `harvesters` trucks already present the pass produces none.
    let harvesters = {
        let index = world.rules().ai_index("ukraine-balanced").unwrap();
        world.rules().ai[index].harvesters
    };
    let dozer_pos = FxVec2::new(fx_centi(1850), fx_centi(6150));
    for _ in 0..harvesters {
        world.spawn(0, truck, dozer_pos);
    }
    let mut ai = ukraine_ai(&world);

    let commands = ai.think(&world);
    assert!(
        !commands
            .iter()
            .any(|command| matches!(command, Command::Produce { kind, .. } if *kind == truck)),
        "expected no truck Produce with {harvesters} trucks, got {commands:?}"
    );
}
