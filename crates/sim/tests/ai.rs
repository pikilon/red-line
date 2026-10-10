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
