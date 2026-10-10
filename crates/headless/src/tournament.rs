//! Headless `match` and `tournament` subcommands (spec 05 §6).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sim::ai::{Ai, step_with_ai};
use sim::entity::EntityId;
use sim::hash::state_hash;
use sim::rules::Ruleset;
use sim::world::{Outcome, SimError, World};

/// Owner and build cost of a live entity, keyed by id.
type Snapshot = BTreeMap<EntityId, (u8, u32)>;

/// One headless match: winner (player id), final tick, the summed cost each
/// player lost and the final state hash.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReport {
    pub winner: Option<u8>,
    pub ticks: u32,
    pub lost: [u32; 2],
    pub hash: String,
}

/// `World::skirmish` entities keyed by id, for loss accounting.
fn snapshot(world: &World) -> Snapshot {
    world
        .entities()
        .iter()
        .map(|entity| {
            (
                entity.id,
                (entity.owner, world.rules().ty(entity.kind).cost),
            )
        })
        .collect()
}

/// Builds `first-line`-style skirmish `map` at `seed`, attaches `ai0` to player
/// 0 and `ai1` to player 1 (unless a name is `none`) and steps with
/// `step_with_ai` until the outcome is not `Ongoing` or `max_ticks` is reached.
pub fn run_match(
    map: &str,
    seed: u32,
    max_ticks: u32,
    ai0: &str,
    ai1: &str,
) -> Result<MatchReport, String> {
    let mut world =
        World::skirmish(Ruleset::builtin(), map, u64::from(seed)).map_err(|error| match error {
            SimError::UnknownMap { id } => format!("unknown map: {id}"),
            other => format!("cannot set up the match: {other:?}"),
        })?;
    let mut ais = Vec::new();
    for (player, name) in [(0u8, ai0), (1u8, ai1)] {
        if name != "none" {
            ais.push(Ai::new(&world, player, name, u64::from(seed))?);
        }
    }
    let mut lost = [0u32; 2];
    let mut previous = snapshot(&world);
    while world.outcome() == Outcome::Ongoing && world.tick() < max_ticks {
        step_with_ai(&mut world, &mut ais);
        let current = snapshot(&world);
        for (id, (owner, cost)) in &previous {
            if !current.contains_key(id) {
                lost[usize::from(*owner)] += cost;
            }
        }
        previous = current;
    }
    let winner = match world.outcome() {
        Outcome::Winner(player) => Some(player),
        Outcome::Ongoing | Outcome::Draw => None,
    };
    Ok(MatchReport {
        winner,
        ticks: world.tick(),
        lost,
        hash: format!("{:016x}", state_hash(&world)),
    })
}

/// A tournament configuration file (`§6`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TournamentConfig {
    pub map: String,
    pub max_ticks: u32,
    pub seeds: Vec<u32>,
    pub ai0: Vec<String>,
    pub ai1: Vec<String>,
}

/// One played match inside a tournament report.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentMatch {
    pub ai0: String,
    pub ai1: String,
    pub seed: u32,
    pub winner: Option<u8>,
    pub ticks: u32,
    pub lost: [u32; 2],
}

/// Aggregated results for one `(ai0, ai1)` pair.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentSummary {
    pub ai0: String,
    pub ai1: String,
    pub games: u32,
    pub wins0: u32,
    pub wins1: u32,
    pub draws: u32,
    pub avg_ticks: u32,
    pub lost0: u32,
    pub lost1: u32,
}

/// A tournament report (`§6`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentReport {
    pub matches: Vec<TournamentMatch>,
    pub summary: Vec<TournamentSummary>,
}

/// Plays every `ai0 × ai1 × seeds` match (that nesting order) and aggregates
/// the summary in the same pair order.
pub fn run_tournament(config: &TournamentConfig) -> Result<TournamentReport, String> {
    let mut matches = Vec::new();
    let mut summary = Vec::new();
    for ai0 in &config.ai0 {
        for ai1 in &config.ai1 {
            let mut games = 0u32;
            let mut wins0 = 0u32;
            let mut wins1 = 0u32;
            let mut draws = 0u32;
            let mut total_ticks = 0u32;
            let mut lost0 = 0u32;
            let mut lost1 = 0u32;
            for seed in &config.seeds {
                let report = run_match(&config.map, *seed, config.max_ticks, ai0, ai1)?;
                match report.winner {
                    Some(0) => wins0 += 1,
                    Some(1) => wins1 += 1,
                    _ => draws += 1,
                }
                games += 1;
                total_ticks += report.ticks;
                lost0 += report.lost[0];
                lost1 += report.lost[1];
                matches.push(TournamentMatch {
                    ai0: ai0.clone(),
                    ai1: ai1.clone(),
                    seed: *seed,
                    winner: report.winner,
                    ticks: report.ticks,
                    lost: report.lost,
                });
            }
            summary.push(TournamentSummary {
                ai0: ai0.clone(),
                ai1: ai1.clone(),
                games,
                wins0,
                wins1,
                draws,
                avg_ticks: total_ticks.checked_div(games).unwrap_or(0),
                lost0,
                lost1,
            });
        }
    }
    Ok(TournamentReport { matches, summary })
}
