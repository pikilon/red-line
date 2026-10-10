//! Computer opponent (spec 05 §5.3, §5.4).
//!
//! P3-03 implements the skeleton and the first three steps of the decision
//! pass: harvesting, truck production and the starting dozer. P3-04 adds step 4
//! (build order, site search, power substitution and resume). P3-05 adds steps
//! 5-8: defense, task-force production, launch and retarget (§5.6).

use std::collections::BTreeMap;

use crate::entity::{Entity, EntityId, NEUTRAL, Order, PlayerId};
use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, cell_of};
use crate::nav::footprint_center;
use crate::rng::SplitMix64;
use crate::rules::{AiDef, Category, FactionId, Ruleset, TypeId, fx_centi};
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
    /// Seeded for the weighted trigger roll (§5.4 step 6).
    rng: SplitMix64,
    /// Task force selected by step 6, as an index into the personality's
    /// `taskForces`.
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

        // No own building means no anchor, and the AI does nothing (§5.3).
        let Some(anchor) = anchor(world, player, faction) else {
            return Vec::new();
        };

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
        let dozer_kind = rules.factions[usize::from(faction)].dozer;
        if count_kind(world, player, dozer_kind) + queued(world, player, dozer_kind) == 0
            && let Some(producer) = producer_of(world, player, dozer_kind)
        {
            let cost = rules.ty(dozer_kind).cost;
            if budget >= cost {
                budget -= cost;
                commands.push(Command::Produce {
                    building: producer,
                    kind: dozer_kind,
                });
            }
        }

        // 4. Build: resume an orphan site, else follow the build order.
        if let Some(dozer) = lowest_idle_dozer(world, player, dozer_kind) {
            if let Some(building) = lowest_incomplete_building(world, player) {
                // One site at a time: resume it unless a dozer already does.
                let claimed = world.entities().iter().any(|entity| {
                    entity.owner == player
                        && entity.kind == dozer_kind
                        && matches!(
                            entity.order,
                            Order::Build { building: b, .. } if b == building
                        )
                });
                if !claimed {
                    commands.push(Command::Resume {
                        units: vec![dozer],
                        building,
                    });
                }
            } else if let Some(mut kind) = next_build_entry(world, player, def) {
                let (produced, consumed) = state.power();
                let power = rules.ty(kind).power;
                if power < 0
                    && i64::from(produced) - i64::from(consumed) + i64::from(power) < 0
                    && let Some(power_plant) = power_kind(rules, faction)
                {
                    kind = power_plant;
                }
                let cost = rules.ty(kind).cost;
                if budget >= cost
                    && let Some(origin) = find_site(world, player, kind, anchor)
                {
                    budget -= cost;
                    commands.push(Command::Construct {
                        dozer,
                        kind,
                        origin,
                    });
                }
            }
        }

        // 5. Defense: visible enemy units inside the defense radius of an own
        // building. A defense attack skips task-force production and launch.
        let threats = threats(world, player, def.defense_radius_centi);
        let defending = !threats.is_empty();
        if defending {
            let center = anchor_center(world, player, faction).unwrap_or(FxVec2::ZERO);
            if let Some(&target) = threats
                .iter()
                .min_by_key(|&&id| squared_distance(entity_pos(world, id), center))
            {
                let units: Vec<EntityId> = pool(world, player, faction, &self.attackers)
                    .into_iter()
                    .filter(|&id| {
                        !matches!(
                            world.entity(id).map(|entity| &entity.order),
                            Some(Order::Attack { .. })
                        )
                    })
                    .collect();
                if !units.is_empty() {
                    commands.push(Command::Attack { units, target });
                }
            }
        }

        // Units that received the launch order this pass, so step 8 does not
        // target them twice.
        let mut launched: Vec<EntityId> = Vec::new();

        if !defending {
            // 6. Production: select a task force, then produce its missing
            // units, stopping when the budget or the producers run out.
            if self.force.is_none() {
                self.force = choose_force(def, world.tick(), &mut self.rng);
            }
            if let Some(force_index) = self.force {
                let force = &def.task_forces[usize::from(force_index)];
                let mut extra: BTreeMap<EntityId, u32> = BTreeMap::new();
                'produce: for &(kind, count) in &force.units {
                    let have = pool_of_kind(world, player, faction, &self.attackers, kind)
                        + queued(world, player, kind);
                    let missing = count.saturating_sub(have);
                    for _ in 0..missing {
                        let Some(producer) = producer_of_with(world, player, kind, &extra) else {
                            break 'produce;
                        };
                        let cost = rules.ty(kind).cost;
                        if budget < cost {
                            break 'produce;
                        }
                        budget -= cost;
                        *extra.entry(producer).or_insert(0) += 1;
                        commands.push(Command::Produce {
                            building: producer,
                            kind,
                        });
                    }
                }
            }

            // 7. Launch: once the whole force waits in the pool, commit it.
            if let Some(force_index) = self.force {
                let force = &def.task_forces[usize::from(force_index)];
                let ready = force.units.iter().all(|&(kind, count)| {
                    pool_of_kind(world, player, faction, &self.attackers, kind) >= count
                });
                if ready {
                    let members = pool(world, player, faction, &self.attackers);
                    for &(kind, count) in &force.units {
                        launched.extend(
                            members
                                .iter()
                                .copied()
                                .filter(|&id| {
                                    world.entity(id).is_some_and(|entity| entity.kind == kind)
                                })
                                .take(count as usize),
                        );
                    }
                    self.attackers.extend(launched.iter().copied());
                    self.force = None;
                    if !launched.is_empty()
                        && let Some(target) =
                            target_from_centroid(world, player, centroid(world, &launched))
                    {
                        commands.push(order_for(target, launched.clone()));
                    }
                }
            }
        }

        // 8. Retarget: attackers whose order finished go on the offensive.
        let idle: Vec<EntityId> = self
            .attackers
            .iter()
            .copied()
            .filter(|id| !launched.contains(id))
            .filter(|&id| {
                world
                    .entity(id)
                    .is_some_and(|entity| matches!(entity.order, Order::Idle { .. }))
            })
            .collect();
        if !idle.is_empty()
            && let Some(target) = target_from_centroid(world, player, centroid(world, &idle))
        {
            commands.push(order_for(target, idle));
        }

        debug_assert!(budget <= state.credits);
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

