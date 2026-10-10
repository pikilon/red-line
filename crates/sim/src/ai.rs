//! Computer opponent (spec 05 §5.3, §5.4).
//!
//! P3-03 implements the skeleton and the first three steps of the decision
//! pass: harvesting, truck production and the starting dozer. Later issues add
//! the build, defense, production, launch and retarget steps.

use crate::entity::{EntityId, Order, PlayerId};
use crate::fixed::FxVec2;
use crate::rng::SplitMix64;
use crate::rules::{Category, FactionId, Ruleset, TypeId};
use crate::world::{Command, Outcome, World};

/// Ticks between two decision passes (1 s at 15 Hz).
pub const AI_THINK_INTERVAL: u32 = 15;
/// Closest ring searched for a construction site.
pub const BASE_RING_MIN: i32 = 3;
/// Farthest ring searched for a construction site.
pub const BASE_RING_MAX: i32 = 24;

/// A computer opponent attached to one player.
pub struct Ai {
    player: PlayerId,
    /// Index into `Ruleset::ai`.
    personality: usize,
    /// Seeded for the weighted trigger roll (§5.4 step 6); used from P3-05.
    #[allow(dead_code)]
    rng: SplitMix64,
    /// Task force selected by step 6, as an index into the personality's
    /// `taskForces`; used from P3-05.
    #[allow(dead_code)]
    force: Option<u16>,
    /// Units committed to the current attack.
    attackers: Vec<EntityId>,
}

impl core::fmt::Debug for Ai {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Ai")
            .field("player", &self.player)
            .field("personality", &self.personality)
            .finish_non_exhaustive()
    }
}

impl Ai {
    /// A new opponent for `player` playing `personality`, or the §5.3 error.
    pub fn new(
        world: &World,
        player: PlayerId,
        personality: &str,
        seed: u64,
    ) -> Result<Ai, String> {
        let index = world
            .rules()
            .ai_index(personality)
            .ok_or_else(|| format!("unknown personality {personality}"))?;
        let Some(state) = world.player(player) else {
            return Err(format!("unknown player {player}"));
        };
        let def = &world.rules().ai[index];
        if def.faction != state.faction {
            return Err(format!(
                "personality {personality} is for faction {}, player {player} plays {}",
                world.rules().factions[usize::from(def.faction)].id,
                world.rules().factions[usize::from(state.faction)].id,
            ));
        }
        Ok(Ai {
            player,
            personality: index,
            rng: SplitMix64::new(seed ^ u64::from(player)),
            force: None,
            attackers: Vec::new(),
        })
    }

    /// The player this AI commands.
    pub fn player(&self) -> PlayerId {
        self.player
    }

    /// One decision pass; returns commands in the order of §5.4. Returns no
    /// commands when the player is defeated or the outcome is not `Ongoing`.
    pub fn think(&mut self, world: &World) -> Vec<Command> {
        let Some(state) = world.player(self.player) else {
            return Vec::new();
        };
        if state.defeated || world.outcome() != Outcome::Ongoing {
            return Vec::new();
        }

        // `attackers` is pruned of ids that no longer exist at the start of
        // each pass (§5.3).
        self.attackers.retain(|&id| world.entity(id).is_some());

        let rules = world.rules();
        let faction = state.faction;
        let def = &rules.ai[self.personality];
        let player = self.player;
        let mut commands = Vec::new();
        let mut budget = state.credits;

        // 1. Harvest: every idle truck drives to the nearest depot.
        if let Some(truck) = truck_kind(rules, faction) {
            for entity in world.entities() {
                if entity.owner != player
                    || entity.kind != truck
                    || !matches!(entity.order, Order::Idle { .. })
                {
                    continue;
                }
                if let Some(depot) = nearest_depot(world, entity.pos) {
                    commands.push(Command::Harvest {
                        units: vec![entity.id],
                        depot,
                    });
                }
            }
        }

        // 2. Trucks: keep `harvesters` of them, queued ones included.
        if let Some(truck) = truck_kind(rules, faction)
            && count_kind(world, player, truck) + queued(world, player, truck) < def.harvesters
            && let Some(producer) = producer_of(world, player, truck)
        {
            let cost = rules.ty(truck).cost;
            if budget >= cost {
                budget -= cost;
                commands.push(Command::Produce {
                    building: producer,
                    kind: truck,
                });
            }
        }

        // 3. Dozer: replace the starting one only when none is left.
        let dozer = rules.factions[usize::from(faction)].dozer;
        if count_kind(world, player, dozer) + queued(world, player, dozer) == 0
            && let Some(producer) = producer_of(world, player, dozer)
        {
            let cost = rules.ty(dozer).cost;
            if budget >= cost {
                commands.push(Command::Produce {
                    building: producer,
                    kind: dozer,
                });
            }
        }

        commands
    }
}

