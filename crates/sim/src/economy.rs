//! Power, production speed, production queues and rally points (P2-09, spec
//! §5.8 Produce / Cancel / Rally and §5.9).

use crate::entity::{EntityId, HarvestPhase, Order, PlayerId, QueueItem};
use crate::fixed::FxVec2;
use crate::map::cell_center;
use crate::nav::exit_cell;
use crate::rules::{Category, TypeId};
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
        self.update_production();
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
        let mut best: Option<(crate::fixed::Fx, EntityId)> = None;
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
    fn requirements_met(&self, player: PlayerId, kinds: &[TypeId]) -> bool {
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
}
