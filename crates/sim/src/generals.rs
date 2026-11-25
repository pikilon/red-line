//! Player rank and General's powers (spec 63), as in Zero Hour: kills earn
//! skill points, ranks grant General's points (`Player::addSkillPoints`,
//! `setRankLevel`), points buy Sciences, and the Special Powers they unlock
//! recharge on a timer (`SpecialPowerModule`).
//!
//! The rank is never stored: it derives from the skill points, so a save only
//! keeps the points and the bought powers.

use crate::angle::Angle;
use crate::combat::damage_dealt;
use crate::entity::{NEUTRAL, PlayerId};
use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, cell_of};
use crate::player::OwnedPower;
use crate::rng::SplitMix64;
use crate::rules::{Category, LocoKind, PowerDef, PowerEffect, fx_centi};
use crate::world::World;

/// Offsets (tiles) at which paratroopers land around the target.
const DROP_OFFSETS: [(i32, i32); 8] = [
    (0, 0),
    (1, 0),
    (-1, 0),
    (0, 1),
    (0, -1),
    (1, 1),
    (-1, -1),
    (1, -1),
];

impl World {
    /// Spec 63 §3: the rank (1-based) `player` holds; 0 when the rules define
    /// no ranks or the player does not exist.
    pub fn general_rank(&self, player: PlayerId) -> u8 {
        let Some(p) = self.players.get(usize::from(player)) else {
            return 0;
        };
        self.rules
            .general
            .ranks
            .iter()
            .take_while(|rank| p.general_xp >= rank.xp)
            .count() as u8
    }

    /// Spec 63 §3: General's points `player` can still spend: the points of
    /// every rank reached minus the cost of the powers bought.
    pub fn general_points(&self, player: PlayerId) -> u32 {
        let Some(p) = self.players.get(usize::from(player)) else {
            return 0;
        };
        let rank = usize::from(self.general_rank(player));
        let granted: u32 = self.rules.general.ranks[..rank]
            .iter()
            .map(|r| r.points)
            .sum();
        let spent: u32 = p
            .powers
            .iter()
            .map(|owned| self.rules.general.powers[usize::from(owned.power)].cost)
            .sum();
        granted.saturating_sub(spent)
    }

    /// Spec 63 §3: gives `player` skill points, capped at the top rank's.
    pub fn add_general_xp(&mut self, player: PlayerId, amount: u32) {
        let cap = self.rules.general.ranks.last().map_or(0, |rank| rank.xp);
        if let Some(p) = self.players.get_mut(usize::from(player)) {
            p.general_xp = p.general_xp.saturating_add(amount).min(cap);
        }
    }

    /// Setups, tests and tools: sets the skill points of `player`.
    pub fn set_general_xp(&mut self, player: PlayerId, xp: u32) {
        if let Some(p) = self.players.get_mut(usize::from(player)) {
            p.general_xp = 0;
        }
        self.add_general_xp(player, xp);
    }

    /// Spec 63 §4: whether `player`'s faction may buy `power`.
    fn power_allowed(&self, player: PlayerId, def: &PowerDef) -> bool {
        let Some(p) = self.players.get(usize::from(player)) else {
            return false;
        };
        def.factions.is_empty() || def.factions.contains(&p.faction)
    }

    /// Spec 63 §4: buys `power` when the faction may have it, the rank is
    /// high enough, it is not owned and the points cover its cost. It is
    /// ready to cast at once. Anything else is ignored.
    pub(crate) fn apply_buy_power(&mut self, player: PlayerId, power: u16) {
        let Some(def) = self.rules.general.powers.get(usize::from(power)) else {
            return;
        };
        let Some(p) = self.players.get(usize::from(player)) else {
            return;
        };
        if p.defeated
            || !self.power_allowed(player, def)
            || self.general_rank(player) < def.rank
            || self.general_points(player) < def.cost
        {
            return;
        }
        let tick = self.tick;
        let owned = &mut self.players[usize::from(player)].powers;
        let Err(slot) = owned.binary_search_by_key(&power, |o| o.power) else {
            return;
        };
        owned.insert(
            slot,
            OwnedPower {
                power,
                ready_tick: tick,
            },
        );
    }

