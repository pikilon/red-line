//! Headless `match` and `tournament` subcommands (spec 05 §6).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sim::ai::{Ai, step_with_ai};
use sim::entity::EntityId;
use sim::hash::state_hash;
use sim::rules::Ruleset;
use sim::world::{Outcome, SimError, World};

/// Owner, type id and build cost of a live entity, keyed by id.
type Snapshot = BTreeMap<EntityId, (u8, String, u32)>;

/// Per type id: `[built0, built1, lost0, lost1]` (entities that appeared after
/// tick 0 and entities that disappeared, per owner).
pub type UnitStats = BTreeMap<String, [u32; 4]>;

/// One headless match: winner (player id), final tick, the summed cost each
/// player lost and the final state hash.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReport {
    pub winner: Option<u8>,
    pub ticks: u32,
    pub lost: [u32; 2],
    pub hash: String,
    #[serde(skip)]
    pub units: UnitStats,
}

/// `World::skirmish` entities keyed by id, for loss accounting.
fn snapshot(world: &World) -> Snapshot {
    world
        .entities()
        .iter()
        .map(|entity| {
            let ty = world.rules().ty(entity.kind);
            (entity.id, (entity.owner, ty.id.clone(), ty.cost))
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
    run_match_at(map, seed, max_ticks, [(ai0, "medium"), (ai1, "medium")])
}

/// `run_match` with a difficulty id (spec 05 §9) per player.
pub fn run_match_at(
    map: &str,
    seed: u32,
    max_ticks: u32,
    players: [(&str, &str); 2],
) -> Result<MatchReport, String> {
    let mut world =
        World::skirmish(Ruleset::builtin(), map, u64::from(seed)).map_err(|error| match error {
            SimError::UnknownMap { id } => format!("unknown map: {id}"),
            other => format!("cannot set up the match: {other:?}"),
        })?;
    let mut ais = Vec::new();
    for (player, (name, difficulty)) in [(0u8, players[0]), (1u8, players[1])] {
        if name != "none" {
            let mut ai = Ai::new(&world, player, name, u64::from(seed))?;
            ai.set_difficulty(world.rules(), difficulty)?;
            world.set_income_percent(player, ai.difficulty().income_percent);
            ais.push(ai);
        }
    }
    let mut units = UnitStats::new();
    let mut lost = [0u32; 2];
    let mut previous = snapshot(&world);
    while world.outcome() == Outcome::Ongoing && world.tick() < max_ticks {
        step_with_ai(&mut world, &mut ais);
        let current = snapshot(&world);
        for (id, (owner, kind, cost)) in &previous {
            if !current.contains_key(id) {
                lost[usize::from(*owner)] += cost;
                units.entry(kind.clone()).or_default()[2 + usize::from(*owner)] += 1;
            }
        }
        for (id, (owner, kind, _)) in &current {
            if !previous.contains_key(id) {
                units.entry(kind.clone()).or_default()[usize::from(*owner)] += 1;
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
        units,
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
    /// Spec 05 §9 difficulty ids for player 0 and 1; `["medium"]` when absent.
    #[serde(default = "medium_only")]
    pub difficulty0: Vec<String>,
    #[serde(default = "medium_only")]
    pub difficulty1: Vec<String>,
}

fn medium_only() -> Vec<String> {
    vec!["medium".to_owned()]
}

/// One played match inside a tournament report.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentMatch {
    pub ai0: String,
    pub ai1: String,
    pub difficulty0: String,
    pub difficulty1: String,
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
    pub difficulty0: String,
    pub difficulty1: String,
    pub games: u32,
    pub wins0: u32,
    pub wins1: u32,
    pub draws: u32,
    pub avg_ticks: u32,
    pub lost0: u32,
    pub lost1: u32,
    /// Per type id `[built0, built1, lost0, lost1]` over the pair's games.
    pub units: UnitStats,
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
            for d0 in &config.difficulty0 {
                for d1 in &config.difficulty1 {
                    let mut row = TournamentSummary {
                        ai0: ai0.clone(),
                        ai1: ai1.clone(),
                        difficulty0: d0.clone(),
                        difficulty1: d1.clone(),
                        games: 0,
                        wins0: 0,
                        wins1: 0,
                        draws: 0,
                        avg_ticks: 0,
                        lost0: 0,
                        lost1: 0,
                        units: UnitStats::new(),
                    };
                    let mut total_ticks = 0u32;
                    for seed in &config.seeds {
                        let report = run_match_at(
                            &config.map,
                            *seed,
                            config.max_ticks,
                            [(ai0, d0), (ai1, d1)],
                        )?;
                        match report.winner {
                            Some(0) => row.wins0 += 1,
                            Some(1) => row.wins1 += 1,
                            _ => row.draws += 1,
                        }
                        row.games += 1;
                        total_ticks += report.ticks;
                        row.lost0 += report.lost[0];
                        row.lost1 += report.lost[1];
                        for (kind, counts) in &report.units {
                            let total = row.units.entry(kind.clone()).or_default();
                            for (slot, count) in total.iter_mut().zip(counts) {
                                *slot += count;
                            }
                        }
                        matches.push(TournamentMatch {
                            ai0: ai0.clone(),
                            ai1: ai1.clone(),
                            difficulty0: d0.clone(),
                            difficulty1: d1.clone(),
                            seed: *seed,
                            winner: report.winner,
                            ticks: report.ticks,
                            lost: report.lost,
                        });
                    }
                    row.avg_ticks = total_ticks.checked_div(row.games).unwrap_or(0);
                    summary.push(row);
                }
            }
        }
    }
    Ok(TournamentReport { matches, summary })
}
