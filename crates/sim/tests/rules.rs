//! AC-03-05: Ruleset parsing in the simulation.
//!
//! Committed by tier S (see `specs/03-phase2-core-loop.md` §4.6 and the
//! traceability table §8). The implementer must make this pass without
//! modifying it.

use sim::fixed::{Fx, FxVec2};
use sim::map::MapGrid;
use sim::rules::{Ruleset, fx_centi};
use sim::world::{UNIT_SPEED, World};

/// The spec-fixed fixture (generated format, two-space JSON), §4.6.
fn fixture() -> String {
    include_str!("fixtures/test-rules.json").to_string()
}

#[test]
fn ac_03_05_ruleset_parsing() {
    let text = fixture();

    // The test rules parse with 5 weapons, 13 types, 1 faction and 1 map.
    let rules = Ruleset::from_json(&text).expect("the test fixture must parse");
    assert_eq!(rules.weapons.len(), 5);
    assert_eq!(rules.types.len(), 13);
    assert_eq!(rules.factions.len(), 1);
    assert_eq!(rules.maps.len(), 1);

    // type_index: first match in `types`, None when absent.
    assert_eq!(rules.type_index("tank"), Some(10));
    assert_eq!(rules.type_index("nope"), None);

    // Damage modifier: damage_type 1 (explosive) against armor 0 (soft) == 50.
    assert_eq!(rules.modifier(1, 0), 50);

    // The first Depot type is index 1 (supply-depot).
    assert_eq!(rules.depot_type(), 1);

    // fx_centi fixed-point conversions.
    assert_eq!(fx_centi(500).raw(), 327680);
    assert_eq!(fx_centi(150).raw(), 98304);
    assert_eq!(fx_centi(8).raw(), 5242);

    // Invalid JSON is an error.
    assert!(Ruleset::from_json("not json").is_err());

    // Type 9 (soldier) with `weapon` out of range is rejected, naming the field.
    // (soldier is the only type whose weapon is exactly 0 in the fixture.)
    let weapon_broken = text.replace(r#""weapon": 0"#, r#""weapon": 9"#);
    match Ruleset::from_json(&weapon_broken) {
        Err(ref e) => assert!(e.contains("weapon"), "error should name the field: {e}"),
        Ok(_) => panic!("a weapon index out of range must be rejected"),
    }

    // maxQueue out of range (1..=9) is rejected, naming the field.
    let queue_broken = text.replace(r#""maxQueue": 3"#, r#""maxQueue": 10"#);
    match Ruleset::from_json(&queue_broken) {
        Err(ref e) => assert!(e.contains("maxQueue"), "error should name the field: {e}"),
        Ok(_) => panic!("a maxQueue out of range must be rejected"),
    }

    // The builtin ruleset parses and exposes the real factions, map and types.
    let builtin = Ruleset::builtin();
    assert!(builtin.factions.iter().any(|f| f.id == "ukraine"));
    assert!(builtin.factions.iter().any(|f| f.id == "russia"));
    assert!(builtin.map("first-line").is_some());
    assert!(builtin.type_index("ua-leopard-2a4").is_some());
}

#[test]
fn ac_03_06_phase1_compatibility() {
    let mut world = World::new(MapGrid::open(4, 4));

    // One player: id 0, credits 0.
    assert_eq!(world.players().len(), 1);
    assert_eq!(world.players()[0].id, 0);
    assert_eq!(world.players()[0].credits, 0);

    // The placeholder moves at the Phase 1 unit speed.
    let t = world
        .rules()
        .type_index("tech-slice-placeholder")
        .expect("builtin rules contain the placeholder");
    assert_eq!(world.rules().ty(t).speed_centi, 20);
    assert_eq!(fx_centi(20), UNIT_SPEED);

    // spawn_unit_at spawns a placeholder owned by player 0.
    let id = world.spawn_unit_at(FxVec2::new(Fx::from_raw(98304), Fx::from_raw(98304)));
    let unit = world.unit(id).expect("the spawned unit exists");
    assert_eq!(unit.kind, t);
    assert_eq!(unit.owner, 0);
}

/// AC-11-02: the locomotor table and aim tolerances come from the data (spec 11 §4).
/// Motion-level checks are added once the precomputed profile exists.
#[test]
fn ac_11_02_motion_profile_from_data() {
    let text = include_str!("../../../data/generated/ruleset.json");
    let json: serde_json::Value = serde_json::from_str(text).expect("generated ruleset is JSON");

    let locomotors: Vec<&str> = json["locomotors"]
        .as_array()
        .expect("the ruleset carries a locomotors table")
        .iter()
        .map(|l| l["id"].as_str().expect("locomotor id"))
        .collect();
    assert_eq!(locomotors, ["foot", "tracked", "wheeled"]);

    let locomotor_of = |id: &str| -> &str {
        let index = json["types"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == id)
            .unwrap_or_else(|| panic!("type {id} exists"))["locomotor"]
            .as_i64()
            .expect("locomotor index");
        locomotors[index as usize]
    };
    assert_eq!(locomotor_of("ua-bradley"), "tracked");
    assert_eq!(locomotor_of("ua-supply-truck"), "wheeled");
    assert_eq!(locomotor_of("ua-rifleman"), "foot");

    let aim = |id: &str| -> i64 {
        json["weapons"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["id"] == id)
            .unwrap_or_else(|| panic!("weapon {id} exists"))["aimToleranceDeg"]
            .as_i64()
            .expect("aim tolerance in degrees")
    };
    assert_eq!(aim("ua-rifle"), 15);
    assert_eq!(aim("ua-rh120"), 2);
}
