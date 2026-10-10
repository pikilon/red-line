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