    /// Spec 63 §4: casts a bought power that has recharged at `target`, then
    /// starts its recharge. Anything else is ignored.
    pub(crate) fn apply_cast_power(&mut self, player: PlayerId, power: u16, target: FxVec2) {
        let Some(p) = self.players.get(usize::from(player)) else {
            return;
        };
        let Ok(slot) = p.powers.binary_search_by_key(&power, |o| o.power) else {
            return;
        };
        let def = self.rules.general.powers[usize::from(power)].clone();
        let cell = cell_of(target);
        if p.defeated || p.powers[slot].ready_tick > self.tick || !self.terrain.in_bounds(cell) {
            return;
        }
        self.players[usize::from(player)].powers[slot].ready_tick =
            self.tick.saturating_add(def.recharge_ticks);
        match def.effect {
            PowerEffect::Scan { radius_centi } => self.power_scan(player, cell, radius_centi),
            PowerEffect::Repair {
                radius_centi,
                percent,
            } => self.power_repair(player, target, radius_centi, percent),
            PowerEffect::Barrage {
                spread_centi,
                impacts,
                damage,
                splash_centi,
                damage_type,
            } => self.power_barrage(
                player,
                power,
                target,
                (spread_centi, impacts, damage, splash_centi, damage_type),
            ),
            PowerEffect::Paradrop { unit, count } => {
                for &(dx, dy) in DROP_OFFSETS.iter().take(count as usize) {
                    let at = target + FxVec2::new(Fx::from_int(dx), Fx::from_int(dy));
                    self.apply_reinforce(player, unit, at);
                }
            }
        }
    }

    /// Scan: every cell whose centre lies within the radius becomes explored.
    fn power_scan(&mut self, player: PlayerId, centre: Cell, radius_centi: u32) {
        let radius = (radius_centi / 100) as i32;
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                let cell = Cell {
                    x: centre.x + dx,
                    y: centre.y + dy,
                };
                if dx * dx + dy * dy > radius * radius || !self.terrain.in_bounds(cell) {
                    continue;
                }
                let index = self.terrain.index(cell) as usize;
                self.players[usize::from(player)].explored[index] = true;
            }
        }
    }

    /// Emergency repair: own vehicles near the target regain `percent` of
    /// their maximum hit points.
    fn power_repair(&mut self, player: PlayerId, target: FxVec2, radius_centi: u32, percent: u32) {
        let radius = fx_centi(radius_centi);
        for index in 0..self.entities.len() {
            let entity = &self.entities[index];
            let ty = self.rules.ty(entity.kind);
            let vehicle = ty.category == Category::Unit
                && matches!(ty.motion.kind, LocoKind::Tracks | LocoKind::Wheels);
            if entity.owner != player
                || entity.hp == 0
                || !vehicle
                || (entity.pos - target).length() > radius
            {
                continue;
            }
            let max = self.max_hp_at(index);
            let gain = (u64::from(max) * u64::from(percent) / 100) as u32;
            let hp = &mut self.entities[index].hp;
            *hp = hp.saturating_add(gain).min(max);
        }
    }

    /// Artillery barrage: `impacts` blasts, each at a pseudo-random point of
    /// the spread disc (a stateless draw seeded by tick, player and power),
    /// hurt enemy ground entities within the splash.
    fn power_barrage(
        &mut self,
        player: PlayerId,
        power: u16,
        target: FxVec2,
        (spread_centi, impacts, damage, splash_centi, damage_type): (u32, u32, u32, u32, u8),
    ) {
        let mut rng = SplitMix64::new(
            (u64::from(self.tick) << 32) ^ (u64::from(player) << 16) ^ u64::from(power),
        );
        let splash = fx_centi(splash_centi);
        for _ in 0..impacts {
            let u = Fx::from_raw((rng.next_u32() % 65537) as i32);
            let r = fx_centi(spread_centi).mul(u.sqrt());
            let angle = Angle((rng.next_u32() >> 16) as u16);
            let impact = target + angle.dir().scale(r);
            for index in 0..self.entities.len() {
                let entity = &self.entities[index];
                let ty = self.rules.ty(entity.kind);
                if entity.hp == 0
                    || entity.contained()
                    || entity.owner == NEUTRAL
                    || entity.owner == player
                    || ty.is_air()
                    || self.entity_distance(impact, entity) > splash
                {
                    continue;
                }
                let modifier = self.rules.modifier(damage_type, ty.armor);
                let hurt = damage_dealt(damage, modifier);
                self.entities[index].hp = self.entities[index].hp.saturating_sub(hurt);
            }
        }
    }
}
