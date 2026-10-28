//! Serializable world state: `save_state` / `load_state` (spec 19 §3).
//!
//! Type, weapon, faction and AI personality references are written as ruleset
//! string ids; `u64` values as decimal strings; fixed-point values as raw `i32`.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::ai::Ai;
use crate::entity::EntityId;
use crate::entity::{Entity, Ghost, HarvestPhase, Order, Projectile, QueueItem, Site};
use crate::features::{self, FeatureState};
use crate::fixed::{Fx, FxVec2};
use crate::map::Cell;
use crate::map::cell_of;
use crate::nav::footprint_cells;
use crate::player::Player;
use crate::rules::{Category, MapDef, fx_centi};
use crate::rules::{Ruleset, TypeId, WeaponId};
use crate::world::{Command, Layer, MAX_UNITS, Outcome, SimError, World, map_terrain};

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
    /// Goal cells of the cached flow fields, ascending cell index. Saved
    /// because `Move` orders never rebuild a missing field; the fields are
    /// recomputed from `nav` on load (spec 19 §3.3).
    pub flow_goals: Vec<[i32; 2]>,
    /// Spec 31 A7: goal cells of the cached foot-layer fields, ascending cell
    /// index; absent while no rubble splits the layers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub foot_flow_goals: Vec<[i32; 2]>,
    /// Ascending player.
    pub ais: Vec<AiState>,
    /// Spec 31: one row per map feature in map order. Missing in saves from
    /// before spec 31, which load with the map's features at full hit points.
    #[serde(default)]
    pub features: Vec<FeatureSaveState>,
}

/// Spec 31: one feature row; `kind` is the feature type's id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeatureSaveState {
    pub kind: String,
    pub x: i32,
    pub y: i32,
    pub rot: u8,
    pub variant: u32,
    pub state: u8,
    pub hp: u32,
    pub alive: bool,
    /// Ticks of fire left (spec 31 block 1); missing means not burning.
    #[serde(default)]
    pub burn: u32,
    /// Ticks until the building collapses; missing means not collapsing.
    #[serde(default)]
    pub collapse: u32,
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
    /// Locomotion state (spec 11 §5.1). Omitted while every field is at its
    /// default, so saves without it load as before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locomotion: Option<LocomotionSaveState>,
    /// Spec 31 block 2: index of the feature this unit garrisons.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inside: Option<u32>,
    /// Spec 34: id of the vehicle this unit rides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aboard: Option<u32>,
    /// Spec 34: ticks until an unloading vehicle lets its next rider out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unloading: Option<u32>,
}

