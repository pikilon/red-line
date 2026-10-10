//! AC-03-41: the skirmish fixture plays a short game through `run_match`.
//!
//! `headless` has no library target, so the test includes `script.rs` directly
//! and shares the crate's dependencies (`sim`, `serde`, `serde_json`).

#[allow(dead_code)]
#[path = "../src/script.rs"]
mod script;

use std::path::PathBuf;

use sim::world::{Outcome, World};

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sim/tests/fixtures/skirmish-script.json")
}

fn load_fixture() -> script::MatchScript {
    let path = fixture_path();
    let text = std::fs::read_to_string(&path).expect("fixture is readable");
    serde_json::from_str(&text).expect("fixture parses as a match script")
}

fn type_id(world: &World, kind: &str) -> u16 {
    world.rules().type_index(kind).expect("known type")
}

fn owns_complete(world: &World, player: u8, kind: &str) -> bool {
    let kind = type_id(world, kind);
    world.entities().iter().any(|entity| {
        entity.owner == player
            && entity.kind == kind
            && entity.site.as_ref().is_some_and(|site| site.complete)
    })
}

fn owns_unit(world: &World, player: u8, kind: &str) -> bool {
    let kind = type_id(world, kind);
    world
        .entities()
        .iter()
        .any(|entity| entity.owner == player && entity.kind == kind)
}

#[test]
fn ac_03_41_skirmish_fixture_plays_a_short_game() {
    let script = load_fixture();
    let world = script::run_match(&script).expect("fixture runs");

    for kind in ["ua-power-plant", "ua-supply-center", "ua-barracks"] {
        assert!(
            owns_complete(&world, 0, kind),
            "player 0 should own a complete {kind}"
        );
    }
    for kind in ["ru-power-plant", "ru-supply-center", "ru-barracks"] {
        assert!(
            owns_complete(&world, 1, kind),
            "player 1 should own a complete {kind}"
        );
    }
    assert!(
        owns_unit(&world, 0, "ua-supply-truck"),
        "player 0 should own a supply truck"
    );
    assert!(
        owns_unit(&world, 1, "ru-supply-truck"),
        "player 1 should own a supply truck"
    );

    // At least one delivery each: 2100 + 300 for player 0, 2160 + 300 for
    // player 1 (starting credits minus buildings and riflemen).
    let credits0 = world.player(0).expect("player 0").credits;
    let credits1 = world.player(1).expect("player 1").credits;
    assert!(credits0 >= 2400, "player 0 credits: {credits0}");
    assert!(credits1 >= 2460, "player 1 credits: {credits1}");

    // Three riflemen per side marched to the ford and fought.
    let ua_rifleman = type_id(&world, "ua-rifleman");
    let ru_rifleman = type_id(&world, "ru-rifleman");
    let remaining = world
        .entities()
        .iter()
        .filter(|entity| entity.kind == ua_rifleman || entity.kind == ru_rifleman)
        .count();
    assert!(remaining < 6, "riflemen remaining: {remaining}");

    assert_eq!(world.outcome(), Outcome::Ongoing);
}