/// Lowest-id own dozer whose order is `Idle` (§5.4 step 4).
fn lowest_idle_dozer(world: &World, player: PlayerId, dozer: TypeId) -> Option<EntityId> {
    world
        .entities()
        .iter()
        .find(|entity| {
            entity.owner == player
                && entity.kind == dozer
                && matches!(entity.order, Order::Idle { .. })
        })
        .map(|entity| entity.id)
}

/// Lowest-id own incomplete building (§5.4 step 4).
fn lowest_incomplete_building(world: &World, player: PlayerId) -> Option<EntityId> {
    world
        .entities()
        .iter()
        .find(|entity| {
            entity.owner == player && entity.site.as_ref().is_some_and(|site| !site.complete)
        })
        .map(|entity| entity.id)
}

/// First build-order entry `i` with fewer own buildings than occurrences of its
/// kind in `build_order[0..=i]` (§5.4 step 4).
fn next_build_entry(world: &World, player: PlayerId, def: &AiDef) -> Option<TypeId> {
    for (index, &kind) in def.build_order.iter().enumerate() {
        let built = count_kind(world, player, kind);
        let wanted = def.build_order[..=index]
            .iter()
            .filter(|&&candidate| candidate == kind)
            .count() as u32;
        if built < wanted {
            return Some(kind);
        }
    }
    None
}

/// First building type of `faction` with `power > 0` (§5.3 power kind).
fn power_kind(rules: &Ruleset, faction: FactionId) -> Option<TypeId> {
    rules
        .types
        .iter()
        .position(|ty| {
            ty.faction == i32::from(faction) && ty.category == Category::Building && ty.power > 0
        })
        .map(|index| index as TypeId)
}

