//! `headless save run|check` (spec 19 §6.1): runs and round-trips save files.

use serde::Serialize;
use serde_json::Value;
use sim::ai::{Ai, step_with_ai};
use sim::hash::state_hash;
use sim::rules::Category;
use sim::save::{Setup, SimState, from_setup, load_state, save_state};
use sim::world::{Outcome, World};

/// Largest tick count `save run` accepts (two hours at 15 Hz).
const MAX_TICKS: u32 = 108_000;

#[derive(Serialize)]
pub struct PlayerReport {
    id: u8,
    credits: u32,
    units: usize,
    buildings: usize,
    power: [u32; 2],
}

#[derive(Serialize)]
pub struct RunReport {
    tick: u32,
    outcome: String,
    hash: String,
    players: Vec<PlayerReport>,
}

/// The result of `save check`: identical, or the first differing pointer.
pub enum Check {
    Same,
    Differs(String),
}

fn read(path: &str) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("invalid save {path}: {e}"))
}

/// World, seed and AIs of a save file in either form.
fn load(file: &Value) -> Result<(World, u64, Vec<Ai>), String> {
    if let Some(setup) = file.get("setup") {
        let setup: Setup =
            serde_json::from_value(setup.clone()).map_err(|e| format!("invalid setup: {e}"))?;
        return from_setup(&setup);
    }
    let world = file
        .get("world")
        .ok_or("not a save file: no world or setup")?;
    let state: SimState =
        serde_json::from_value(world.clone()).map_err(|e| format!("invalid save: {e}"))?;
    load_state(&state)
}

fn state_value(world: &World, seed: u64, ais: &[Ai]) -> Result<Value, String> {
    let state = save_state(world, seed, ais)?;
    serde_json::to_value(state).map_err(|e| e.to_string())
}

fn outcome_text(outcome: Outcome) -> String {
    match outcome {
        Outcome::Ongoing => "ongoing".to_owned(),
        Outcome::Winner(player) => format!("winner:{player}"),
        Outcome::Draw => "draw".to_owned(),
    }
}

/// Loads `path`, steps `ticks` and reports the state.
pub fn run(path: &str, ticks: u32) -> Result<RunReport, String> {
    if ticks > MAX_TICKS {
        return Err(format!("ticks {ticks} out of 0..={MAX_TICKS}"));
    }
    let (mut world, _, mut ais) = load(&read(path)?)?;
    for _ in 0..ticks {
        step_with_ai(&mut world, &mut ais);
    }
    let count = |player: u8, category: Category| {
        world
            .entities()
            .iter()
            .filter(|e| e.owner == player && world.rules().ty(e.kind).category == category)
            .count()
    };
    Ok(RunReport {
        tick: world.tick(),
        outcome: outcome_text(world.outcome()),
        hash: format!("{:016x}", state_hash(&world)),
        players: world
            .players()
            .iter()
            .map(|p| {
                let (produced, consumed) = p.power();
                PlayerReport {
                    id: p.id,
                    credits: p.credits,
                    units: count(p.id, Category::Unit),
                    buildings: count(p.id, Category::Building),
                    power: [produced, consumed],
                }
            })
            .collect(),
    })
}

/// World form: the file's state against `save_state(load_state(file))`.
/// Setup form: the first save against a save of its reload.
pub fn check(path: &str) -> Result<Check, String> {
    let file = read(path)?;
    let (world, seed, ais) = load(&file)?;
    let saved = state_value(&world, seed, &ais)?;
    let expected = match file.get("world") {
        Some(world) => {
            let state: SimState =
                serde_json::from_value(world.clone()).map_err(|e| format!("invalid save: {e}"))?;
            serde_json::to_value(state).map_err(|e| e.to_string())?
        }
        None => {
            let state: SimState =
                serde_json::from_value(saved.clone()).map_err(|e| e.to_string())?;
            let (again, seed, ais) = load_state(&state)?;
            state_value(&again, seed, &ais)?
        }
    };
    Ok(match first_difference(&expected, &saved, String::new()) {
        None => Check::Same,
        Some(pointer) => Check::Differs(pointer),
    })
}

/// JSON pointer of the first difference between `a` and `b`, if any.
fn first_difference(a: &Value, b: &Value, at: String) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let keys: std::collections::BTreeSet<&String> = x.keys().chain(y.keys()).collect();
            keys.into_iter()
                .find_map(|key| match (x.get(key), y.get(key)) {
                    (Some(p), Some(q)) => first_difference(p, q, format!("{at}/{key}")),
                    _ => Some(format!("{at}/{key}")),
                })
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x
            .iter()
            .zip(y)
            .enumerate()
            .find_map(|(i, (p, q))| first_difference(p, q, format!("{at}/{i}"))),
        _ if a == b => None,
        _ => Some(if at.is_empty() { "/".to_owned() } else { at }),
    }
}
