//! AC-05-05: `World::can_construct` (spec 05 §5.2, §9).
//!
//! Committed in the RED phase (D-08). The implementer must make this pass
//! without modifying it.

use sim::map::{Cell, cell_of};
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

use sim::ai::{AI_THINK_INTERVAL, Ai, BASE_RING_MAX, BASE_RING_MIN};
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

// AC-05-09..AC-05-11: build order, site search, power substitution and resume
// (spec 05 §5.4 step 4, §5.5).
//
// Committed in the RED phase (D-08). The implementer must make these pass
// without modifying them.

/// §5.5 margin: cells at Chebyshev distance 1 around the footprint; every
/// in-bounds one must be passable and hold no unit. Computed independently of
/// the implementation.
fn margin_clear(world: &World, origin: Cell, size: [u16; 2]) -> bool {
    let (width, height) = (i32::from(size[0]), i32::from(size[1]));
    for dy in -1..=height {
        for dx in -1..=width {
            if dx >= 0 && dx < width && dy >= 0 && dy < height {
                continue;
            }
            let candidate = Cell {
                x: origin.x + dx,
                y: origin.y + dy,
            };
            if !world.map().in_bounds(candidate) {
                continue;
            }
            if !world.map().is_passable(candidate) {
                return false;
            }
            if world
                .entities()
                .iter()
                .any(|entity| entity.site.is_none() && cell_of(entity.pos) == candidate)
            {
                return false;
            }
        }
    }
    true
}

/// §5.5 first construction site from `anchor`, recomputed by the test.
fn first_site(world: &World, player: u8, kind: TypeId, anchor: Cell) -> Cell {
    let size = world.rules().ty(kind).footprint;
    for ring in BASE_RING_MIN..=BASE_RING_MAX {
        for y in (anchor.y - ring)..=(anchor.y + ring) {
            let full_row = (y - anchor.y).abs() == ring;
            let step = if full_row { 1 } else { 2 * ring };
            let mut x = anchor.x - ring;
            while x <= anchor.x + ring {
                let origin = Cell { x, y };
                if world.can_construct(player, kind, origin) && margin_clear(world, origin, size) {
                    return origin;
                }
                x += step;
            }
        }
    }
    panic!("no §5.5 site for kind {kind} from anchor {anchor:?}");
}

#[test]
fn ac_05_09_build_order_with_site_search() {
    let mut world = skirmish();
    let power = world.rules().type_index("ua-power-plant").unwrap();
    let supply = world.rules().type_index("ua-supply-center").unwrap();
    let dozer_kind = world.rules().factions[0].dozer;
    let hq_kind = world.rules().factions[0].hq;
    let dozer = world
        .entities()
        .iter()
        .find(|entity| entity.owner == 0 && entity.kind == dozer_kind)
        .map(|entity| entity.id)
        .unwrap();
    let anchor = world
        .entities()
        .iter()
        .find(|entity| entity.owner == 0 && entity.kind == hq_kind)
        .and_then(|entity| entity.site.as_ref().map(|site| site.origin))
        .unwrap();
    let origin = first_site(&world, 0, power, anchor);
    let mut ai = ukraine_ai(&world);

    let commands = ai.think(&world);
    assert!(
        commands.contains(&Command::Construct {
            dozer,
            kind: power,
            origin,
        }),
        "expected Construct of a power plant at {origin:?}, got {commands:?}"
    );

    // Step until the power plant completes, as the acceptance test requires.
    let mut guard = 0;
    loop {
        sim::ai::step_with_ai(&mut world, std::slice::from_mut(&mut ai));
        guard += 1;
        assert!(guard < 3000, "the power plant never completed");
        let complete = world.entities().iter().any(|entity| {
            entity.owner == 0
                && entity.kind == power
                && entity.site.as_ref().is_some_and(|site| site.complete)
        });
        if complete {
            break;
        }
    }

    // Keep stepping through `step_with_ai`: the next building the AI starts
    // must be the supply center, not another power plant.
    let known: Vec<u32> = world
        .entities()
        .iter()
        .filter(|entity| entity.owner == 0 && entity.site.is_some())
        .map(|entity| entity.id)
        .collect();
    let mut next = None;
    for _ in 0..(AI_THINK_INTERVAL * 4) {
        sim::ai::step_with_ai(&mut world, std::slice::from_mut(&mut ai));
        if let Some(entity) = world.entities().iter().find(|entity| {
            entity.owner == 0 && entity.site.is_some() && !known.contains(&entity.id)
        }) {
            next = Some(entity.kind);
            break;
        }
    }
    assert_eq!(
        next,
        Some(supply),
        "expected the next building to be ua-supply-center"
    );
}

