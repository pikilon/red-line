//! Power, production speed, production queues and rally points (P2-09, spec
//! §5.8 Produce / Cancel / Rally and §5.9).

use crate::entity::{Entity, EntityId, HarvestPhase, Order, PlayerId, QueueItem};
use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, cell_center};
use crate::nav::{exit_cell, footprint_cells, footprint_distance};
use crate::rules::{Category, TypeId, fx_centi};
use crate::world::{MAX_UNITS, World};

/// 100 if `produced >= consumed` (including `consumed == 0`); otherwise
/// `clamp(produced * 100 / consumed, min, max)` with integer division.
pub fn production_speed_percent(produced: u32, consumed: u32, min: u32, max: u32) -> u32 {
    if produced >= consumed {
        return 100;
    }
    (u64::from(produced) * 100 / u64::from(consumed)).clamp(u64::from(min), u64::from(max)) as u32
}

impl World {
    /// Economy phase: power totals, then production queues.
    pub(crate) fn update_economy(&mut self) {
        for index in 0..self.players.len() {
            let owner = self.players[index].id;
            let (mut produced, mut consumed) = (0u32, 0u32);
            for entity in &self.entities {
                let complete = entity.site.as_ref().is_some_and(|site| site.complete);
                if entity.owner != owner || !complete {
                    continue;
                }
                let power = self.rules.ty(entity.kind).power;
                if power >= 0 {
                    produced += power as u32;
                } else {
                    consumed += power.unsigned_abs();
                }
            }
            self.players[index].power_produced = produced;
            self.players[index].power_consumed = consumed;
        }
        self.update_construction();
        self.update_production();
        self.update_harvesting();
    }

    fn production_speed(&self, owner: PlayerId) -> u32 {
        let Some(player) = self.player(owner) else {
            return 100;
        };
        let (produced, consumed) = player.power();
        production_speed_percent(
            produced,
            consumed,
            self.rules.low_power_min_speed_percent,
            self.rules.low_power_max_speed_percent,
        )
    }

    /// The head of each complete building's queue advances by the owner's
    /// speed; a finished head spawns at the building's exit cell.
    fn update_production(&mut self) {
        for index in 0..self.entities.len() {
            let entity = &self.entities[index];
            let Some(site) = &entity.site else { continue };
            let Some(head) = site.queue.first().copied() else {
                continue;
            };
            if !site.complete {
                continue;
            }
            let (owner, origin, rally) = (entity.owner, site.origin, site.rally);
            let size = self.rules.ty(entity.kind).footprint;
            let total = self.rules.ty(head.kind).build_ticks * 100;
            let progress = (head.progress + self.production_speed(owner)).min(total);
            self.queue_head(index).progress = progress;
            if progress < total || self.entities.len() as u32 >= MAX_UNITS {
                continue;
            }
            let Some(exit) = exit_cell(&self.nav, origin, size) else {
                continue;
            };
            if let Some(site) = self.entities[index].site.as_mut() {
                site.queue.remove(0);
            }
            let unit = self.spawn(owner, head.kind, cell_center(exit));
            if let Some(target) = rally {
                self.apply_move(owner, &[unit], target);
            } else if self.rules.ty(head.kind).capacity > 0 {
                self.send_to_harvest(unit);
            }
        }
    }

    fn queue_head(&mut self, index: usize) -> &mut QueueItem {
        let site = self.entities[index].site.as_mut().expect("building site");
        &mut site.queue[0]
    }

    /// `Harvest { new order id, nearest depot, None, ToDepot, 0 }` if a depot
    /// with `hp > 0` exists; the unit stays idle otherwise.
    fn send_to_harvest(&mut self, unit: EntityId) {
        let Some(index) = self.index_of(unit) else {
            return;
        };
        let pos = self.entities[index].pos;
        let Some(depot) = self.nearest_depot(pos) else {
            return;
        };
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        self.entities[index].order = Order::Harvest {
            order_id,
            depot,
            center: None,
            phase: HarvestPhase::ToDepot,
            timer: 0,
        };
    }

    /// Nearest depot with `hp > 0` by distance to its centre, ties lowest id.
    fn nearest_depot(&self, pos: FxVec2) -> Option<EntityId> {
        let mut best: Option<(Fx, EntityId)> = None;
        for depot in &self.entities {
            if self.rules.ty(depot.kind).category != Category::Depot || depot.hp == 0 {
                continue;
            }
            let distance = (depot.pos - pos).length();
            if best.is_none_or(|(d, _)| distance < d) {
                best = Some((distance, depot.id));
            }
        }
        best.map(|(_, id)| id)
    }

