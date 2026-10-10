//! Command scripts: a seed, a unit count, a tick budget and timed move orders.
//! Match scripts drive a full skirmish with per-player commands.

use sim::fixed::{Fx, FxVec2};
use sim::hash::state_hash;
use sim::map::Cell;
use sim::rules::Ruleset;
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchScript {
    pub seed: u32,
    pub map: String,
    pub ticks: u32,
    pub commands: Vec<MatchScriptCommand>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchScriptCommand {
    pub tick: u32,
    pub player: u8,
    pub command: ScriptOrder,
}

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ScriptOrder {
    Move {
        units: Vec<u32>,
        target: [i32; 2],
    },
    Attack {
        units: Vec<u32>,
        target: u32,
    },
    Harvest {
        units: Vec<u32>,
        depot: u32,
    },
    Construct {
        dozer: u32,
        kind: String,
        origin: [i32; 2],
    },
    Resume {
        units: Vec<u32>,
        building: u32,
    },
    Produce {
        building: u32,
        kind: String,
    },
    Cancel {
        building: u32,
    },
    Rally {
        building: u32,
        target: [i32; 2],
    },
    Stop {
        units: Vec<u32>,
    },
}

/// Raw tile coordinates: `FxVec2::new(Fx::from_raw(x), Fx::from_raw(y))`.
fn raw_position(target: [i32; 2]) -> FxVec2 {
    FxVec2::new(Fx::from_raw(target[0]), Fx::from_raw(target[1]))
}

fn type_id(rules: &Ruleset, kind: &str) -> Result<u16, String> {
    rules
        .type_index(kind)
        .ok_or_else(|| format!("unknown type {kind}"))
}

/// Translates a scripted order into the world command it drives.
fn to_command(rules: &Ruleset, order: &ScriptOrder) -> Result<Command, String> {
    Ok(match order {
        ScriptOrder::Move { units, target } => Command::Move {
            units: units.clone(),
            target: raw_position(*target),
        },
        ScriptOrder::Attack { units, target } => Command::Attack {
            units: units.clone(),
            target: *target,
        },
        ScriptOrder::Harvest { units, depot } => Command::Harvest {
            units: units.clone(),
            depot: *depot,
        },
        ScriptOrder::Construct {
            dozer,
            kind,
            origin,
        } => Command::Construct {
            dozer: *dozer,
            kind: type_id(rules, kind)?,
            origin: Cell {
                x: origin[0],
                y: origin[1],
            },
        },
        ScriptOrder::Resume { units, building } => Command::Resume {
            units: units.clone(),
            building: *building,
        },
        ScriptOrder::Produce { building, kind } => Command::Produce {
            building: *building,
            kind: type_id(rules, kind)?,
        },
        ScriptOrder::Cancel { building } => Command::Cancel {
            building: *building,
        },
        ScriptOrder::Rally { building, target } => Command::Rally {
            building: *building,
            target: raw_position(*target),
        },
        ScriptOrder::Stop { units } => Command::Stop {
            units: units.clone(),
        },
    })
}

/// `World::skirmish(Ruleset::builtin(), &map, seed)`; for `t in 0..ticks`
/// enqueues as `player` (in file order) every command with `tick == t`, then
/// steps. Returns the world.
pub fn run_match(script: &MatchScript) -> Result<World, String> {
    let mut world = match World::skirmish(Ruleset::builtin(), &script.map, u64::from(script.seed)) {
        Ok(world) => world,
        Err(SimError::UnknownMap { id }) => return Err(format!("unknown map: {id}")),
        Err(error) => return Err(format!("cannot set up the match: {error:?}")),
    };
    for t in 0..script.ticks {
        for command in script.commands.iter().filter(|c| c.tick == t) {
            let order = to_command(world.rules(), &command.command)?;
            world.enqueue_as(command.player, order);
        }
        world.step();
    }
    Ok(world)
}

/// `state_hash` of `run_match`.
pub fn run_match_script(script: &MatchScript) -> Result<u64, String> {
    Ok(state_hash(&run_match(script)?))
}