/// HQ origin, or the lowest-id own building's origin, or `None` with no own
/// building (§5.3).
fn anchor(world: &World, player: PlayerId, faction: FactionId) -> Option<Cell> {
    let hq = world.rules().factions[usize::from(faction)].hq;
    let mut own_buildings = world
        .entities()
        .iter()
        .filter(|entity| entity.owner == player && entity.site.is_some());
    if let Some(hq_entity) = own_buildings
        .clone()
        .find(|entity| entity.kind == hq && entity.site.as_ref().is_some_and(|site| site.complete))
    {
        return hq_entity.site.as_ref().map(|site| site.origin);
    }
    own_buildings
        .next()
        .and_then(|entity| entity.site.as_ref().map(|site| site.origin))
}

/// §5.5 site search: first candidate on the rings `BASE_RING_MIN..=BASE_RING_MAX`
/// around `anchor` that is constructible and whose margin is clear.
fn find_site(world: &World, player: PlayerId, kind: TypeId, anchor: Cell) -> Option<Cell> {
    let size = world.rules().ty(kind).footprint;
    for ring in BASE_RING_MIN..=BASE_RING_MAX {
        for y in (anchor.y - ring)..=(anchor.y + ring) {
            let full_row = (y - anchor.y).abs() == ring;
            let step = if full_row { 1 } else { 2 * ring };
            let mut x = anchor.x - ring;
            while x <= anchor.x + ring {
                let origin = Cell { x, y };
                if world.can_construct(player, kind, origin) && margin_clear(world, origin, size) {
                    return Some(origin);
                }
                x += step;
            }
        }
    }
    None
}

/// §5.5 margin: the in-bounds cells at Chebyshev distance 1 around the
/// footprint must be passable and hold no unit.
fn margin_clear(world: &World, origin: Cell, size: [u16; 2]) -> bool {
    let (width, height) = (i32::from(size[0]), i32::from(size[1]));
    for dy in -1..=height {
        for dx in -1..=width {
            if dx >= 0 && dx < width && dy >= 0 && dy < height {
                continue;
            }
            let cell = Cell {
                x: origin.x + dx,
                y: origin.y + dy,
            };
            if !world.map().in_bounds(cell) {
                continue;
            }
            if !world.map().is_passable(cell) {
                return false;
            }
            if world
                .entities()
                .iter()
                .any(|entity| entity.site.is_none() && cell_of(entity.pos) == cell)
            {
                return false;
            }
        }
    }
    true
}

/// Squared raw distance between two positions (§5.3 *dist²*).
fn squared_distance(a: FxVec2, b: FxVec2) -> i64 {
    let dx = i64::from(a.x.raw()) - i64::from(b.x.raw());
    let dy = i64::from(a.y.raw()) - i64::from(b.y.raw());
    dx * dx + dy * dy
}

/// Position of `id`, or the origin when it vanished (callers only pass live
/// ids).
fn entity_pos(world: &World, id: EntityId) -> FxVec2 {
    world.entity(id).map_or(FxVec2::ZERO, |entity| entity.pos)
}

/// Footprint centre of the anchor building (§5.3, §5.4 step 5).
fn anchor_center(world: &World, player: PlayerId, faction: FactionId) -> Option<FxVec2> {
    let hq = world.rules().factions[usize::from(faction)].hq;
    let mut own_buildings = world
        .entities()
        .iter()
        .filter(|entity| entity.owner == player && entity.site.is_some());
    let entity = own_buildings
        .clone()
        .find(|entity| entity.kind == hq && entity.site.as_ref().is_some_and(|site| site.complete))
        .or_else(|| own_buildings.next())?;
    let origin = entity.site.as_ref()?.origin;
    Some(footprint_center(
        origin,
        world.rules().ty(entity.kind).footprint,
    ))
}

