//! Spec 57: the per-player score-screen counters.

use crate::entity::{NEUTRAL, PlayerId};
use crate::player::PlayerStats;
use crate::rules::Category;
use crate::world::World;

impl World {
    /// Runs `bump` on the counters of `player`; neutral or unknown players
    /// keep none.
    pub(crate) fn bump_stats(&mut self, player: PlayerId, bump: impl FnOnce(&mut PlayerStats)) {
        if let Some(player) = self.players.get_mut(usize::from(player)) {
            bump(&mut player.stats);
        }
    }

    /// Spec 57 §3: every unit or finished building about to be removed is a
    /// loss for its owner and, when an enemy hit it last (a launched drone's
    /// kills go to its launcher), a kill for that enemy. Foundations, depots
    /// and neutral entities count for nobody. Runs before `remove_dead`
    /// clears the entities, so the killer is still looked up by id.
    pub(crate) fn count_deaths(&mut self) {
        let mut tally: Vec<(PlayerId, bool, Option<PlayerId>)> = Vec::new();
        for entity in &self.entities {
            if entity.hp > 0 || entity.owner == NEUTRAL {
                continue;
            }
            let building = match self.rules.ty(entity.kind).category {
                Category::Unit => false,
                Category::Building => true,
                Category::Depot | Category::Upgrade => continue,
            };
            if entity.site.as_ref().is_some_and(|site| !site.complete) {
                continue;
            }
            let killer = entity
                .last_hit
                .and_then(|(shooter, _)| self.entity(shooter))
                .and_then(|shooter| self.entity(shooter.master.unwrap_or(shooter.id)))
                .map(|credited| credited.owner)
                .filter(|&owner| owner != entity.owner && owner != NEUTRAL);
            tally.push((entity.owner, building, killer));
        }
        for (owner, building, killer) in tally {
            self.bump_stats(owner, |stats| {
                if building {
                    stats.buildings_lost += 1;
                } else {
                    stats.units_lost += 1;
                }
            });
            if let Some(killer) = killer {
                self.bump_stats(killer, |stats| {
                    if building {
                        stats.buildings_destroyed += 1;
                    } else {
                        stats.units_destroyed += 1;
                    }
                });
            }
        }
    }
}
