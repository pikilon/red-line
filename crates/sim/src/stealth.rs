//! Spec 61: stealth and detection (Zero Hour `StealthUpdate` and
//! `StealthDetectorUpdate`). A stealth unit is hidden from every other player
//! while `exposed == 0`; a shot, a hit, a move (when the type says so) and a
//! detector sweep raise `exposed`, which then counts down one per tick.

use crate::entity::{Entity, NEUTRAL};
use crate::world::World;

impl World {
    /// True for a stealth unit that is not exposed. Contained units are never
    /// stealthed (they have their own hiding rules).
    pub fn is_stealthed(&self, entity: &Entity) -> bool {
        self.rules.ty(entity.kind).stealth.is_some() && entity.exposed == 0 && entity.hp > 0
    }

    /// A shot gives the shooter away for the type's `delay_ticks`.
    pub(crate) fn expose_after_shot(&mut self, index: usize) {
        self.expose(index);
    }

    /// Taking a hit gives the victim away.
    pub(crate) fn expose_after_hit(&mut self, index: usize) {
        self.expose(index);
    }

    fn expose(&mut self, index: usize) {
        if let Some(stealth) = self.rules.ty(self.entities[index].kind).stealth {
            let entity = &mut self.entities[index];
            entity.exposed = entity.exposed.max(stealth.delay_ticks);
        }
    }

    /// Stealth phase (after vision, before combat): timers count down, movers
    /// that cannot hide while moving are exposed, and every detector whose
    /// scan tick has come exposes the enemy stealth units in range for one
    /// scan period (`rate_ticks + 1`).
    pub(crate) fn update_stealth(&mut self) {
        for index in 0..self.entities.len() {
            let stealth = self.rules.ty(self.entities[index].kind).stealth;
            let entity = &mut self.entities[index];
            entity.exposed = entity.exposed.saturating_sub(1);
            if let Some(stealth) = stealth
                && stealth.breaks_on_move
                && entity.site.is_none()
                && !matches!(entity.order, crate::entity::Order::Idle { .. })
            {
                entity.exposed = entity.exposed.max(stealth.delay_ticks);
            }
        }
        let tick = u64::from(self.tick);
        let mut sweeps: Vec<(usize, u32)> = Vec::new();
        for detector in &self.entities {
            let Some(def) = self.rules.ty(detector.kind).detector else {
                continue;
            };
            let rate = u64::from(def.rate_ticks.max(1));
            if detector.hp == 0
                || detector.contained()
                || detector.owner == NEUTRAL
                || detector.site.as_ref().is_some_and(|site| !site.complete)
                || (tick + u64::from(detector.id)) % rate != 0
            {
                continue;
            }
            let reach = i64::from(crate::rules::fx_centi(def.range_centi).raw());
            for (target_index, target) in self.entities.iter().enumerate() {
                if target.owner == detector.owner
                    || target.owner == NEUTRAL
                    || self.rules.ty(target.kind).stealth.is_none()
                {
                    continue;
                }
                let dx = i64::from(target.pos.x.raw() - detector.pos.x.raw());
                let dy = i64::from(target.pos.y.raw() - detector.pos.y.raw());
                if dx * dx + dy * dy <= reach * reach {
                    sweeps.push((target_index, def.rate_ticks + 1));
                }
            }
        }
        for (index, ticks) in sweeps {
            let entity = &mut self.entities[index];
            entity.exposed = entity.exposed.max(ticks);
        }
    }
}