/// Combat units of `player` that are not in `attackers`, ascending id (§5.3
/// *pool*).
fn pool(
    world: &World,
    player: PlayerId,
    faction: FactionId,
    attackers: &[EntityId],
) -> Vec<EntityId> {
    let rules = world.rules();
    let dozer = rules.factions[usize::from(faction)].dozer;
    let truck = truck_kind(rules, faction);
    world
        .entities()
        .iter()
        .filter(|entity| {
            entity.owner == player
                && rules.ty(entity.kind).category == Category::Unit
                && rules.weapon_of(entity.kind).is_some()
                && entity.kind != dozer
                && Some(entity.kind) != truck
                && !attackers.contains(&entity.id)
        })
        .map(|entity| entity.id)
        .collect()
}

/// Pool units of `kind` (ascending id).
fn pool_of_kind(
    world: &World,
    player: PlayerId,
    faction: FactionId,
    attackers: &[EntityId],
    kind: TypeId,
) -> u32 {
    pool(world, player, faction, attackers)
        .into_iter()
        .filter(|&id| world.entity(id).is_some_and(|entity| entity.kind == kind))
        .count() as u32
}

/// Enemy unit threats inside the defense radius of any own building (§5.4
/// step 5), ascending id.
fn threats(world: &World, player: PlayerId, radius_centi: u32) -> Vec<EntityId> {
    let radius = i64::from(fx_centi(radius_centi).raw());
    let threshold = radius * radius;
    let centers: Vec<FxVec2> = world
        .entities()
        .iter()
        .filter(|entity| entity.owner == player && entity.site.is_some())
        .filter_map(|entity| {
            let origin = entity.site.as_ref()?.origin;
            Some(footprint_center(
                origin,
                world.rules().ty(entity.kind).footprint,
            ))
        })
        .collect();
    if centers.is_empty() {
        return Vec::new();
    }
    world
        .entities()
        .iter()
        .filter(|entity| {
            entity.owner != player
                && entity.owner != NEUTRAL
                && world.rules().ty(entity.kind).category == Category::Unit
                && world.is_entity_visible(player, entity.id)
                && centers
                    .iter()
                    .any(|&center| squared_distance(entity.pos, center) <= threshold)
        })
        .map(|entity| entity.id)
        .collect()
}

/// Picks the eligible trigger of the weighted §5.4 step 6 roll.
fn choose_force(def: &AiDef, tick: u32, rng: &mut SplitMix64) -> Option<u16> {
    let total: u64 = def
        .triggers
        .iter()
        .filter(|trigger| trigger.min_tick <= tick)
        .map(|trigger| u64::from(trigger.weight))
        .sum();
    if total == 0 {
        return None;
    }
    let roll = rng.next_u64() % total;
    let mut cumulative = 0u64;
    for trigger in def
        .triggers
        .iter()
        .filter(|trigger| trigger.min_tick <= tick)
    {
        cumulative += u64::from(trigger.weight);
        if cumulative > roll {
            return Some(trigger.task_force);
        }
    }
    None
}

/// Producer of `kind` accounting for `Produce` commands already emitted this
/// pass (§5.4 step 6).
fn producer_of_with(
    world: &World,
    player: PlayerId,
    kind: TypeId,
    extra: &BTreeMap<EntityId, u32>,
) -> Option<EntityId> {
    let max_queue = world.rules().max_queue;
    let mut best: Option<(u32, EntityId)> = None;
    for entity in world.entities() {
        if entity.owner != player {
            continue;
        }
        let Some(site) = &entity.site else {
            continue;
        };
        if !site.complete || !world.rules().ty(entity.kind).produces.contains(&kind) {
            continue;
        }
        let queued = site.queue.len() as u32 + extra.get(&entity.id).copied().unwrap_or(0);
        if queued >= max_queue {
            continue;
        }
        if best.is_none_or(|(len, _)| queued < len) {
            best = Some((queued, entity.id));
        }
    }
    best.map(|(_, id)| id)
}

/// Integer mean of the positions of `ids`, truncated (§5.6).
fn centroid(world: &World, ids: &[EntityId]) -> FxVec2 {
    if ids.is_empty() {
        return FxVec2::ZERO;
    }
    let mut sum_x: i64 = 0;
    let mut sum_y: i64 = 0;
    for &id in ids {
        let pos = entity_pos(world, id);
        sum_x += i64::from(pos.x.raw());
        sum_y += i64::from(pos.y.raw());
    }
    let count = ids.len() as i64;
    FxVec2::new(
        Fx::from_raw((sum_x / count) as i32),
        Fx::from_raw((sum_y / count) as i32),
    )
}

