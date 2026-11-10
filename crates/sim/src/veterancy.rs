//! Veterancy (spec 50): units earn experience from the enemies they destroy
//! and are promoted to veteran, elite and heroic, as in Zero Hour
//! (`ExperienceTracker`, `Object::scoreTheKill`).
//!
//! Experience is paid in the deaths phase, just before the dead are removed:
//! the last entity that damaged the victim (`last_hit`) gets the victim's
//! `experience.value` for the rank the victim held. A rank raises the unit's
//! maximum hit points, damage and rate of fire, and from `selfHeal.fromRank`
//! on the unit slowly repairs itself.

use crate::entity::{Entity, EntityId, NEUTRAL, Order};
use crate::rules::{MAX_RANK, WeaponDef};
use crate::world::World;

/// `base * percent / 100`, saturating.
fn scaled(base: u32, percent: u32) -> u32 {
    (u64::from(base) * u64::from(percent) / 100).min(u64::from(u32::MAX)) as u32
}

impl World {
    /// Maximum hit points of `entity`: its type's, raised by its rank.
    pub fn max_hp(&self, entity: &Entity) -> u32 {
        let base = self.rules.ty(entity.kind).hp;
        let percent = self.rules.veterancy.health_percent[usize::from(entity.rank.min(MAX_RANK))];
        scaled(base, percent)
    }

    /// `max_hp` of the entity at `index`.
    pub(crate) fn max_hp_at(&self, index: usize) -> u32 {
        self.max_hp(&self.entities[index])
    }

    /// The weapon as `shooter` fires it at its rank: more damage and a
    /// shorter cooldown (spec 50 §3.3). A missing shooter fires it as is.
    pub(crate) fn rank_weapon(&self, shooter: EntityId, mut weapon: WeaponDef) -> WeaponDef {
        let rank = self.entity(shooter).map_or(0, |entity| entity.rank);
        if rank == 0 {
            return weapon;
        }
        let rank = usize::from(rank.min(MAX_RANK));
        let rules = &self.rules.veterancy;
        weapon.damage = scaled(weapon.damage, rules.damage_percent[rank]);
        let rate = u64::from(rules.rate_of_fire_percent[rank].max(1));
        weapon.cooldown_ticks = (u64::from(weapon.cooldown_ticks) * 100 / rate).max(1) as u32;
        weapon
    }

    /// Sets the rank of unit `id` (setups, tests and tools) with the
    /// experience that rank needs, keeping its share of hit points. Types
    /// that cannot be promoted are left alone.
    pub fn set_rank(&mut self, id: EntityId, rank: u8) {
        let Some(index) = self.index_of(id) else {
            return;
        };
        let Some(required) = self.required_of(index) else {
            return;
        };
        let rank = rank.min(MAX_RANK);
        self.entities[index].xp = match rank {
            0 => 0,
            rank => required[usize::from(rank) - 1],
        };
        self.change_rank(index, rank);
    }

    fn required_of(&self, index: usize) -> Option<[u32; 3]> {
        self.rules
            .ty(self.entities[index].kind)
            .experience
            .and_then(|experience| experience.required)
    }

    /// Changes the rank and scales the hit points with the new maximum, so
    /// the unit keeps its percentage of health (Zero Hour `PRESERVE_RATIO`).
    fn change_rank(&mut self, index: usize, rank: u8) {
        let before = self.max_hp_at(index);
        self.entities[index].rank = rank;
        let after = self.max_hp_at(index);
        let hp = self.entities[index].hp;
        if hp > 0 && before > 0 && after != before {
            let scaled = (u64::from(hp) * u64::from(after)).div_ceil(u64::from(before));
            self.entities[index].hp = (scaled as u32).clamp(1, after);
        }
    }

    /// Gives `amount` experience to the unit at `index` and promotes it past
    /// every threshold it reached.
    fn gain_experience(&mut self, index: usize, amount: u32) {
        let Some(required) = self.required_of(index) else {
            return;
        };
        let xp = self.entities[index].xp.saturating_add(amount);
        self.entities[index].xp = xp;
        let mut rank = self.entities[index].rank;
        while rank < MAX_RANK && xp >= required[usize::from(rank)] {
            rank += 1;
        }
        if rank != self.entities[index].rank {
            self.change_rank(index, rank);
        }
    }

    /// Spec 50 §3.1: every entity about to be removed pays its experience
    /// value to the enemy that hit it last, in ascending victim id order. A
    /// launched drone's kills go to its launcher. No experience for friendly
    /// fire, unfinished buildings or a killer that is dead or gone.
    pub(crate) fn score_kills(&mut self) {
        for victim in 0..self.entities.len() {
            let entity = &self.entities[victim];
            if entity.hp > 0 || entity.owner == NEUTRAL {
                continue;
            }
            if entity.site.as_ref().is_some_and(|site| !site.complete) {
                continue;
            }
            let Some(experience) = self.rules.ty(entity.kind).experience else {
                continue;
            };
            let Some((shooter, _)) = entity.last_hit else {
                continue;
            };
            let Some(shooter) = self.entity(shooter) else {
                continue;
            };
            let Some(killer) = self.index_of(shooter.master.unwrap_or(shooter.id)) else {
                continue;
            };
            let credited = &self.entities[killer];
            if credited.hp == 0 || credited.owner == entity.owner || credited.owner == NEUTRAL {
                continue;
            }
            let value = experience.value[usize::from(entity.rank.min(MAX_RANK))];
            self.gain_experience(killer, value);
        }
    }

    /// Spec 50 §3.4: every `intervalTicks`, living units of `fromRank` or
    /// higher get `permille` of their maximum hit points back (at least 1).
    /// Units being healed or repaired in a building are left to it.
    pub(crate) fn heal_veterans(&mut self) {
        let Some(heal) = self.rules.veterancy.self_heal else {
            return;
        };
        if !self.tick.is_multiple_of(heal.interval_ticks.max(1)) {
            return;
        }
        for index in 0..self.entities.len() {
            let entity = &self.entities[index];
            if entity.rank == 0
                || entity.rank < heal.from_rank
                || entity.hp == 0
                || matches!(
                    entity.order,
                    Order::Heal { .. } | Order::RepairVehicle { .. }
                )
            {
                continue;
            }
            let max = self.max_hp_at(index);
            if entity.hp >= max {
                continue;
            }
            let gain = (u64::from(max) * u64::from(heal.permille) / 1000).max(1) as u32;
            self.entities[index].hp = entity.hp.saturating_add(gain).min(max);
        }
    }
}
