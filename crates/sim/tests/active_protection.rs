//! Spec 54 §5.1: the Abrams active protection destroys a missile in flight,
//! reloads, and ignores shells.

use sim::fixed::FxVec2;
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::world::{CombatEvent, World};

fn at(x: u32, y: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x), fx_centi(y))
}

#[test]
fn ac_54_01_missiles_are_stopped_one_at_a_time_then_again_after_reload() {
    let rules = Ruleset::builtin();
    let abrams = rules.type_index("us-abrams").unwrap();
    let javelin = rules.type_index("ru-defense").unwrap();
    let reload = rules
        .ty(abrams)
        .active_protection
        .as_ref()
        .unwrap()
        .reload_ticks;
    let mut world = World::sandbox(rules, MapGrid::open(60, 40), &[0, 1]);
    let tank = world.spawn(0, abrams, at(1000, 1000));
    world.place_building(1, javelin, Cell { x: 19, y: 9 }, true);
    let plant = world.rules().type_index("ru-power-plant").unwrap();
    world.place_building(1, plant, Cell { x: 40, y: 30 }, true);
    let full = world.entity(tank).unwrap().hp;

    let mut stopped = Vec::new();
    let mut hits = Vec::new();
    for tick in 0..(reload + 400) {
        world.step();
        for event in world.events() {
            if let CombatEvent::Detonate { hit, .. } = event {
                if hit.is_some() {
                    hits.push(tick);
                } else {
                    stopped.push(tick);
                }
            }
        }
        if stopped.len() == 1 && hits.is_empty() {
            assert_eq!(
                world.entity(tank).unwrap().hp,
                full,
                "first missile does no damage"
            );
        }
    }
    assert!(
        !stopped.is_empty() && !hits.is_empty(),
        "{stopped:?} {hits:?}"
    );
    assert!(
        stopped[0] < hits[0],
        "the first missile is stopped, the next one hits"
    );
    assert!(world.entity(tank).unwrap().hp < full);
    assert!(
        stopped.iter().any(|t| *t >= stopped[0] + reload),
        "after the reload it stops one again: {stopped:?}"
    );
}

#[test]
fn ac_54_02_shells_are_not_stopped() {
    let rules = Ruleset::builtin();
    let abrams = rules.type_index("us-abrams").unwrap();
    let mut world = World::sandbox(rules, MapGrid::open(60, 40), &[0, 1]);
    let victim = world.spawn(0, abrams, at(1000, 1000));
    world.spawn(1, abrams, at(1500, 1000));
    let full = world.entity(victim).unwrap().hp;
    for _ in 0..120 {
        world.step();
    }
    assert!(world.entity(victim).unwrap().hp < full);
}