    /// True if `player` owns a complete building of every kind in `kinds`.
    pub(crate) fn requirements_met(&self, player: PlayerId, kinds: &[TypeId]) -> bool {
        kinds.iter().all(|&kind| {
            self.entities.iter().any(|e| {
                e.owner == player
                    && e.kind == kind
                    && e.site.as_ref().is_some_and(|site| site.complete)
            })
        })
    }

    pub(crate) fn apply_produce(&mut self, player: PlayerId, building: EntityId, kind: TypeId) {
        let Some(index) = self.index_of(building) else {
            return;
        };
        let entity = &self.entities[index];
        let complete = entity.site.as_ref().is_some_and(|site| site.complete);
        let queue_len = entity.site.as_ref().map_or(0, |site| site.queue.len());
        if entity.owner != player
            || !complete
            || self.rules.ty(entity.kind).category != Category::Building
            || usize::from(kind) >= self.rules.types.len()
            || !self.rules.ty(entity.kind).produces.contains(&kind)
        {
            return;
        }
        let target = self.rules.ty(kind);
        let Some(owner) = self.players.get_mut(usize::from(player)) else {
            return;
        };
        let (cost, requires) = (target.cost, target.requires.clone());
        if queue_len as u32 >= self.rules.max_queue
            || owner.credits < cost
            || !self.requirements_met(player, &requires)
        {
            return;
        }
        self.players[usize::from(player)].credits -= cost;
        if let Some(site) = self.entities[index].site.as_mut() {
            site.queue.push(QueueItem { kind, progress: 0 });
        }
    }

    pub(crate) fn apply_cancel(&mut self, player: PlayerId, building: EntityId) {
        let Some(index) = self.index_of(building) else {
            return;
        };
        if self.entities[index].owner != player {
            return;
        }
        let Some(item) = self.entities[index]
            .site
            .as_mut()
            .and_then(|s| s.queue.pop())
        else {
            return;
        };
        let refund = self.rules.ty(item.kind).cost;
        if let Some(owner) = self.players.get_mut(usize::from(player)) {
            owner.credits = owner.credits.saturating_add(refund);
        }
    }

    pub(crate) fn apply_rally(&mut self, player: PlayerId, building: EntityId, target: FxVec2) {
        let Some(index) = self.index_of(building) else {
            return;
        };
        let entity = &self.entities[index];
        if entity.owner != player
            || self.rules.ty(entity.kind).category != Category::Building
            || self.rules.ty(entity.kind).produces.is_empty()
        {
            return;
        }
        let target = self.clamp_to_map(target);
        if let Some(site) = self.entities[index].site.as_mut() {
            site.rally = Some(target);
        }
    }

    /// Spec 5.4 entity distance: to a unit the Euclidean distance, to a
    /// building or depot the distance to its footprint rectangle.
    pub(crate) fn entity_distance(&self, from: FxVec2, to: &Entity) -> Fx {
        match &to.site {
            Some(site) => footprint_distance(from, site.origin, self.rules.ty(to.kind).footprint),
            None => (from - to.pos).length(),
        }
    }

    /// Every incomplete building with a docked builder gains one speed step of
    /// progress and the matching hit points; at the total it completes.
    fn update_construction(&mut self) {
        let dock = fx_centi(self.rules.dock_range_centi);
        for index in 0..self.entities.len() {
            let site_entity = &self.entities[index];
            let Some(site) = &site_entity.site else {
                continue;
            };
            if site.complete {
                continue;
            }
            let (id, owner) = (site_entity.id, site_entity.owner);
            let builders: Vec<usize> = (0..self.entities.len())
                .filter(|&i| {
                    let unit = &self.entities[i];
                    unit.owner == owner
                        && matches!(unit.order, Order::Build { building, .. } if building == id)
                })
                .collect();
            let docked = builders.iter().any(|&i| {
                self.entity_distance(self.entities[i].pos, &self.entities[index]) <= dock
            });
            if !docked {
                continue;
            }
            let ty = self.rules.ty(site_entity.kind);
            let total = u64::from(ty.build_ticks) * 100;
            let initial = (ty.hp / 10).max(1);
            let gain = |progress: u64| {
                (u64::from(ty.hp.saturating_sub(initial)) * progress)
                    .checked_div(total)
                    .unwrap_or(0)
            };
            let old = u64::from(site.progress);
            let new = (old + u64::from(self.production_speed(owner))).min(total);
            let (free_unit, kind) = (ty.free_unit, site_entity.kind);
            let building = &mut self.entities[index];
            building.hp += (gain(new) - gain(old)) as u32;
            let site = building.site.as_mut().expect("building site");
            site.progress = new as u32;
            if new < total {
                continue;
            }
            site.complete = true;
            let origin = site.origin;
            for &i in &builders {
                if let Order::Build { order_id, .. } = self.entities[i].order {
                    self.entities[i].order = Order::Idle {
                        last_order_id: order_id,
                    };
                }
            }
            self.spawn_free_unit(owner, kind, free_unit, origin);
        }
    }

