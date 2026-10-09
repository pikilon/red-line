//! Command scripts: a seed, a unit count, a tick budget and timed move orders.

use sim::fixed::{Fx, FxVec2};
use sim::hash::state_hash;
use sim::world::{Command, SimError, World};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Script {
    pub seed: u32,
    pub units: u32,
    pub ticks: u32,
    pub commands: Vec<ScriptCommand>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScriptCommand {
    pub tick: u32,
    pub unit_range: [u32; 2],
    pub target: [i32; 2],
}

/// Builds `World::tech_slice(seed, units)`; for `t in 0..ticks` enqueues (in
/// file order) every command with `tick == t` as a move of
/// `unit_range[0]..unit_range[1]`, then steps. Returns the state hash.
pub fn run_script(script: &Script) -> Result<u64, SimError> {
    let mut world = World::tech_slice(u64::from(script.seed), script.units)?;
    for t in 0..script.ticks {
        for command in script.commands.iter().filter(|c| c.tick == t) {
            world.enqueue(Command::Move {
                units: (command.unit_range[0]..command.unit_range[1]).collect(),
                target: FxVec2::new(
                    Fx::from_raw(command.target[0]),
                    Fx::from_raw(command.target[1]),
                ),
            });
        }
        world.step();
    }
    Ok(state_hash(&world))
}
