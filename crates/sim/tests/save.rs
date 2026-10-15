//! AC-19-04..06: world save state round trip, continuity and load errors
//! (spec 19 §3.1–§3.4, traceability §10).
//!
//! Committed in the RED phase (D-08). The implementer must make these pass
//! without modifying them.

use std::collections::BTreeMap;

use serde_json::Value;
use sim::ai::{Ai, step_with_ai};
use sim::entity::OBSERVER;
use sim::hash::state_hash;
use sim::rules::Ruleset;
use sim::save::{SAVE_FORMAT_VERSION, SimState, load_state, save_state};
use sim::snapshot::{encode_combat, encode_fog, encode_match_snapshot_with_shots};
use sim::world::{Command, World};

const SEED: u64 = 1;

/// `first-line` skirmish with `ukraine-balanced` on player 0 and
/// `russia-balanced` on player 1.
fn ai_match() -> (World, Vec<Ai>) {
    let world = World::skirmish(Ruleset::builtin(), "first-line", SEED).unwrap();
    let ais = vec![
        Ai::new(&world, 0, "ukraine-balanced", SEED).unwrap(),
        Ai::new(&world, 1, "russia-balanced", SEED).unwrap(),
    ];
    (world, ais)
}

fn advance_to(world: &mut World, ais: &mut [Ai], tick: u32) {
    while world.tick() < tick {
        step_with_ai(world, ais);
    }
}

fn save_json(world: &World, seed: u64, ais: &[Ai]) -> String {
    let state = save_state(world, seed, ais).expect("skirmish worlds can be saved");
    serde_json::to_string(&state).expect("state serializes")
}

fn load_json(json: &str) -> Result<(World, u64, Vec<Ai>), String> {
    let state: SimState = serde_json::from_str(json).map_err(|e| e.to_string())?;
    load_state(&state)
}

#[test]
fn ac_19_04_round_trip() {
    let (mut world, mut ais) = ai_match();
    for tick in [0, 1000, 3000] {
        advance_to(&mut world, &mut ais, tick);
        let first = save_json(&world, SEED, &ais);
        let (loaded, seed, loaded_ais) = load_json(&first).expect("a saved state loads");
        assert_eq!(seed, SEED);
        let second = save_json(&loaded, seed, &loaded_ais);
        assert_eq!(first, second, "round trip differs at tick {tick}");
    }
}

/// State hash, match snapshots (players 0, 1, observer), fog (players 0, 1)
/// and the observer's combat snapshot.
type Observation = (String, Vec<Vec<i32>>, Vec<Vec<u8>>, Vec<i32>);

/// A mutation of a saved state and the load error it must produce.
type ErrorCase = (Box<dyn Fn(&mut Value)>, String);

/// Everything a client can observe after a step, for both players and the
/// observer (spec 19 AC-19-05).
fn observe(world: &World) -> Observation {
    let shots = BTreeMap::new();
    let snapshots = [0, 1, OBSERVER]
        .iter()
        .map(|&viewer| encode_match_snapshot_with_shots(world, viewer, &shots))
        .collect();
    let fog = [0, 1]
        .iter()
        .map(|&viewer| encode_fog(world, viewer))
        .collect();
    let combat = encode_combat(world, OBSERVER, world.events());
    (
        format!("{:016x}", state_hash(world)),
        snapshots,
        fog,
        combat,
    )
}

#[test]
fn ac_19_05_continuity() {
    let (mut world, mut ais) = ai_match();
    advance_to(&mut world, &mut ais, 2000);
    // From tick 2000, the first tick with a projectile in flight.
    while world.projectiles().is_empty() {
        assert!(world.tick() < 4000, "no projectile in flight by tick 4000");
        step_with_ai(&mut world, &mut ais);
    }
    // A pending command, enqueued after the last step.
    let unit = world
        .entities()
        .iter()
        .find(|e| e.owner == 0 && e.site.is_none())
        .expect("player 0 has a unit")
        .id;
    world.enqueue_as(0, Command::Stop { units: vec![unit] });

    let json = save_json(&world, SEED, &ais);
    let (mut loaded, seed, mut loaded_ais) = load_json(&json).expect("a saved state loads");
    assert_eq!(seed, SEED);
    assert_eq!(
        observe(&loaded).0,
        observe(&world).0,
        "hash right after load"
    );
    assert_eq!(
        observe(&loaded).2,
        observe(&world).2,
        "fog right after load"
    );

    for step in 1..=900 {
        step_with_ai(&mut world, &mut ais);
        step_with_ai(&mut loaded, &mut loaded_ais);
        if step % 100 == 0 {
            assert_eq!(
                observe(&loaded),
                observe(&world),
                "diverged {step} ticks after load (tick {})",
                world.tick()
            );
        }
    }
}

/// A saved first-line state at tick 1000 as JSON, with at least one entity
/// carrying `lastHit` for the weapon case.
fn saved_value() -> Value {
    let (mut world, mut ais) = ai_match();
    advance_to(&mut world, &mut ais, 1000);
    serde_json::from_str(&save_json(&world, SEED, &ais)).unwrap()
}

fn load_error(value: &Value) -> String {
    match load_json(&value.to_string()) {
        Ok(_) => panic!("expected a load error"),
        Err(error) => error,
    }
}

#[test]
fn ac_19_06_load_errors() {
    let base = saved_value();
    let cells = 128 * 128;
    assert_eq!(base["formatVersion"], SAVE_FORMAT_VERSION);

    let cases: Vec<ErrorCase> = vec![
        (
            Box::new(|v| v["formatVersion"] = 7.into()),
            "invalid save: unsupported format version 7".into(),
        ),
        (
            Box::new(|v| v["mapId"] = "x".into()),
            "invalid save: unknown map: x".into(),
        ),
        (
            Box::new(|v| v["entities"][0]["kind"] = "x".into()),
            "invalid save: unknown type: x".into(),
        ),
        (
            Box::new(|v| {
                v["entities"][0]["lastHit"] = serde_json::json!({ "shooter": 0, "weapon": "x" });
            }),
            "invalid save: unknown weapon: x".into(),
        ),
        (
            Box::new(|v| v["players"][0]["faction"] = "x".into()),
            "invalid save: unknown faction: x".into(),
        ),
        (
            Box::new(|v| v["ais"][0]["personality"] = "x".into()),
            "invalid save: unknown ai: x".into(),
        ),
        (
            Box::new(|v| v["players"][0]["explored"] = serde_json::json!([12])),
            format!("invalid save: explored length 12 != {cells} cells"),
        ),
        (
            Box::new(|v| v["players"][0]["visible"] = serde_json::json!([12])),
            format!("invalid save: visible length 12 != {cells} cells"),
        ),
        (
            Box::new(|v| {
                let first = v["entities"][0]["id"].clone();
                v["entities"][1]["id"] = first;
            }),
            "invalid save: duplicate entity id 0".into(),
        ),
    ];
    for (alter, expected) in cases {
        let mut value = base.clone();
        alter(&mut value);
        assert_eq!(load_error(&value), expected);
    }

    let tech = World::tech_slice(SEED, 10).unwrap();
    assert_eq!(
        save_state(&tech, SEED, &[]).unwrap_err(),
        "save unsupported: world has no map id"
    );
}
