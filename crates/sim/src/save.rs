//! Serializable world state: `save_state` / `load_state` (spec 19 §3).
//!
//! Type, weapon, faction and AI personality references are written as ruleset
//! string ids; `u64` values as decimal strings; fixed-point values as raw `i32`.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::ai::Ai;
use crate::entity::{Entity, Ghost, HarvestPhase, Order, Projectile, QueueItem, Site};
use crate::fixed::{Fx, FxVec2};
use crate::flow::FlowField;
use crate::map::Cell;
use crate::player::Player;
use crate::rules::{Ruleset, TypeId, WeaponId};
use crate::world::{Command, Outcome, World, map_terrain};

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
pub fn save_state(world: &World, seed: u64, ais: &[Ai]) -> Result<SimState, String> {
    // Exhaustive: a new `World` field must be saved here or declared derived.
    let World {
        tick,
        rules,
        terrain: _,
        nav: _,
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
            .map(|&index| cell(world.nav.cell(index)))
            .collect(),
        ais: sorted_ais.iter().map(|ai| ai.save(rules)).collect(),
    })
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
    let terrain = map_terrain(&map);
    let cells = usize::from(map.width) * usize::from(map.height);

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
        terrain: terrain.clone(),
        nav: terrain,
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
    for &goal in &state.flow_goals {
        let goal = to_cell(goal);
        if !world.nav.in_bounds(goal) {
            return Err(format!("flow goal {goal:?} outside the map"));
        }
        let field = FlowField::compute(&world.nav, goal);
        world.fields.insert(world.nav.index(goal), field);
    }
    let ais = state
        .ais
        .iter()
        .map(|ai| Ai::load(ai, &world.rules))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((world, seed, ais))
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
    }
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