/// Saved locomotion and turret state of an entity (spec 11 §5.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocomotionSaveState {
    pub heading: u16,
    pub turret: u16,
    pub speed: i32,
    pub reversing: bool,
    pub aim: Option<u32>,
    pub idle_aim_ticks: u32,
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
    AttackGround {
        order_id: u32,
        target: [i32; 2],
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
    Garrison {
        order_id: u32,
        feature: u32,
    },
    Board {
        order_id: u32,
        carrier: u32,
    },
    Repair {
        order_id: u32,
        feature: u32,
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
    AttackGround {
        units: Vec<u32>,
        target: [i32; 2],
    },
    Harvest {
        units: Vec<u32>,
        depot: u32,
    },
    Garrison {
        units: Vec<u32>,
        feature: u32,
    },
    Unload {
        feature: u32,
    },
    Board {
        units: Vec<u32>,
        carrier: u32,
    },
    Disembark {
        carrier: u32,
    },
    Repair {
        units: Vec<u32>,
        feature: u32,
    },
    Dig {
        units: Vec<u32>,
        origin: [i32; 2],
        rot: u8,
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
pub fn save_state(world: &World, seed: u64, ais: &[Ai]) -> Result<SimState, String> {
    // Exhaustive: a new `World` field must be saved here or declared derived.
    let World {
        tick,
        rules,
        terrain: _,
        terrain_base: _,
        features,
        nav: _,
        terrain_foot: _,
        nav_foot: _,
        players,
        entities,
        next_entity_id,
        next_order_id,
        projectiles,
        next_projectile_id,
        events: _,
        pending,
        fields,
        outcome,
        victory_enabled,
        debug_commands,
        map_id,
    } = world;
    let Some(map_id) = map_id else {
        return Err("save unsupported: world has no map id".to_owned());
    };
    let mut sorted_ais: Vec<&Ai> = ais.iter().collect();
    sorted_ais.sort_by_key(|ai| ai.player());
    Ok(SimState {
        format_version: SAVE_FORMAT_VERSION,
        map_id: map_id.clone(),
        seed: seed.to_string(),
        tick: *tick,
        next_entity_id: *next_entity_id,
        next_order_id: *next_order_id,
        next_projectile_id: *next_projectile_id,
        victory_enabled: *victory_enabled,
        debug_commands: *debug_commands,
        outcome: match outcome {
            Outcome::Ongoing => OutcomeState::Ongoing,
            Outcome::Winner(player) => OutcomeState::Winner { player: *player },
            Outcome::Draw => OutcomeState::Draw,
        },
        players: players.iter().map(|p| save_player(p, rules)).collect(),
        entities: entities.iter().map(|e| save_entity(e, rules)).collect(),
        projectiles: projectiles
            .iter()
            .map(|p| save_projectile(p, rules))
            .collect(),
        pending: pending
            .iter()
            .map(|(player, command)| PendingCommand {
                player: *player,
                command: save_command(command, rules),
            })
            .collect(),
        flow_goals: fields
            .keys()
            .filter(|(layer, _)| *layer == Layer::Vehicle)
            .map(|&(_, index)| cell(world.nav.cell(index)))
            .collect(),
        foot_flow_goals: fields
            .keys()
            .filter(|(layer, _)| *layer == Layer::Foot)
            .map(|&(_, index)| cell(world.nav.cell(index)))
            .collect(),
        ais: sorted_ais.iter().map(|ai| ai.save(rules)).collect(),
        features: features
            .iter()
            .map(|row| save_feature(row, rules))
            .collect(),
    })
}

fn save_feature(row: &FeatureState, rules: &Ruleset) -> FeatureSaveState {
    FeatureSaveState {
        kind: rules.feature_types[row.kind as usize].id.clone(),
        x: row.x,
        y: row.y,
        rot: row.rot,
        variant: row.variant,
        state: row.state,
        hp: row.hp,
        alive: row.alive,
        burn: row.burn,
        collapse: row.collapse,
    }
}

/// Feature rows of a save, checked against the map's feature count and the
/// ruleset's feature types.
fn load_features(
    saved: &[FeatureSaveState],
    rules: &Ruleset,
    map: &MapDef,
) -> Result<Vec<FeatureState>, String> {
    if saved.is_empty() {
        return Ok(features::from_map(rules, map));
    }
    // Spec 35: rows past the map's were dug during the match.
    if saved.len() < map.features.len() {
        return Err(format!(
            "{} feature rows for {} map features",
            saved.len(),
            map.features.len()
        ));
    }
    saved
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let to = map.features.get(index).and_then(|placed| placed.to);
            let kind = rules
                .feature_types
                .iter()
                .position(|ty| ty.id == row.kind)
                .ok_or_else(|| format!("unknown feature type {}", row.kind))?;
            Ok(FeatureState {
                kind: kind as u32,
                x: row.x,
                y: row.y,
                rot: row.rot,
                variant: row.variant,
                state: row.state,
                hp: row.hp,
                alive: row.alive,
                to,
                burn: row.burn,
                collapse: row.collapse,
            })
        })
        .collect()
}

/// Rebuilds a world, its seed and its AIs. Errors start with "invalid save: ".
pub fn load_state(state: &SimState) -> Result<(World, u64, Vec<Ai>), String> {
    load(state).map_err(|detail| format!("invalid save: {detail}"))
}

fn load(state: &SimState) -> Result<(World, u64, Vec<Ai>), String> {
    if state.format_version != SAVE_FORMAT_VERSION {
        return Err(format!(
            "unsupported format version {}",
            state.format_version
        ));
    }
    let rules = Ruleset::builtin();
    let map = rules
        .map(&state.map_id)
        .cloned()
        .ok_or_else(|| format!("unknown map: {}", state.map_id))?;
    let seed = parse_u64("seed", &state.seed)?;
    let base = map_terrain(&map);
    let cells = usize::from(map.width) * usize::from(map.height);
    let features = load_features(&state.features, &rules, &map)?;
    let terrain = features::with_blocks(&base, &features, &rules);
    let terrain_foot = features::foot_blocks(&base, &features, &rules);
    let nav = terrain.clone();

    let players = state
        .players
        .iter()
        .map(|p| load_player(p, &rules, cells))
        .collect::<Result<Vec<_>, _>>()?;
    let mut ids = BTreeSet::new();
    let mut entities = Vec::with_capacity(state.entities.len());
    for entity in &state.entities {
        if !ids.insert(entity.id) {
            return Err(format!("duplicate entity id {}", entity.id));
        }
        entities.push(load_entity(entity, &rules)?);
    }
    let projectiles = state
        .projectiles
        .iter()
        .map(|p| load_projectile(p, &rules))
        .collect::<Result<Vec<_>, _>>()?;
    let pending = state
        .pending
        .iter()
        .map(|p| Ok((p.player, load_command(&p.command, &rules)?)))
        .collect::<Result<Vec<_>, String>>()?;

    let mut world = World {
        tick: state.tick,
        rules,
        terrain,
        terrain_base: base,
        features,
        nav,
        terrain_foot,
        nav_foot: None,
        players,
        entities,
        next_entity_id: state.next_entity_id,
        next_order_id: state.next_order_id,
        projectiles,
        next_projectile_id: state.next_projectile_id,
        events: Vec::new(),
        pending,
        fields: BTreeMap::new(),
        outcome: match state.outcome {
            OutcomeState::Ongoing => Outcome::Ongoing,
            OutcomeState::Winner { player } => Outcome::Winner(player),
            OutcomeState::Draw => Outcome::Draw,
        },
        victory_enabled: state.victory_enabled,
        debug_commands: state.debug_commands,
        map_id: Some(map.id.clone()),
    };
    // Saved goals are never blocked, so the `Move` remap is a no-op.
    world.rebuild_nav();
    let layers = [
        (Layer::Vehicle, &state.flow_goals),
        (Layer::Foot, &state.foot_flow_goals),
    ];
    for (layer, goals) in layers {
        for &goal in goals {
            let goal = to_cell(goal);
            if !world.nav.in_bounds(goal) {
                return Err(format!("flow goal {goal:?} outside the map"));
            }
            world.field(layer, goal);
        }
    }
    let ais = state
        .ais
        .iter()
        .map(|ai| Ai::load(ai, &world.rules))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((world, seed, ais))
}

/// `fx_centi` for a possibly negative value (move targets are clamped later).
fn signed_centi(c: i32) -> Fx {
    Fx::from_raw((i64::from(c) * 65536 / 100) as i32)
}

fn parse_u64(name: &str, text: &str) -> Result<u64, String> {
    text.parse::<u64>()
        .map_err(|_| format!("invalid {name}: {text}"))
}

fn vec2(v: FxVec2) -> [i32; 2] {
    [v.x.raw(), v.y.raw()]
}

fn fx_vec2(v: [i32; 2]) -> FxVec2 {
    FxVec2::new(Fx::from_raw(v[0]), Fx::from_raw(v[1]))
}

fn cell(c: Cell) -> [i32; 2] {
    [c.x, c.y]
}

fn to_cell(c: [i32; 2]) -> Cell {
    Cell { x: c[0], y: c[1] }
}

fn type_id(rules: &Ruleset, kind: TypeId) -> String {
    rules.ty(kind).id.clone()
}

fn type_index(rules: &Ruleset, id: &str) -> Result<TypeId, String> {
    rules
        .type_index(id)
        .ok_or_else(|| format!("unknown type: {id}"))
}

fn weapon_id(rules: &Ruleset, weapon: WeaponId) -> String {
    rules.weapons[usize::from(weapon)].id.clone()
}

fn weapon_index(rules: &Ruleset, id: &str) -> Result<WeaponId, String> {
    rules
        .weapons
        .iter()
        .position(|w| w.id == id)
        .map(|i| i as WeaponId)
        .ok_or_else(|| format!("unknown weapon: {id}"))
}

/// Run lengths alternating false/true, starting with false.
fn encode_runs(cells: &[bool]) -> Vec<u32> {
    let mut runs = Vec::new();
    let mut current = false;
    let mut length = 0u32;
    for &value in cells {
        if value == current {
            length += 1;
        } else {
            runs.push(length);
            current = value;
            length = 1;
        }
    }
    runs.push(length);
    runs
}

fn decode_runs(name: &str, runs: &[u32], cells: usize) -> Result<Vec<bool>, String> {
    let total: u64 = runs.iter().map(|&r| u64::from(r)).sum();
    if total != cells as u64 {
        return Err(format!("{name} length {total} != {cells} cells"));
    }
    let mut out = Vec::with_capacity(cells);
    for (index, &run) in runs.iter().enumerate() {
        out.extend(std::iter::repeat_n(index % 2 == 1, run as usize));
    }
    Ok(out)
}

fn save_player(player: &Player, rules: &Ruleset) -> PlayerState {
    let Player {
        id,
        faction,
        credits,
        defeated,
        power_produced,
        power_consumed,
        explored,
        visible,
        ghosts,
    } = player;
    PlayerState {
        id: *id,
        faction: rules.factions[usize::from(*faction)].id.clone(),
        credits: *credits,
        defeated: *defeated,
        explored: encode_runs(explored),
        visible: encode_runs(visible),
        power: [*power_produced, *power_consumed],
        ghosts: ghosts
            .iter()
            .map(|(&entity, ghost)| GhostState {
                entity,
                kind: type_id(rules, ghost.kind),
                owner: ghost.owner,
                origin: cell(ghost.origin),
            })
            .collect(),
    }
}

fn load_player(state: &PlayerState, rules: &Ruleset, cells: usize) -> Result<Player, String> {
    let faction = rules
        .factions
        .iter()
        .position(|f| f.id == state.faction)
        .ok_or_else(|| format!("unknown faction: {}", state.faction))?;
    let mut ghosts = BTreeMap::new();
    for ghost in &state.ghosts {
        ghosts.insert(
            ghost.entity,
            Ghost {
                kind: type_index(rules, &ghost.kind)?,
                owner: ghost.owner,
                origin: to_cell(ghost.origin),
            },
        );
    }
    Ok(Player {
        id: state.id,
        faction: faction as u8,
        credits: state.credits,
        defeated: state.defeated,
        power_produced: state.power[0],
        power_consumed: state.power[1],
        explored: decode_runs("explored", &state.explored, cells)?,
        visible: decode_runs("visible", &state.visible, cells)?,
        ghosts,
    })
}

fn save_order(order: Order) -> OrderState {
    match order {
        Order::Idle { last_order_id } => OrderState::Idle { last_order_id },
        Order::Move {
            order_id,
            target,
            goal,
        } => OrderState::Move {
            order_id,
            target: vec2(target),
            goal: cell(goal),
        },
        Order::Attack { order_id, target } => OrderState::Attack { order_id, target },
        Order::AttackGround { order_id, target } => OrderState::AttackGround {
            order_id,
            target: vec2(target),
        },
        Order::Harvest {
            order_id,
            depot,
            center,
            phase,
            timer,
        } => OrderState::Harvest {
            order_id,
            depot,
            center,
            phase: match phase {
                HarvestPhase::ToDepot => HarvestPhaseState::ToDepot,
                HarvestPhase::Loading => HarvestPhaseState::Loading,
                HarvestPhase::ToCenter => HarvestPhaseState::ToCenter,
                HarvestPhase::Unloading => HarvestPhaseState::Unloading,
            },
            timer,
        },
        Order::Build { order_id, building } => OrderState::Build { order_id, building },
        Order::Garrison { order_id, feature } => OrderState::Garrison { order_id, feature },
        Order::Board { order_id, carrier } => OrderState::Board { order_id, carrier },
        Order::Repair { order_id, feature } => OrderState::Repair { order_id, feature },
    }
}

fn load_order(order: OrderState) -> Order {
    match order {
        OrderState::Idle { last_order_id } => Order::Idle { last_order_id },
        OrderState::Move {
            order_id,
            target,
            goal,
        } => Order::Move {
            order_id,
            target: fx_vec2(target),
            goal: to_cell(goal),
        },
        OrderState::Attack { order_id, target } => Order::Attack { order_id, target },
        OrderState::AttackGround { order_id, target } => Order::AttackGround {
            order_id,
            target: fx_vec2(target),
        },
        OrderState::Harvest {
            order_id,
            depot,
            center,
            phase,
            timer,
        } => Order::Harvest {
            order_id,
            depot,
            center,
            phase: match phase {
                HarvestPhaseState::ToDepot => HarvestPhase::ToDepot,
                HarvestPhaseState::Loading => HarvestPhase::Loading,
                HarvestPhaseState::ToCenter => HarvestPhase::ToCenter,
                HarvestPhaseState::Unloading => HarvestPhase::Unloading,
            },
            timer,
        },
        OrderState::Build { order_id, building } => Order::Build { order_id, building },
        OrderState::Garrison { order_id, feature } => Order::Garrison { order_id, feature },
        OrderState::Board { order_id, carrier } => Order::Board { order_id, carrier },
        OrderState::Repair { order_id, feature } => Order::Repair { order_id, feature },
    }
}

/// The locomotion block of a saved entity, or `None` while it is all default.
fn locomotion_save(entity: &Entity) -> Option<LocomotionSaveState> {
    let state = LocomotionSaveState {
        heading: entity.heading.0,
        turret: entity.turret.0,
        speed: entity.speed.raw(),
        reversing: entity.reversing,
        aim: entity.aim,
        idle_aim_ticks: entity.idle_aim_ticks,
    };
    let initial = LocomotionSaveState {
        heading: 0,
        turret: 0,
        speed: 0,
        reversing: false,
        aim: None,
        idle_aim_ticks: 0,
    };
    (state != initial).then_some(state)
}

fn save_entity(entity: &Entity, rules: &Ruleset) -> EntityState {
    let Entity {
        id,
        owner,
        kind,
        pos,
        hp,
        order,
        cooldown,
        cargo,
        last_target,
        last_hit,
        site,
        ..
    } = entity;
    EntityState {
        id: *id,
        owner: *owner,
        kind: type_id(rules, *kind),
        pos: vec2(*pos),
        hp: *hp,
        order: save_order(*order),
        cooldown: *cooldown,
        cargo: *cargo,
        last_target: *last_target,
        last_hit: last_hit.map(|(shooter, weapon)| LastHitState {
            shooter,
            weapon: weapon_id(rules, weapon),
        }),
        site: site.as_ref().map(|site| save_site(site, rules)),
        locomotion: locomotion_save(entity),
        inside: entity.inside,
        aboard: entity.aboard,
        unloading: entity.unloading,
    }
}

fn save_site(site: &Site, rules: &Ruleset) -> SiteState {
    let Site {
        origin,
        progress,
        complete,
        queue,
        rally,
    } = site;
    SiteState {
        origin: cell(*origin),
        progress: *progress,
        complete: *complete,
        queue: queue
            .iter()
            .map(|item| QueueItemState {
                kind: type_id(rules, item.kind),
                progress: item.progress,
            })
            .collect(),
        rally: rally.map(vec2),
    }
}

fn load_entity(state: &EntityState, rules: &Ruleset) -> Result<Entity, String> {
    let last_hit = match &state.last_hit {
        None => None,
        Some(hit) => Some((hit.shooter, weapon_index(rules, &hit.weapon)?)),
    };
    let site = match &state.site {
        None => None,
        Some(site) => Some(Site {
            origin: to_cell(site.origin),
            progress: site.progress,
            complete: site.complete,
            queue: site
                .queue
                .iter()
                .map(|item| {
                    Ok(QueueItem {
                        kind: type_index(rules, &item.kind)?,
                        progress: item.progress,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?,
            rally: site.rally.map(fx_vec2),
        }),
    };
    Ok(Entity {
        id: state.id,
        owner: state.owner,
        kind: type_index(rules, &state.kind)?,
        pos: fx_vec2(state.pos),
        hp: state.hp,
        order: load_order(state.order),
        cooldown: state.cooldown,
        cargo: state.cargo,
        last_target: state.last_target,
        last_hit,
        site,
        heading: crate::angle::Angle(state.locomotion.map_or(0, |l| l.heading)),
        turret: crate::angle::Angle(state.locomotion.map_or(0, |l| l.turret)),
        speed: crate::fixed::Fx::from_raw(state.locomotion.map_or(0, |l| l.speed)),
        reversing: state.locomotion.is_some_and(|l| l.reversing),
        aim: state.locomotion.and_then(|l| l.aim),
        idle_aim_ticks: state.locomotion.map_or(0, |l| l.idle_aim_ticks),
        inside: state.inside,
        aboard: state.aboard,
        unloading: state.unloading,
    })
}

fn save_projectile(projectile: &Projectile, rules: &Ruleset) -> ProjectileState {
    let Projectile {
        id,
        owner,
        shooter,
        weapon,
        target,
        origin,
        impact,
        launch_tick,
        impact_tick,
    } = projectile;
    ProjectileState {
        id: *id,
        owner: *owner,
        shooter: *shooter,
        weapon: weapon_id(rules, *weapon),
        target: *target,
        origin: vec2(*origin),
        impact: vec2(*impact),
        launch_tick: *launch_tick,
        impact_tick: *impact_tick,
    }
}

fn load_projectile(state: &ProjectileState, rules: &Ruleset) -> Result<Projectile, String> {
    Ok(Projectile {
        id: state.id,
        owner: state.owner,
        shooter: state.shooter,
        weapon: weapon_index(rules, &state.weapon)?,
        target: state.target,
        origin: fx_vec2(state.origin),
        impact: fx_vec2(state.impact),
        launch_tick: state.launch_tick,
        impact_tick: state.impact_tick,
    })
}

fn save_command(command: &Command, rules: &Ruleset) -> CommandState {
    match command {
        Command::Move { units, target } => CommandState::Move {
            units: units.clone(),
            target: vec2(*target),
        },
        Command::Attack { units, target } => CommandState::Attack {
            units: units.clone(),
            target: *target,
        },
        Command::AttackGround { units, target } => CommandState::AttackGround {
            units: units.clone(),
            target: vec2(*target),
        },
        Command::Harvest { units, depot } => CommandState::Harvest {
            units: units.clone(),
            depot: *depot,
        },
        Command::Construct {
            dozer,
            kind,
            origin,
        } => CommandState::Construct {
            dozer: *dozer,
            kind: type_id(rules, *kind),
            origin: cell(*origin),
        },
        Command::Resume { units, building } => CommandState::Resume {
            units: units.clone(),
            building: *building,
        },
        Command::Produce { building, kind } => CommandState::Produce {
            building: *building,
            kind: type_id(rules, *kind),
        },
        Command::Cancel { building } => CommandState::Cancel {
            building: *building,
        },
        Command::Rally { building, target } => CommandState::Rally {
            building: *building,
            target: vec2(*target),
        },
        Command::Stop { units } => CommandState::Stop {
            units: units.clone(),
        },
        Command::Garrison { units, feature } => CommandState::Garrison {
            units: units.clone(),
            feature: *feature,
        },
        Command::Unload { feature } => CommandState::Unload { feature: *feature },
        Command::Board { units, carrier } => CommandState::Board {
            units: units.clone(),
            carrier: *carrier,
        },
        Command::Disembark { carrier } => CommandState::Disembark { carrier: *carrier },
        Command::Repair { units, feature } => CommandState::Repair {
            units: units.clone(),
            feature: *feature,
        },
        Command::Dig { units, origin, rot } => CommandState::Dig {
            units: units.clone(),
            origin: cell(*origin),
            rot: *rot,
        },
        Command::DebugSpawn { kind, pos } => CommandState::DebugSpawn {
            kind: type_id(rules, *kind),
            pos: vec2(*pos),
        },
        Command::DebugSetHp { entity, hp } => CommandState::DebugSetHp {
            entity: *entity,
            hp: *hp,
        },
    }
}

fn load_command(state: &CommandState, rules: &Ruleset) -> Result<Command, String> {
    Ok(match state {
        CommandState::Move { units, target } => Command::Move {
            units: units.clone(),
            target: fx_vec2(*target),
        },
        CommandState::AttackGround { units, target } => Command::AttackGround {
            units: units.clone(),
            target: fx_vec2(*target),
        },
        CommandState::Attack { units, target } => Command::Attack {
            units: units.clone(),
            target: *target,
        },
        CommandState::Harvest { units, depot } => Command::Harvest {
            units: units.clone(),
            depot: *depot,
        },
        CommandState::Construct {
            dozer,
            kind,
            origin,
        } => Command::Construct {
            dozer: *dozer,
            kind: type_index(rules, kind)?,
            origin: to_cell(*origin),
        },
        CommandState::Resume { units, building } => Command::Resume {
            units: units.clone(),
            building: *building,
        },
        CommandState::Produce { building, kind } => Command::Produce {
            building: *building,
            kind: type_index(rules, kind)?,
        },
        CommandState::Cancel { building } => Command::Cancel {
            building: *building,
        },
        CommandState::Rally { building, target } => Command::Rally {
            building: *building,
            target: fx_vec2(*target),
        },
        CommandState::Stop { units } => Command::Stop {
            units: units.clone(),
        },
        CommandState::Garrison { units, feature } => Command::Garrison {
            units: units.clone(),
            feature: *feature,
        },
        CommandState::Unload { feature } => Command::Unload { feature: *feature },
        CommandState::Board { units, carrier } => Command::Board {
            units: units.clone(),
            carrier: *carrier,
        },
        CommandState::Disembark { carrier } => Command::Disembark { carrier: *carrier },
        CommandState::Repair { units, feature } => Command::Repair {
            units: units.clone(),
            feature: *feature,
        },
        CommandState::Dig { units, origin, rot } => Command::Dig {
            units: units.clone(),
            origin: to_cell(*origin),
            rot: *rot,
        },
        CommandState::DebugSpawn { kind, pos } => Command::DebugSpawn {
            kind: type_index(rules, kind)?,
            pos: fx_vec2(*pos),
        },
        CommandState::DebugSetHp { entity, hp } => Command::DebugSetHp {
            entity: *entity,
            hp: *hp,
        },
    })
}

/// Setup-form match (spec 19 §3.5): an authored tick-0 world.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Setup {
    pub map: String,
    /// u64, decimal.
    pub seed: String,
    pub victory: bool,
    pub debug: bool,
    /// The map's starts place each player's HQ and dozer.
    pub starts: bool,
    /// One per map start; absent = `startingCredits` for every player.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits: Option<Vec<u32>>,
    #[serde(default)]
    pub ai: Vec<SetupAi>,
    #[serde(default)]
    pub entities: Vec<SetupEntity>,
    /// Spec 35: map features damaged at tick 0 (e.g. a broken bridge to repair).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub features: Vec<SetupFeature>,
}

/// A map feature, by a cell it covers, left at `hp_percent` of its hit points.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetupFeature {
    pub at: [i32; 2],
    /// 0..=99; 0 destroys (or breaks) it.
    pub hp_percent: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetupAi {
    pub player: u8,
    pub personality: String,
    pub active: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetupEntity {
    pub player: u8,
    #[serde(rename = "type")]
    pub kind: String,
    /// Units: centre in centi-tiles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at_centi: Option<[i32; 2]>,
    /// Buildings: footprint origin cell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<[i32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// 1..=100, default 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hp_percent: Option<u32>,
    /// Buildings only, 0..=100, default 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_percent: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<SetupOrder>,
}

/// Externally tagged: `{ "attack": "leo1" }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum SetupOrder {
    /// Label of the target.
    Attack(String),
    MoveCenti([i32; 2]),
    /// Label of a depot.
    Harvest(String),
    /// Spec 20 force fire at a ground point, in centi-tiles.
    AttackGroundCenti([i32; 2]),
    /// Spec 31 block 2: a cell inside the footprint of a garrisonable feature.
    Garrison([i32; 2]),
    /// Spec 34: label of an own transport to board.
    Board(String),
    /// Spec 35: a cell on the deck of the bridge to repair.
    Repair([i32; 2]),
    /// Spec 35: top-left cell of a trench to dig (turned 0).
    Dig([i32; 2]),
}

/// World, seed and AIs of a setup (spec 19 §3.5). Errors are the `SimError`
/// texts: "invalid setup: <detail>" or "unknown map: <id>".
pub fn from_setup(setup: &Setup) -> Result<(World, u64, Vec<Ai>), String> {
    let seed = setup
        .seed
        .parse::<u64>()
        .map_err(|_| format!("invalid setup: seed {}", setup.seed))?;
    let world = World::from_setup(Ruleset::builtin(), setup).map_err(|e| e.to_string())?;
    let mut ais: Vec<Ai> = Vec::with_capacity(setup.ai.len());
    for (index, entry) in setup.ai.iter().enumerate() {
        let mut ai = Ai::new(&world, entry.player, &entry.personality, seed).map_err(|e| {
            let detail = if world.rules.ai_index(&entry.personality).is_none() {
                format!("unknown ai {}", entry.personality)
            } else {
                e
            };
            format!("invalid setup: ai[{index}]: {detail}")
        })?;
        // A fresh AI has no attackers, so pausing it issues no command.
        let _ = ai.set_active(entry.active);
        ais.retain(|existing| existing.player() != entry.player);
        ais.push(ai);
    }
    ais.sort_by_key(Ai::player);
    Ok((world, seed, ais))
}

impl World {
    /// A tick-0 world from a setup (spec 19 §3.5): the map's terrain, players
    /// and depots (labels `depot-<i>`), the starts' HQ and dozer when
    /// `starts` (labels `hq-<p>`, `dozer-<p>`), then the entities in list
    /// order; their orders are enqueued for the first step.
    pub fn from_setup(rules: Ruleset, setup: &Setup) -> Result<World, SimError> {
        let invalid = |detail: String| SimError::InvalidSetup { detail };
        let mut world = World::skirmish_with(rules, &setup.map, setup.starts)?;
        let starts = world.players.len();
        if let Some(credits) = &setup.credits {
            if credits.len() != starts {
                return Err(invalid(format!(
                    "credits: {} entries for {starts} starts",
                    credits.len()
                )));
            }
            for (player, &amount) in credits.iter().enumerate() {
                world.players[player].credits = amount;
            }
        }

        let mut labels: BTreeMap<String, EntityId> = BTreeMap::new();
        let mut depots = 0;
        for entity in &world.entities {
            let category = world.rules.ty(entity.kind).category;
            let faction = world
                .players
                .get(usize::from(entity.owner))
                .map(|p| &world.rules.factions[usize::from(p.faction)]);
            let label = match (category, faction) {
                (Category::Depot, _) => {
                    depots += 1;
                    format!("depot-{}", depots - 1)
                }
                (_, Some(f)) if entity.kind == f.hq => format!("hq-{}", entity.owner),
                (_, Some(f)) if entity.kind == f.dozer => format!("dozer-{}", entity.owner),
                _ => continue,
            };
            labels.insert(label, entity.id);
        }

        let mut placed = Vec::with_capacity(setup.entities.len());
        for (index, entry) in setup.entities.iter().enumerate() {
            let at = |detail: String| invalid(format!("entities[{index}]: {detail}"));
            if usize::from(entry.player) >= starts {
                return Err(at(format!("player {} has no start", entry.player)));
            }
            let kind = world
                .rules
                .type_index(&entry.kind)
                .ok_or_else(|| at(format!("unknown type {}", entry.kind)))?;
            let ty = world.rules.ty(kind).clone();
            let hp_percent = entry.hp_percent.unwrap_or(100);
            if !(1..=100).contains(&hp_percent) {
                return Err(at(format!("hpPercent {hp_percent} out of 1..=100")));
            }
            let hp = (u64::from(ty.hp) * u64::from(hp_percent) / 100).max(1) as u32;
            let id = match ty.category {
                Category::Depot => return Err(at(format!("type {} is a depot", entry.kind))),
                Category::Building => {
                    let origin = entry
                        .origin
                        .ok_or_else(|| at("building needs origin".to_owned()))?;
                    let build_percent = entry.build_percent.unwrap_or(100);
                    if build_percent > 100 {
                        return Err(at(format!("buildPercent {build_percent} out of 0..=100")));
                    }
                    let origin = to_cell(origin);
                    let inside = footprint_cells(origin, ty.footprint)
                        .iter()
                        .all(|&cell| world.terrain.in_bounds(cell));
                    if !inside {
                        return Err(at("outside the map".to_owned()));
                    }
                    if !world.footprint_free(origin, ty.footprint) {
                        return Err(at("footprint blocked".to_owned()));
                    }
                    let complete = build_percent == 100;
                    let progress = ty.build_ticks * build_percent;
                    world.place_site(entry.player, kind, origin, hp, progress, complete)
                }
                Category::Unit => {
                    let [x, y] = entry
                        .at_centi
                        .ok_or_else(|| at("unit needs atCenti".to_owned()))?;
                    if x < 0 || y < 0 {
                        return Err(at("outside the map".to_owned()));
                    }
                    let pos = FxVec2::new(fx_centi(x as u32), fx_centi(y as u32));
                    let cell = cell_of(pos);
                    if !world.terrain.in_bounds(cell) {
                        return Err(at("outside the map".to_owned()));
                    }
                    if !world.nav.is_passable(cell) {
                        return Err(at("cell blocked".to_owned()));
                    }
                    if world.entities.len() as u32 >= MAX_UNITS {
                        return Err(at("too many entities".to_owned()));
                    }
                    let id = world.spawn(entry.player, kind, pos);
                    world.set_hp(id, hp);
                    id
                }
            };
            if let Some(label) = &entry.label
                && labels.insert(label.clone(), id).is_some()
            {
                return Err(at(format!("duplicate label {label}")));
            }
            placed.push(id);
        }

        for (index, entry) in setup.entities.iter().enumerate() {
            let Some(order) = &entry.order else {
                continue;
            };
            let at = |detail: String| invalid(format!("entities[{index}]: {detail}"));
            let label = |name: &String| {
                labels
                    .get(name)
                    .copied()
                    .ok_or_else(|| at(format!("unknown label {name}")))
            };
            let units = vec![placed[index]];
            let command = match order {
                SetupOrder::Attack(target) => Command::Attack {
                    units,
                    target: label(target)?,
                },
                SetupOrder::MoveCenti([x, y]) => Command::Move {
                    units,
                    target: FxVec2::new(signed_centi(*x), signed_centi(*y)),
                },
                SetupOrder::Harvest(depot) => Command::Harvest {
                    units,
                    depot: label(depot)?,
                },
                SetupOrder::AttackGroundCenti([x, y]) => Command::AttackGround {
                    units,
                    target: FxVec2::new(signed_centi(*x), signed_centi(*y)),
                },
                SetupOrder::Dig(cell) => Command::Dig {
                    units,
                    origin: to_cell(*cell),
                    rot: 0,
                },
                SetupOrder::Repair(cell) => Command::Repair {
                    units,
                    feature: world
                        .repair_job_at(to_cell(*cell))
                        .ok_or_else(|| at(format!("no bridge at {},{}", cell[0], cell[1])))?,
                },
                SetupOrder::Board(carrier) => Command::Board {
                    units,
                    carrier: label(carrier)?,
                },
                SetupOrder::Garrison(cell) => Command::Garrison {
                    units,
                    feature: world
                        .feature_at(to_cell(*cell))
                        .ok_or_else(|| at(format!("no feature at {},{}", cell[0], cell[1])))?,
                },
            };
            world.enqueue_as(entry.player, command);
        }

        for (index, entry) in setup.features.iter().enumerate() {
            let cell = to_cell(entry.at);
            let feature = world
                .repair_job_at(cell)
                .or_else(|| world.feature_at(cell))
                .ok_or_else(|| {
                    invalid(format!(
                        "features[{index}]: no feature at {},{}",
                        entry.at[0], entry.at[1]
                    ))
                })? as usize;
            let hp = world.features[feature].hp;
            let keep = (u64::from(hp) * u64::from(entry.hp_percent.min(100)) / 100) as u32;
            world.damage_feature(feature, hp - keep);
        }

        world.victory_enabled = setup.victory;
        world.debug_commands = setup.debug;
        world.refresh_visibility();
        Ok(world)
    }
}
