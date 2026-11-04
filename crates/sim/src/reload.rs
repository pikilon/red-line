//! Spec 43 §4.6: the Reload order. A player sends units that have something to
//! reload (a sortie flyer with rounds missing, a launcher crew below its
//! charges) to be resupplied now, instead of waiting for the clip to run dry.

use crate::entity::{EntityId, Order, PlayerId};
use crate::fixed::FxVec2;
use crate::world::World;

impl World {
    /// `Command::Reload`. For each own unit with rounds or charges missing:
    /// a sortie flyer gets `ReturnToBase` (the existing dock-and-reload flow),
    /// a launcher crew on foot moves to the nearest own `resupplies` source.
    /// Units that are full, have nothing to reload or find no base or source
    /// are left alone. Ends idle: no old order is resumed.
    pub(crate) fn apply_reload(&mut self, player: PlayerId, units: &[EntityId]) {
        // (source id, source position, crews sent to it), in first-seen order.
        let mut crews: Vec<(EntityId, FxVec2, Vec<EntityId>)> = Vec::new();
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            let entity = &self.entities[index];
            if entity.owner != player
                || entity.hp == 0
                || entity.site.is_some()
                || entity.contained()
            {
                continue;
            }
            let ty = self.rules.ty(entity.kind);
            if let Some(sortie) = ty.sortie {
                if entity.ammo < sortie.clip && self.nearest_base(index).is_some() {
                    let order_id = self.next_order_id;
                    self.next_order_id += 1;
                    self.entities[index].order = Order::ReturnToBase { order_id };
                }
            } else if let Some(charges) = ty.charges
                && charges.refill_radius_centi > 0
                && entity.charges < charges.max
            {
                self.reload_crew(index, charges.refill_radius_centi, &mut crews);
            }
        }
        for (_, target, ids) in crews {
            self.apply_move(player, &ids, target);
        }
    }

    /// A crew already inside a source's radius waits there idle (it refills
    /// where it stands); otherwise it is queued to walk to the nearest source.
    fn reload_crew(
        &mut self,
        index: usize,
        radius_centi: u32,
        crews: &mut Vec<(EntityId, FxVec2, Vec<EntityId>)>,
    ) {
        let entity = &self.entities[index];
        let (id, pos, owner) = (entity.id, entity.pos, entity.owner);
        if self.resupplied(index, radius_centi) {
            let last_order_id = self.order_id_of(index);
            self.entities[index].order = Order::Idle { last_order_id };
            return;
        }
        let mut best: Option<(i64, EntityId, FxVec2)> = None;
        for source in &self.entities {
            if source.owner != owner
                || source.hp == 0
                || source.id == id
                || source.contained()
                || source.site.as_ref().is_some_and(|site| !site.complete)
                || !self.rules.ty(source.kind).resupplies
            {
                continue;
            }
            let distance = i64::from((source.pos - pos).length().raw());
            if best.is_none_or(|(d, other, _)| (distance, source.id) < (d, other)) {
                best = Some((distance, source.id, source.pos));
            }
        }
        let Some((_, source, target)) = best else {
            return;
        };
        match crews.iter_mut().find(|(other, _, _)| *other == source) {
            Some((_, _, ids)) => ids.push(id),
            None => crews.push((source, target, vec![id])),
        }
    }

    /// The id of the order entity `index` holds (an idle unit's last one).
    fn order_id_of(&self, index: usize) -> u32 {
        match self.entities[index].order {
            Order::Idle { last_order_id } => last_order_id,
            Order::Move { order_id, .. }
            | Order::Attack { order_id, .. }
            | Order::AttackGround { order_id, .. }
            | Order::Harvest { order_id, .. }
            | Order::Build { order_id, .. }
            | Order::Garrison { order_id, .. }
            | Order::Board { order_id, .. }
            | Order::Repair { order_id, .. }
            | Order::RepairBuilding { order_id, .. }
            | Order::Heal { order_id, .. }
            | Order::RepairVehicle { order_id, .. }
            | Order::ReturnToBase { order_id } => order_id,
        }
    }
}