#[test]
fn ac_05_10_power_substitution() {
    let mut world = skirmish();
    let power = world.rules().type_index("ua-power-plant").unwrap();
    let supply = world.rules().type_index("ua-supply-center").unwrap();
    let factory = world.rules().type_index("ua-vehicle-factory").unwrap();
    let barracks = world.rules().type_index("ua-barracks").unwrap();
    world.set_credits(0, 10_000);
    // Complete buildings whose power balances: produced 10 (power plant) and
    // consumed 2 + 4 + 4 (supply center and two vehicle factories).
    world.place_building(0, power, cell(18, 64), true);
    world.place_building(0, supply, cell(18, 68), true);
    world.place_building(0, factory, cell(20, 72), true);
    world.place_building(0, factory, cell(26, 72), true);
    // Refresh the derived power totals.
    world.step();

    let (produced, consumed) = world.player(0).unwrap().power();
    assert_eq!(
        produced, consumed,
        "test setup must leave produced == consumed"
    );

    let mut ai = ukraine_ai(&world);
    let commands = ai.think(&world);
    assert!(
        commands
            .iter()
            .any(|command| matches!(command, Command::Construct { kind, .. } if *kind == power)),
        "expected ua-barracks to be replaced by ua-power-plant, got {commands:?}"
    );
    assert!(
        !commands
            .iter()
            .any(|command| matches!(command, Command::Construct { kind, .. } if *kind == barracks)),
        "ua-barracks must not be built while power is negative, got {commands:?}"
    );
}

#[test]
fn ac_05_11_resume_orphan_sites() {
    let mut world = skirmish();
    let barracks = world.rules().type_index("ua-barracks").unwrap();
    let dozer_kind = world.rules().factions[0].dozer;
    let dozer = world
        .entities()
        .iter()
        .find(|entity| entity.owner == 0 && entity.kind == dozer_kind)
        .map(|entity| entity.id)
        .unwrap();
    let site = world.place_building(0, barracks, cell(18, 64), false);
    let mut ai = ukraine_ai(&world);

    let commands = ai.think(&world);
    assert!(
        commands.contains(&Command::Resume {
            units: vec![dozer],
            building: site,
        }),
        "expected Resume of the orphan site {site}, got {commands:?}"
    );
    assert!(
        !commands
            .iter()
            .any(|command| matches!(command, Command::Construct { .. })),
        "expected no Construct while an orphan site exists, got {commands:?}"
    );
}

// AC-05-12..AC-05-14: task forces, launch, retarget and defense
// (spec 05 §5.4 steps 5-8, §5.6).
//
// Committed in the RED phase (D-08). The implementer must make these pass
// without modifying them.

/// §5.6 step 4: footprint centre of the HQ of the first `first-line` start
/// whose index is not `player`. Computed independently of the implementation.
fn enemy_start_center(world: &World, player: u8) -> FxVec2 {
    let map = world.rules().map("first-line").unwrap();
    let index = (0..map.starts.len())
        .find(|&i| i != usize::from(player))
        .unwrap();
    let start = &map.starts[index];
    let hq = world.rules().factions[usize::from(start.faction)].hq;
    sim::nav::footprint_center(
        Cell {
            x: start.hq[0],
            y: start.hq[1],
        },
        world.rules().ty(hq).footprint,
    )
}

fn produces_of(commands: &[Command], building: u32, kind: TypeId) -> usize {
    commands
        .iter()
        .filter(|command| {
            matches!(
                command,
                Command::Produce { building: b, kind: k } if *b == building && *k == kind
            )
        })
        .count()
}

/// The `Move`/`Attack` commands that reference any of `ids`.
fn commands_referencing<'a>(commands: &'a [Command], ids: &[u32]) -> Vec<&'a Command> {
    commands
        .iter()
        .filter(|command| match command {
            Command::Move { units, .. } | Command::Attack { units, .. } => {
                !units.is_empty() && units.iter().any(|id| ids.contains(id))
            }
            _ => false,
        })
        .collect()
}