/// When `world.tick() % AI_THINK_INTERVAL == 0`, each AI in slice order thinks
/// and its commands are enqueued with `enqueue_as(ai.player(), ..)`; then
/// `world.step()` runs once.
pub fn step_with_ai(world: &mut World, ais: &mut [Ai]) {
    if world.tick().is_multiple_of(AI_THINK_INTERVAL) {
        for ai in ais.iter_mut() {
            let player = ai.player();
            let commands = ai.think(world);
            for command in commands {
                world.enqueue_as(player, command);
            }
        }
    }
    world.step();
}

/// First type of `faction` in ruleset order with `capacity > 0`.
fn truck_kind(rules: &Ruleset, faction: FactionId) -> Option<TypeId> {
    rules
        .types
        .iter()
        .position(|ty| ty.faction == i32::from(faction) && ty.capacity > 0)
        .map(|index| index as TypeId)
}

/// Own entities of `kind`.
fn count_kind(world: &World, player: PlayerId, kind: TypeId) -> u32 {
    world
        .entities()
        .iter()
        .filter(|entity| entity.owner == player && entity.kind == kind)
        .count() as u32
}

/// Queue items of `kind` over all own buildings.
fn queued(world: &World, player: PlayerId, kind: TypeId) -> u32 {
    world
        .entities()
        .iter()
        .filter(|entity| entity.owner == player)
        .filter_map(|entity| entity.site.as_ref())
        .flat_map(|site| site.queue.iter())
        .filter(|item| item.kind == kind)
        .count() as u32
}

/// Own complete building that produces `kind` and has a free slot; the
/// shortest queue wins, ties the lowest id (§5.3).
fn producer_of(world: &World, player: PlayerId, kind: TypeId) -> Option<EntityId> {
    let mut best: Option<(usize, EntityId)> = None;
    for entity in world.entities() {
        if entity.owner != player {
            continue;
        }
        let Some(site) = &entity.site else {
            continue;
        };
        if !site.complete
            || !world.rules().ty(entity.kind).produces.contains(&kind)
            || site.queue.len() as u32 >= world.rules().max_queue
        {
            continue;
        }
        let queue_len = site.queue.len();
        if best.is_none_or(|(len, _)| queue_len < len) {
            best = Some((queue_len, entity.id));
        }
    }
    best.map(|(_, id)| id)
}

/// Nearest depot with `hp > 0` by squared distance, ties the lowest id.
fn nearest_depot(world: &World, pos: FxVec2) -> Option<EntityId> {
    let mut best: Option<(i64, EntityId)> = None;
    for entity in world.entities() {
        if world.rules().ty(entity.kind).category != Category::Depot || entity.hp == 0 {
            continue;
        }
        let dx = i64::from(entity.pos.x.raw()) - i64::from(pos.x.raw());
        let dy = i64::from(entity.pos.y.raw()) - i64::from(pos.y.raw());
        let distance = dx * dx + dy * dy;
        if best.is_none_or(|(d, _)| distance < d) {
            best = Some((distance, entity.id));
        }
    }
    best.map(|(_, id)| id)
}
