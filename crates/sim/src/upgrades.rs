//! Upgrades purchased at buildings (spec 52), as Zero Hour's `PLAYER`
//! upgrades: bought in a producer's queue, then owned by the player for the
//! rest of the match. An owned upgrade raises the maximum hit points and the
//! weapon damage of the unit types it lists, now and later.

use crate::entity::PlayerId;
use crate::rules::{Category, TypeId, UpgradeDef};
use crate::world::World;

impl World {
    /// `base` scaled by `percent` of every upgrade `owner` owns that applies
    /// to `kind`, one after the other.
    pub(crate) fn upgraded(
        &self,
        owner: PlayerId,
        kind: TypeId,
        base: u32,
        percent: impl Fn(&UpgradeDef) -> u32,
    ) -> u32 {
        let Some(player) = self.players.get(usize::from(owner)) else {
            return base;
        };
        let mut value = u64::from(base);
        for &upgrade in &player.upgrades {
            if let Some(def) = &self.rules.ty(upgrade).upgrade
                && def.applies_to.contains(&kind)
            {
                value = value * u64::from(percent(def)) / 100;
            }
        }
        value.min(u64::from(u32::MAX)) as u32
    }

    /// True if `player` owns upgrade `kind` or has it queued in any building.
    pub(crate) fn upgrade_taken(&self, player: PlayerId, kind: TypeId) -> bool {
        let owned = self
            .players
            .get(usize::from(player))
            .is_some_and(|p| p.upgrades.contains(&kind));
        owned
            || self.entities.iter().any(|e| {
                e.owner == player
                    && e.site
                        .as_ref()
                        .is_some_and(|site| site.queue.iter().any(|item| item.kind == kind))
            })
    }

    /// Gives `player` upgrade `kind`. Units it makes tougher gain the extra
    /// hit points at once (Zero Hour `MaxHealthUpgrade`, added to current
    /// health too), so their share of health stays.
    pub fn grant_upgrade(&mut self, player: PlayerId, kind: TypeId) {
        if usize::from(kind) >= self.rules.types.len()
            || self.rules.ty(kind).category != Category::Upgrade
        {
            return;
        }
        let Some(owner) = self.players.get(usize::from(player)) else {
            return;
        };
        let Err(slot) = owner.upgrades.binary_search(&kind) else {
            return;
        };
        let before: Vec<u32> = self.entities.iter().map(|e| self.max_hp(e)).collect();
        self.players[usize::from(player)]
            .upgrades
            .insert(slot, kind);
        for (index, old_max) in before.into_iter().enumerate() {
            if self.entities[index].owner != player || self.entities[index].hp == 0 {
                continue;
            }
            let gained = self.max_hp_at(index).saturating_sub(old_max);
            let entity = &mut self.entities[index];
            entity.hp = entity.hp.saturating_add(gained);
        }
    }
}