    /// The free unit of a completed building appears at its exit cell.
    fn spawn_free_unit(&mut self, owner: PlayerId, kind: TypeId, free_unit: i32, origin: Cell) {
        if free_unit < 0 || self.entities.len() as u32 >= MAX_UNITS {
            return;
        }
        let size = self.rules.ty(kind).footprint;
        let Some(exit) = exit_cell(&self.nav, origin, size) else {
            return;
        };
        let unit_kind = free_unit as TypeId;
        let unit = self.spawn(owner, unit_kind, cell_center(exit));
        if self.rules.ty(unit_kind).capacity > 0 {
            self.send_to_harvest(unit);
        }
    }

    pub(crate) fn apply_construct(
        &mut self,
        player: PlayerId,
        dozer: EntityId,
        kind: TypeId,
        origin: Cell,
    ) {
        let Some(index) = self.index_of(dozer) else {
            return;
        };
        let builder = &self.entities[index];
        if builder.owner != player
            || builder.site.is_some()
            || usize::from(kind) >= self.rules.types.len()
            || !self.rules.ty(builder.kind).builds.contains(&kind)
        {
            return;
        }
        let cost = self.rules.ty(kind).cost;
        if !self.can_construct(player, kind, origin) {
            return;
        }
        self.players[usize::from(player)].credits -= cost;
        let building = self.place_building(player, kind, origin, false);
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        if let Some(index) = self.index_of(dozer) {
            self.entities[index].order = Order::Build { order_id, building };
        }
    }

    /// Every footprint cell is explored by `player`.
    pub(crate) fn footprint_explored(
        &self,
        player: PlayerId,
        origin: Cell,
        size: [u16; 2],
    ) -> bool {
        let Some(owner) = self.player(player) else {
            return false;
        };
        footprint_cells(origin, size)
            .iter()
            .all(|&c| owner.explored.get(self.terrain.index(c) as usize) == Some(&true))
    }