/// The shape of the §5.6 order chosen from a centroid.
enum OrderTarget {
    /// A visible enemy entity: `Attack`.
    Entity(EntityId),
    /// A position: `Move`.
    Position(FxVec2),
}

fn order_for(target: OrderTarget, units: Vec<EntityId>) -> Command {
    match target {
        OrderTarget::Entity(target) => Command::Attack { units, target },
        OrderTarget::Position(target) => Command::Move { units, target },
    }
}

/// §5.6 target choice from a centroid `c`.
fn target_from_centroid(world: &World, player: PlayerId, c: FxVec2) -> Option<OrderTarget> {
    // 1. Visible enemy building of least dist² to `c`.
    if let Some(id) = nearest_visible(world, player, c, |entity| {
        entity.owner != player
            && entity.owner != NEUTRAL
            && world.rules().ty(entity.kind).category == Category::Building
    }) {
        return Some(OrderTarget::Entity(id));
    }
    // 2. Own ghost of least dist² from its footprint centre to `c`.
    if let Some(center) = nearest_ghost(world, player, c) {
        return Some(OrderTarget::Position(center));
    }
    // 3. Visible enemy unit of least dist² to `c`.
    if let Some(id) = nearest_visible(world, player, c, |entity| {
        entity.owner != player
            && entity.owner != NEUTRAL
            && world.rules().ty(entity.kind).category == Category::Unit
    }) {
        return Some(OrderTarget::Entity(id));
    }
    // 4. The first map start that is not `player`.
    enemy_start_center(world, player).map(OrderTarget::Position)
}

/// Least-dist² visible entity matching `accept`, ties the lowest id.
fn nearest_visible(
    world: &World,
    player: PlayerId,
    c: FxVec2,
    mut accept: impl FnMut(&Entity) -> bool,
) -> Option<EntityId> {
    let mut best: Option<(i64, EntityId)> = None;
    for entity in world.entities() {
        if !accept(entity) || !world.is_entity_visible(player, entity.id) {
            continue;
        }
        let distance = squared_distance(entity.pos, c);
        if best.is_none_or(|(d, _)| distance < d) {
            best = Some((distance, entity.id));
        }
    }
    best.map(|(_, id)| id)
}

/// Footprint centre of the own ghost of least dist² to `c`, ties the lowest id.
fn nearest_ghost(world: &World, player: PlayerId, c: FxVec2) -> Option<FxVec2> {
    let state = world.player(player)?;
    let mut best: Option<(i64, FxVec2)> = None;
    for ghost in state.ghosts().values() {
        let center = footprint_center(ghost.origin, world.rules().ty(ghost.kind).footprint);
        let distance = squared_distance(center, c);
        if best.is_none_or(|(d, _)| distance < d) {
            best = Some((distance, center));
        }
    }
    best.map(|(_, center)| center)
}

/// Footprint centre of the HQ of the first map start that is not `player`
/// (§5.6 step 4).
///
/// `World` does not retain the map it was built from, so the map is found among
/// `Ruleset::maps` by matching the public start factions to the players
/// (`skirmish` builds start `i` as player `i`).
fn enemy_start_center(world: &World, player: PlayerId) -> Option<FxVec2> {
    let players = world.players();
    let map = world.rules().maps.iter().find(|map| {
        map.starts.len() == players.len()
            && map
                .starts
                .iter()
                .zip(players)
                .all(|(start, state)| start.faction == state.faction)
    })?;
    let index = (0..map.starts.len()).find(|&index| index != usize::from(player))?;
    let start = &map.starts[index];
    let hq = world.rules().factions[usize::from(start.faction)].hq;
    Some(footprint_center(
        Cell {
            x: start.hq[0],
            y: start.hq[1],
        },
        world.rules().ty(hq).footprint,
    ))
}