#[test]
fn ac_05_12_task_force_production() {
    let mut world = skirmish();
    let barracks_kind = world.rules().type_index("ua-barracks").unwrap();
    let rifleman = world.rules().type_index("ua-rifleman").unwrap();
    let stugna = world.rules().type_index("ua-stugna-team").unwrap();
    world.set_credits(0, 10_000);
    let barracks = world.place_building(0, barracks_kind, cell(18, 64), true);
    let mut ai = ukraine_ai(&world);

    let commands = ai.think(&world);
    assert_eq!(
        produces_of(&commands, barracks, rifleman),
        4,
        "expected 4 Produce ua-rifleman at {barracks}, got {commands:?}"
    );
    assert_eq!(
        produces_of(&commands, barracks, stugna),
        2,
        "expected 2 Produce ua-stugna-team at {barracks}, got {commands:?}"
    );

    // A second pass once the queue holds them emits none.
    for command in commands {
        world.enqueue_as(0, command);
    }
    world.step();
    let commands = ai.think(&world);
    assert_eq!(
        produces_of(&commands, barracks, rifleman),
        0,
        "expected no ua-rifleman Produce while queued, got {commands:?}"
    );
    assert_eq!(
        produces_of(&commands, barracks, stugna),
        0,
        "expected no ua-stugna-team Produce while queued, got {commands:?}"
    );
}

#[test]
fn ac_05_13_launch_attack() {
    let mut world = skirmish();
    let barracks_kind = world.rules().type_index("ua-barracks").unwrap();
    let rifleman = world.rules().type_index("ua-rifleman").unwrap();
    let stugna = world.rules().type_index("ua-stugna-team").unwrap();
    world.set_credits(0, 10_000);
    world.place_building(0, barracks_kind, cell(18, 64), true);
    let mut ai = ukraine_ai(&world);
    // The first pass selects `infantry`, the only eligible trigger at tick 0.
    let _ = ai.think(&world);

    // 4 riflemen and 2 Stugna teams idle near the HQ.
    let near = FxVec2::new(fx_centi(1650), fx_centi(6250));
    let mut units = Vec::new();
    for _ in 0..4 {
        units.push(world.spawn(0, rifleman, near));
    }
    for _ in 0..2 {
        units.push(world.spawn(0, stugna, near));
    }

    let target = enemy_start_center(&world, 0);
    let commands = ai.think(&world);
    let launched = commands_referencing(&commands, &units);
    assert_eq!(
        launched.len(),
        1,
        "expected exactly one command for the task force, got {commands:?}"
    );
    assert_eq!(
        launched[0],
        &Command::Move {
            units: units.clone(),
            target,
        },
        "expected a Move to the enemy start HQ centre, got {commands:?}"
    );

    // Once the launch is applied the units are busy, so the next pass leaves
    // them alone.
    for command in commands {
        world.enqueue_as(0, command);
    }
    world.step();
    let commands = ai.think(&world);
    assert!(
        commands_referencing(&commands, &units).is_empty(),
        "expected the launched units to stay uncommanded while busy, got {commands:?}"
    );
}

#[test]
fn ac_05_14_defense() {
    let mut world = skirmish();
    let rifleman = world.rules().type_index("ua-rifleman").unwrap();
    let stugna = world.rules().type_index("ua-stugna-team").unwrap();
    let enemy_kind = world.rules().type_index("ru-rifleman").unwrap();
    let near = FxVec2::new(fx_centi(1650), fx_centi(6250));
    let pool_a = world.spawn(0, rifleman, near);
    let pool_b = world.spawn(0, stugna, near);
    // A visible enemy rifleman within the defense radius of the HQ.
    let enemy = world.spawn(1, enemy_kind, FxVec2::new(fx_centi(1650), fx_centi(6150)));
    world.refresh_visibility();
    assert!(
        world.is_entity_visible(0, enemy),
        "the enemy rifleman must be visible to player 0"
    );
    let mut ai = ukraine_ai(&world);

    let commands = ai.think(&world);
    assert!(
        commands.contains(&Command::Attack {
            units: vec![pool_a, pool_b],
            target: enemy,
        }),
        "expected a defense Attack on {enemy} with the pool, got {commands:?}"
    );
    assert!(
        !commands
            .iter()
            .any(|command| matches!(command, Command::Move { .. })),
        "expected no launch while defending, got {commands:?}"
    );
}