    pub(crate) fn apply_resume(
        &mut self,
        player: PlayerId,
        units: &[EntityId],
        building: EntityId,
    ) {
        let incomplete = self.entity(building).is_some_and(|b| {
            b.owner == player && b.site.as_ref().is_some_and(|site| !site.complete)
        });
        if !incomplete {
            return;
        }
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            let unit = &self.entities[index];
            if unit.owner == player
                && unit.site.is_none()
                && !self.rules.ty(unit.kind).builds.is_empty()
            {
                self.entities[index].order = Order::Build { order_id, building };
            }
        }
    }

    pub(crate) fn apply_stop(&mut self, player: PlayerId, units: &[EntityId]) {
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            let unit = &mut self.entities[index];
            if unit.owner != player || unit.site.is_some() {
                continue;
            }
            let last_order_id = match unit.order {
                Order::Idle { last_order_id } => last_order_id,
                Order::Move { order_id, .. }
                | Order::Attack { order_id, .. }
                | Order::Harvest { order_id, .. }
                | Order::Build { order_id, .. } => order_id,
            };
            unit.order = Order::Idle { last_order_id };
        }
    }

    /// Spec 5.8 `Harvest`: valid if `depot` is a depot; every listed unit of
    /// `player` with `capacity > 0` starts toward it (cargo kept).
    pub(crate) fn apply_harvest(&mut self, player: PlayerId, units: &[EntityId], depot: EntityId) {
        if !self.is_depot(depot) {
            return;
        }
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            let unit = &self.entities[index];
            if unit.owner == player && unit.site.is_none() && self.rules.ty(unit.kind).capacity > 0
            {
                self.entities[index].order = Order::Harvest {
                    order_id,
                    depot,
                    center: None,
                    phase: HarvestPhase::ToDepot,
                    timer: 0,
                };
            }
        }
    }

    fn is_depot(&self, id: EntityId) -> bool {
        self.entity(id)
            .is_some_and(|e| self.rules.ty(e.kind).category == Category::Depot)
    }

    /// Entity distance from unit `index` to `target` is within dock range.
    fn docked(&self, index: usize, target: EntityId) -> bool {
        let dock = fx_centi(self.rules.dock_range_centi);
        self.entity(target)
            .is_some_and(|t| self.entity_distance(self.entities[index].pos, t) <= dock)
    }

    /// Nearest complete drop-off building of `owner` by distance to its
    /// centre, ties lowest id.
    fn nearest_center(&self, owner: PlayerId, pos: FxVec2) -> Option<EntityId> {
        let mut best: Option<(Fx, EntityId)> = None;
        for e in self.entities.iter().filter(|e| self.is_drop_off(owner, e)) {
            let distance = (e.pos - pos).length();
            if best.is_none_or(|(d, _)| distance < d) {
                best = Some((distance, e.id));
            }
        }
        best.map(|(_, id)| id)
    }

    fn is_drop_off(&self, owner: PlayerId, e: &Entity) -> bool {
        e.owner == owner
            && self.rules.ty(e.kind).drop_off
            && e.site.as_ref().is_some_and(|site| site.complete)
    }

    /// Spec 5.9 harvesting: advances every `Harvest` order one tick.
    fn update_harvesting(&mut self) {
        for index in 0..self.entities.len() {
            let Order::Harvest {
                order_id,
                mut depot,
                mut center,
                mut phase,
                mut timer,
            } = self.entities[index].order
            else {
                continue;
            };
            let (owner, pos, kind) = {
                let unit = &self.entities[index];
                (unit.owner, unit.pos, unit.kind)
            };
            match phase {
                HarvestPhase::ToDepot => {
                    let alive = self.entity(depot).is_some_and(|d| d.hp > 0);
                    if !alive {
                        let Some(found) = self.nearest_depot(pos) else {
                            self.entities[index].order = Order::Idle {
                                last_order_id: order_id,
                            };
                            continue;
                        };
                        depot = found;
                    }
                    if self.docked(index, depot) {
                        phase = HarvestPhase::Loading;
                        timer = self.rules.ty(kind).load_ticks;
                    }
                }
                HarvestPhase::Loading => {
                    timer = timer.saturating_sub(1);
                    if timer == 0 {
                        let capacity = self.rules.ty(kind).capacity;
                        let cargo = self.entities[index].cargo;
                        let take = self.index_of(depot).map_or(0, |d| {
                            let take = capacity.saturating_sub(cargo).min(self.entities[d].hp);
                            self.entities[d].hp -= take;
                            take
                        });
                        let cargo = cargo + take;
                        self.entities[index].cargo = cargo;
                        if cargo > 0 {
                            phase = HarvestPhase::ToCenter;
                            center = None;
                        } else {
                            phase = HarvestPhase::ToDepot;
                        }
                    }
                }
                HarvestPhase::ToCenter => {
                    let valid = center
                        .and_then(|c| self.entity(c))
                        .is_some_and(|c| self.is_drop_off(owner, c));
                    if !valid {
                        center = self.nearest_center(owner, pos);
                    }
                    if center.is_some_and(|c| self.docked(index, c)) {
                        phase = HarvestPhase::Unloading;
                        timer = self.rules.ty(kind).unload_ticks;
                    }
                }
                HarvestPhase::Unloading => {
                    timer = timer.saturating_sub(1);
                    if timer == 0 {
                        let cargo = std::mem::take(&mut self.entities[index].cargo);
                        if let Some(player) = self.players.get_mut(usize::from(owner)) {
                            player.credits = player.credits.saturating_add(cargo);
                        }
                        phase = HarvestPhase::ToDepot;
                    }
                }
            }
            self.entities[index].order = Order::Harvest {
                order_id,
                depot,
                center,
                phase,
                timer,
            };
        }
    }

    /// Spec 5.10 `Harvest`: the footprint being driven to (`ToDepot` the
    /// depot, `ToCenter` the center when set); `None` while not moving.
    fn harvest_target(&self, index: usize) -> Option<EntityId> {
        let Order::Harvest {
            depot,
            center,
            phase,
            ..
        } = self.entities[index].order
        else {
            return None;
        };
        let target = match phase {
            HarvestPhase::ToDepot => Some(depot),
            HarvestPhase::ToCenter => center,
            HarvestPhase::Loading | HarvestPhase::Unloading => None,
        }?;
        self.entity(target)?;
        Some(target)
    }

    /// Approach cell of the current harvest target, if the truck is driving.
    pub(crate) fn harvest_goal(&self, index: usize) -> Option<Cell> {
        self.harvest_target(index)
            .and_then(|target| self.build_goal(target))
    }

    /// Movement phase for a `Harvest` order: a step toward the target's
    /// approach cell unless docked or not driving.
    pub(crate) fn step_harvest(&mut self, index: usize) {
        let Some(target) = self.harvest_target(index) else {
            return;
        };
        if self.docked(index, target) {
            return;
        }
        if let Some(goal) = self.build_goal(target) {
            self.step_toward_goal(index, goal);
        }
    }
}
