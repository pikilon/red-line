//! AC-05-17: AI think cadence (spec 05 §5.3, §5.4, §9).
//!
//! Committed in the RED phase (D-08). The implementer must make this pass
//! without modifying it.

use sim::ai::{AI_THINK_INTERVAL, Ai, step_with_ai};
use sim::fixed::FxVec2;
use sim::rules::{Ruleset, fx_centi};
use sim::world::World;

#[test]
fn ac_05_17_think_cadence() {
    let mut world = World::skirmish(Ruleset::builtin(), "first-line", 1).unwrap();
    let truck = world.rules().type_index("ua-supply-truck").unwrap();
    let mut ais = [Ai::new(&world, 0, "ukraine-balanced", 1).unwrap()];

    // Move off tick 0 so no pass has run yet, then leave an idle truck: its
    // Harvest command is the only order-id consumer in this window.
    world.step();
    assert_eq!(world.tick(), 1);
    world.spawn(0, truck, FxVec2::new(fx_centi(1850), fx_centi(6150)));
    let before = world.next_order_id();

    // No pass between intervals: no new order id.
    for _ in 1..AI_THINK_INTERVAL {
        step_with_ai(&mut world, &mut ais);
        assert_eq!(world.next_order_id(), before);
    }
    assert_eq!(world.tick(), AI_THINK_INTERVAL);

    // The pass on the interval commands the idle truck.
    step_with_ai(&mut world, &mut ais);
    let after = world.next_order_id();
    assert!(
        after > before,
        "expected a command on tick {AI_THINK_INTERVAL}"
    );

    // ... and the following non-multiples stay quiet again.
    for _ in 1..AI_THINK_INTERVAL {
        step_with_ai(&mut world, &mut ais);
        assert_eq!(world.next_order_id(), after);
    }
}

// AC-05-15 and AC-05-16: full matches (spec 05 §5.3, §5.4, §9).
//
// Committed in the RED phase (D-08). The implementer must make these pass
// without modifying them.

use sim::hash::state_hash;
use sim::world::Outcome;

/// The full-match tick budget of AC-05-15 (spec 05 §8).
const MAX_TICKS: u32 = 27_000;

/// `first-line` skirmish used by both full-match criteria.
fn skirmish(seed: u64) -> World {
    World::skirmish(Ruleset::builtin(), "first-line", seed).unwrap()
}

#[test]
fn ac_05_15_ai_beats_passive_opponent() {
    // `ukraine-balanced` on its own start (player 0) against a passive
    // player 1 wins before the tick budget.
    let mut world = skirmish(1);
    let mut ais = [Ai::new(&world, 0, "ukraine-balanced", 1).unwrap()];
    while world.tick() < MAX_TICKS && world.outcome() == Outcome::Ongoing {
        step_with_ai(&mut world, &mut ais);
    }
    assert!(
        world.tick() < MAX_TICKS,
        "the match hit the tick budget without a winner"
    );
    assert_eq!(
        world.outcome(),
        Outcome::Winner(0),
        "ukraine-balanced must beat a passive player 1"
    );

    // `russia-balanced` on its own start (player 1) against a passive player 0.
    let mut world = skirmish(1);
    let mut ais = [Ai::new(&world, 1, "russia-balanced", 1).unwrap()];
    while world.tick() < MAX_TICKS && world.outcome() == Outcome::Ongoing {
        step_with_ai(&mut world, &mut ais);
    }
    assert!(
        world.tick() < MAX_TICKS,
        "the match hit the tick budget without a winner"
    );
    assert_eq!(
        world.outcome(),
        Outcome::Winner(1),
        "russia-balanced must beat a passive player 0"
    );
}

/// Runs `ukraine-balanced` (player 0) against `russia-balanced` (player 1) with
/// `seed` for 9000 ticks and returns the state hash (AC-05-16).
fn run_ai_vs_ai(seed: u64) -> u64 {
    let mut world = skirmish(seed);
    let mut ais = [
        Ai::new(&world, 0, "ukraine-balanced", seed).unwrap(),
        Ai::new(&world, 1, "russia-balanced", seed).unwrap(),
    ];
    while world.tick() < 9000 {
        step_with_ai(&mut world, &mut ais);
    }
    state_hash(&world)
}

#[test]
fn ac_05_16_ai_vs_ai_is_deterministic() {
    let seed_7_first = run_ai_vs_ai(7);
    let seed_7_second = run_ai_vs_ai(7);
    assert_eq!(
        seed_7_first, seed_7_second,
        "two seed-7 AI vs AI runs must reach the same state hash at tick 9000"
    );

    let seed_8 = run_ai_vs_ai(8);
    assert_ne!(
        seed_7_first, seed_8,
        "seed 8 must differ from seed 7 at tick 9000"
    );
}
