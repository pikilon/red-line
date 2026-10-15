//! Example saves for native tests (spec 19 §6.3): loads
//! `data/generated/saves/<id>.json` in either form.

use serde_json::Value;
use sim::ai::{Ai, step_with_ai};
use sim::save::{Setup, SimState, from_setup, load_state};
use sim::world::World;

fn generated(path: &str) -> String {
    let full = format!("{}/../../data/generated/{path}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("cannot read {full}: {e}"))
}

/// Ids of every example save, in menu order.
#[allow(dead_code)]
pub fn example_ids() -> Vec<String> {
    let index: Value = serde_json::from_str(&generated("saves.json")).expect("saves.json");
    index["saves"]
        .as_array()
        .expect("saves array")
        .iter()
        .map(|save| save["id"].as_str().expect("id").to_owned())
        .collect()
}

/// The world, seed and AIs of example `id`.
pub fn load_example(id: &str) -> (World, u64, Vec<Ai>) {
    let file: Value =
        serde_json::from_str(&generated(&format!("saves/{id}.json"))).expect("save file");
    if file.get("setup").is_some() {
        let setup: Setup = serde_json::from_value(file["setup"].clone()).expect("setup");
        from_setup(&setup).unwrap_or_else(|e| panic!("{id}: {e}"))
    } else {
        let state: SimState = serde_json::from_value(file["world"].clone()).expect("world");
        load_state(&state).unwrap_or_else(|e| panic!("{id}: {e}"))
    }
}

/// Steps `ticks` times with the AIs; returns the deaths seen.
#[allow(dead_code)]
pub fn run(world: &mut World, ais: &mut [Ai], ticks: u32) -> usize {
    let mut deaths = 0;
    for _ in 0..ticks {
        step_with_ai(world, ais);
        deaths += world
            .events()
            .iter()
            .filter(|event| matches!(event, sim::world::CombatEvent::Death { .. }))
            .count();
    }
    deaths
}
