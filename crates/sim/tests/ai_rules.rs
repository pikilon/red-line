//! AC-05-03/AC-05-04: AI definitions in the ruleset (spec 05 §5.1, §9).
//!
//! Committed in the RED phase (D-08). The implementer must make this pass
//! without modifying it.

use sim::rules::Ruleset;

/// The generated ruleset text, exactly as `Ruleset::builtin` embeds it.
fn builtin_json() -> String {
    include_str!("../../../data/generated/ruleset.json").to_string()
}

#[test]
fn ac_05_03_ai_definitions_parse() {
    let rules = Ruleset::builtin();

    // Four builtin personalities, indexed by first-match id order.
    assert_eq!(rules.ai.len(), 4);
    assert_eq!(rules.ai_index("russia-rush"), Some(3));
    assert_eq!(rules.ai_index("nope"), None);

    // `ukraine-balanced`: first build-order item and first task force.
    let balanced = rules
        .ai
        .iter()
        .find(|ai| ai.id == "ukraine-balanced")
        .expect("ukraine-balanced must exist");
    assert_eq!(
        balanced.build_order.first().copied(),
        rules.type_index("ua-power-plant")
    );
    let infantry = rules.type_index("ua-rifleman").expect("ua-rifleman exists");
    let stugna = rules
        .type_index("ua-stugna-team")
        .expect("ua-stugna-team exists");
    assert_eq!(
        balanced
            .task_forces
            .first()
            .map(|force| force.units.clone()),
        Some(vec![(infantry, 4), (stugna, 2)])
    );
}

#[test]
fn ac_05_04_ai_definitions_validate() {
    let base: serde_json::Value =
        serde_json::from_str(&builtin_json()).expect("the builtin ruleset is JSON");

    let check = |edit: fn(&mut serde_json::Value), expected: &str| {
        let mut value = base.clone();
        edit(&mut value);
        match Ruleset::from_json(&value.to_string()) {
            Err(message) => assert_eq!(message, expected),
            Ok(_) => panic!("a mutated ruleset must be rejected with: {expected}"),
        }
    };

    check(
        |v| v["ai"][0]["faction"] = serde_json::json!(99),
        "ai[0].faction out of range",
    );
    // 2 is `ua-rifleman`, a unit, not a building.
    check(
        |v| v["ai"][0]["buildOrder"][0] = serde_json::json!(2),
        "ai[0].buildOrder[0] out of range",
    );
    check(
        |v| v["ai"][0]["taskForces"][0]["units"][0][1] = serde_json::json!(0),
        "ai[0].taskForces[0].units out of range",
    );
    check(
        |v| v["ai"][0]["triggers"][0]["taskForce"] = serde_json::json!(99),
        "ai[0].triggers[0].taskForce out of range",
    );
    check(
        |v| v["ai"][0]["triggers"][0]["weight"] = serde_json::json!(0),
        "ai[0].triggers[0].weight out of range",
    );
}
