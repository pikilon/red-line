//! Spec 53: a skirmish's armies are chosen per start, mirror matches included.

use sim::rules::Ruleset;
use sim::save::{Setup, from_setup};
use sim::world::World;

fn armies(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| (*id).to_string()).collect()
}

fn faction_of(world: &World, player: usize) -> String {
    let rules = world.rules();
    rules.factions[usize::from(world.players()[player].faction)]
        .id
        .clone()
}

#[test]
fn ac_53_01_start_takes_the_chosen_faction_hq() {
    let rules = Ruleset::builtin();
    let swapped =
        World::skirmish_armies(rules.clone(), "first-line", &armies(&["russia", "ukraine"]))
            .unwrap();
    assert_eq!(faction_of(&swapped, 0), "russia");
    assert_eq!(faction_of(&swapped, 1), "ukraine");
    let russia_hq = rules.factions.iter().find(|f| f.id == "russia").unwrap().hq;
    let hq0 = swapped
        .entities()
        .iter()
        .find(|e| e.owner == 0 && e.kind == russia_hq);
    assert!(hq0.is_some(), "start 0 places the russian HQ");
}

#[test]
fn ac_53_02_mirror_match_and_defaults() {
    let rules = Ruleset::builtin();
    let mirror = World::skirmish_armies(
        rules.clone(),
        "first-line",
        &armies(&["ukraine", "ukraine"]),
    )
    .unwrap();
    assert_eq!(faction_of(&mirror, 0), "ukraine");
    assert_eq!(faction_of(&mirror, 1), "ukraine");
    let default = World::skirmish_armies(rules.clone(), "first-line", &[]).unwrap();
    let plain = World::skirmish(rules, "first-line", 1).unwrap();
    assert_eq!(
        sim::hash::state_hash(&default),
        sim::hash::state_hash(&plain)
    );
}

#[test]
fn ac_53_03_bad_armies_are_rejected() {
    let rules = Ruleset::builtin();
    assert!(World::skirmish_armies(rules.clone(), "first-line", &armies(&["ukraine"])).is_err());
    assert!(
        World::skirmish_armies(rules, "first-line", &armies(&["ukraine", "atlantis"])).is_err()
    );
}

#[test]
fn ac_53_04_setup_carries_the_armies_and_ai_matches_them() {
    let setup: Setup = serde_json::from_str(
        r#"{"map":"first-line","seed":"1","victory":true,"debug":false,"starts":true,
            "armies":["ukraine","ukraine"],
            "ai":[{"player":1,"personality":"ukraine-balanced","active":true}]}"#,
    )
    .unwrap();
    let (world, _, ais) = from_setup(&setup).unwrap();
    assert_eq!(faction_of(&world, 1), "ukraine");
    assert_eq!(ais.len(), 1);
    // The AI of a russian personality is refused on a ukrainian start.
    let wrong = Setup {
        ai: vec![sim::save::SetupAi {
            player: 1,
            personality: "russia-balanced".into(),
            active: true,
            difficulty: "medium".into(),
        }],
        ..setup
    };
    assert!(from_setup(&wrong).is_err());
}
