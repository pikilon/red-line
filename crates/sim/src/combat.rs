//! Weapons, targeting and attack orders (P2-12, spec §5.11).
//!
//! The combat phase resets every `last_target`, then each entity with a weapon
//! (ascending id, skipping the dead, incomplete buildings and unpowered
//! defenses) decrements its cooldown, picks a target — the ordered one when it
//! is valid and in range, the nearest valid one otherwise — and fires: an
//! instant hit when `projectile_ticks == 0`, a projectile otherwise. P2-13 adds
//! the projectile impact and splash branches of §5.11 steps 3 and 4.

use crate::entity::{NEUTRAL, Order, Projectile};
use crate::fixed::Fx;
use crate::rules::{TypeId, WeaponDef, WeaponId, fx_centi};
use crate::world::World;

/// `0` when `modifier_percent == 0`; otherwise `max(1, base * modifier_percent
/// / 100)` with a `u64` intermediate (saturating at `u32::MAX`).
pub fn damage_dealt(base: u32, modifier_percent: u32) -> u32 {
    if modifier_percent == 0 {
        return 0;
    }
    (u64::from(base) * u64::from(modifier_percent) / 100).clamp(1, u64::from(u32::MAX)) as u32
}

impl World {
    /// Spec §5.11 combat phase: `last_target` reset, then one fire step per
    /// entity in ascending id order.
    pub(crate) fn update_combat(&mut self) {
        for entity in &mut self.entities {
            entity.last_target = None;
        }
        for index in 0..self.entities.len() {
            self.fire(index);
        }
    }

    /// One entity's combat step: cooldown, target selection and fire.
    fn fire(&mut self, index: usize) {
        let (kind, hp) = {
            let entity = &self.entities[index];
            (entity.kind, entity.hp)
        };
        if hp == 0 || !self.can_fire(index) {
            return;
        }
        let Some((weapon_id, weapon)) = self.weapon_data(kind) else {
            return;
        };
        let cooldown = self.entities[index].cooldown;
        if cooldown > 0 {
            self.entities[index].cooldown = cooldown - 1;
            if cooldown > 1 {
                return;
            }
        }
        let Some(target_index) = self.select_target(index, &weapon) else {
            return;
        };
        let target = self.entities[target_index].id;
        if weapon.projectile_ticks == 0 {
            // Instant branch of §5.11 step 4. P2-13 adds the splash branch
            // (`splash_centi > 0`); no rule carries both splash and an instant
            // projectile.
            if weapon.splash_centi == 0 {
                self.apply_hit(target_index, &weapon);
            }
        } else {
            let projectile = Projectile {
                owner: self.entities[index].owner,
                weapon: weapon_id,
                target,
                impact: self.entities[target_index].pos,
                impact_tick: self.tick + weapon.projectile_ticks,
            };
            self.projectiles.push(projectile);
        }
        self.entities[index].cooldown = weapon.cooldown_ticks;
        self.entities[index].last_target = Some(target);
    }

    /// Incomplete buildings never fire, and a `requires_power` building does not
    /// fire while its owner has a power deficit (§5.11 step 2).
    fn can_fire(&self, index: usize) -> bool {
        let entity = &self.entities[index];
        if entity.site.as_ref().is_some_and(|site| !site.complete) {
            return false;
        }
        if !self.rules.ty(entity.kind).requires_power {
            return true;
        }
        self.player(entity.owner).is_none_or(|player| {
            let (produced, consumed) = player.power();
            produced >= consumed
        })
    }

    /// Weapon of `kind` as `(id, definition)`; `None` for unarmed types.
    fn weapon_data(&self, kind: TypeId) -> Option<(WeaponId, WeaponDef)> {
        let index = usize::try_from(self.rules.ty(kind).weapon).ok()?;
        let weapon = self.rules.weapons.get(index)?.clone();
        Some((WeaponId::try_from(index).ok()?, weapon))
    }

    /// The ordered target when it exists, is valid and in range; otherwise the
    /// valid target in range at the smallest entity distance, ties to the
    /// lowest id.
    fn select_target(&self, index: usize, weapon: &WeaponDef) -> Option<usize> {
        if let Order::Attack { target, .. } = self.entities[index].order
            && let Some(target_index) = self.index_of(target)
            && self.is_valid_target(index, target_index, weapon)
        {
            return Some(target_index);
        }
        let mut best: Option<(Fx, usize)> = None;
        for target_index in 0..self.entities.len() {
            if !self.is_valid_target(index, target_index, weapon) {
                continue;
            }
            let distance =
                self.entity_distance(self.entities[index].pos, &self.entities[target_index]);
            if best.is_none_or(|(best_distance, _)| distance < best_distance) {
                best = Some((distance, target_index));
            }
        }
        best.map(|(_, target_index)| target_index)
    }

    /// §5.11 target validity: exists, `hp > 0`, an owner other than the
    /// attacker's and `NEUTRAL`, visible to the attacker's owner, a non-zero
    /// damage modifier and a distance inside `[min_range, range]`.
    fn is_valid_target(&self, index: usize, target_index: usize, weapon: &WeaponDef) -> bool {
        let attacker = &self.entities[index];
        let target = &self.entities[target_index];
        if target.hp == 0
            || target.owner == attacker.owner
            || target.owner == NEUTRAL
            || self
                .rules
                .modifier(weapon.damage_type, self.rules.ty(target.kind).armor)
                == 0
            || !self.is_entity_visible(attacker.owner, target.id)
        {
            return false;
        }
        let distance = self.entity_distance(attacker.pos, target);
        distance >= fx_centi(weapon.min_range_centi) && distance <= fx_centi(weapon.range_centi)
    }

    /// Instant hit: the target loses the modified damage (saturating).
    fn apply_hit(&mut self, target_index: usize, weapon: &WeaponDef) {
        let target = &self.entities[target_index];
        if target.hp == 0 {
            return;
        }
        let modifier = self
            .rules
            .modifier(weapon.damage_type, self.rules.ty(target.kind).armor);
        let damage = damage_dealt(weapon.damage, modifier);
        self.entities[target_index].hp = self.entities[target_index].hp.saturating_sub(damage);
    }
}
