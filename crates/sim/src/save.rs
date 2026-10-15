//! Serializable world state: `save_state` / `load_state` (spec 19 §3).
//!
//! Type, weapon, faction and AI personality references are written as ruleset
//! string ids; `u64` values as decimal strings; fixed-point values as raw `i32`.

use serde::{Deserialize, Serialize};

use crate::ai::Ai;
use crate::world::World;

/// Version of the `SimState` format (spec 19 §3.6).
pub const SAVE_FORMAT_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimState {
    pub format_version: u32,
    pub map_id: String,
    /// u64, decimal.
    pub seed: String,
    pub tick: u32,
    pub next_entity_id: u32,
    pub next_order_id: u32,
    pub next_projectile_id: u32,
    pub victory_enabled: bool,
    pub debug_commands: bool,
    pub outcome: OutcomeState,
    /// Ascending id.
    pub players: Vec<PlayerState>,
    /// Ascending id.
    pub entities: Vec<EntityState>,
    /// Creation order.
    pub projectiles: Vec<ProjectileState>,
    /// Queue order.
    pub pending: Vec<PendingCommand>,
    /// Ascending player.
    pub ais: Vec<AiState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum OutcomeState {
    Ongoing,
    Winner { player: u8 },
    Draw,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlayerState {
    pub id: u8,
    pub faction: String,
    pub credits: u32,
    pub defeated: bool,
    /// Run lengths of `explored`, row-major, alternating false/true and
    /// starting with false (the first run may be 0). Sum = map cells.
    pub explored: Vec<u32>,
    /// Same encoding for `visible` (saved: computed mid-step, spec 19 §3.3).
    pub visible: Vec<u32>,
    /// `[power_produced, power_consumed]` (saved: computed mid-step).
    pub power: [u32; 2],
    /// Ascending entity.
    pub ghosts: Vec<GhostState>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GhostState {
    pub entity: u32,
    pub kind: String,
    pub owner: u8,
    pub origin: [i32; 2],
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityState {
    pub id: u32,
    pub owner: u8,
    pub kind: String,
    pub pos: [i32; 2],
    pub hp: u32,
    pub order: OrderState,
    pub cooldown: u32,
    pub cargo: u32,
    pub last_target: Option<u32>,
    pub last_hit: Option<LastHitState>,
    pub site: Option<SiteState>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LastHitState {
    pub shooter: u32,
    pub weapon: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum OrderState {
    Idle {
        last_order_id: u32,
    },
    Move {
        order_id: u32,
        target: [i32; 2],
        goal: [i32; 2],
    },
    Attack {
        order_id: u32,
        target: u32,
    },
    Harvest {
        order_id: u32,
        depot: u32,
        center: Option<u32>,
        phase: HarvestPhaseState,
        timer: u32,
    },
    Build {
        order_id: u32,
        building: u32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HarvestPhaseState {
    ToDepot,
    Loading,
    ToCenter,
    Unloading,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteState {
    pub origin: [i32; 2],
    pub progress: u32,
    pub complete: bool,
    pub queue: Vec<QueueItemState>,
    pub rally: Option<[i32; 2]>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueItemState {
    pub kind: String,
    pub progress: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectileState {
    pub id: u32,
    pub owner: u8,
    pub shooter: u32,
    pub weapon: String,
    pub target: u32,
    pub origin: [i32; 2],
    pub impact: [i32; 2],
    pub launch_tick: u32,
    pub impact_tick: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingCommand {
    pub player: u8,
    pub command: CommandState,
}

/// `Command` with string type ids, `FxVec2` and `Cell` as `[i32; 2]`. The tag
/// is `type`, because `Construct`, `Produce` and `DebugSpawn` have a `kind`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CommandState {
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
    DebugSpawn {
        kind: String,
        pos: [i32; 2],
    },
    DebugSetHp {
        entity: u32,
        hp: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiState {
    pub player: u8,
    pub personality: String,
    /// SplitMix64 state, u64 decimal.
    pub rng: String,
    pub force: Option<u16>,
    pub attackers: Vec<u32>,
    pub active: bool,
}

/// The state of `world` and its AIs. Errors with
/// "save unsupported: world has no map id" outside skirmish worlds.
pub fn save_state(_world: &World, _seed: u64, _ais: &[Ai]) -> Result<SimState, String> {
    Err("not implemented".to_owned())
}

/// Rebuilds a world, its seed and its AIs. Errors start with "invalid save: ".
pub fn load_state(_state: &SimState) -> Result<(World, u64, Vec<Ai>), String> {
    Err("not implemented".to_owned())
}
