//! Players: faction, credits, power and fog-of-war memory.

use std::collections::BTreeMap;

use crate::entity::{EntityId, Ghost, PlayerId};
use crate::rules::{FactionId, TypeId};

/// Spec 57: what a player did this match, shown on the score screen. Plain
/// integers bumped where units are produced and die and where credits move.
/// Not hashed (nothing reads them back) and not saved: a loaded match counts
/// from the load.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PlayerStats {
    pub units_built: u32,
    pub units_lost: u32,
    pub units_destroyed: u32,
    pub buildings_built: u32,
    pub buildings_lost: u32,
    pub buildings_destroyed: u32,
    pub money_earned: u32,
    pub money_spent: u32,
}

impl PlayerStats {
    /// The eight counters in declaration order, as saved.
    pub fn to_array(self) -> [u32; 8] {
        [
            self.units_built,
            self.units_lost,
            self.units_destroyed,
            self.buildings_built,
            self.buildings_lost,
            self.buildings_destroyed,
            self.money_earned,
            self.money_spent,
        ]
    }

    pub fn from_array(a: [u32; 8]) -> PlayerStats {
        PlayerStats {
            units_built: a[0],
            units_lost: a[1],
            units_destroyed: a[2],
            buildings_built: a[3],
            buildings_lost: a[4],
            buildings_destroyed: a[5],
            money_earned: a[6],
            money_spent: a[7],
        }
    }
}

/// Spec 63: a General's power the player bought; it can be cast once `tick`
/// reaches `ready_tick`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OwnedPower {
    /// Index into `GeneralRules::powers`.
    pub power: u16,
    pub ready_tick: u32,
}

pub struct Player {
    pub id: PlayerId,
    pub faction: FactionId,
    pub credits: u32,
    pub defeated: bool,
    /// Derived each economy phase, not hashed.
    pub(crate) power_produced: u32,
    pub(crate) power_consumed: u32,
    /// Per cell, row-major.
    pub(crate) explored: Vec<bool>,
    /// Derived each vision phase, not hashed.
    pub(crate) visible: Vec<bool>,
    pub(crate) ghosts: BTreeMap<EntityId, Ghost>,
    /// Spec 05 §9: percent of a delivered cargo credited (100 but for a
    /// Brutal AI). Not hashed: it only shows through `credits`.
    pub(crate) income_percent: u32,
    /// Spec 52: upgrade types this player owns, ascending.
    pub(crate) upgrades: Vec<TypeId>,
    /// Spec 57: score-screen counters.
    pub(crate) stats: PlayerStats,
    /// Spec 63: skill points earned from kills; the rank derives from them.
    pub(crate) general_xp: u32,
    /// Spec 63: bought powers, ascending by power.
    pub(crate) powers: Vec<OwnedPower>,
}

impl Player {
    /// Nothing explored or visible, no power, no ghosts.
    pub(crate) fn new(id: PlayerId, faction: FactionId, credits: u32, cells: usize) -> Player {
        Player {
            id,
            faction,
            credits,
            defeated: false,
            power_produced: 0,
            power_consumed: 0,
            explored: vec![false; cells],
            visible: vec![false; cells],
            ghosts: BTreeMap::new(),
            income_percent: 100,
            upgrades: Vec::new(),
            stats: PlayerStats::default(),
            general_xp: 0,
            powers: Vec::new(),
        }
    }

    /// Spec 52: the upgrade types this player owns, ascending.
    pub fn upgrades(&self) -> &[TypeId] {
        &self.upgrades
    }

    /// Spec 63: skill points earned from kills.
    pub fn general_xp(&self) -> u32 {
        self.general_xp
    }

    /// Spec 63: bought powers, ascending by power index.
    pub fn powers(&self) -> &[OwnedPower] {
        &self.powers
    }

    /// Spec 57: the score-screen counters.
    pub fn stats(&self) -> &PlayerStats {
        &self.stats
    }

    /// Spec 05 §9: percent of a delivered cargo credited.
    pub fn income_percent(&self) -> u32 {
        self.income_percent
    }

    /// (produced, consumed)
    pub fn power(&self) -> (u32, u32) {
        (self.power_produced, self.power_consumed)
    }

    pub fn ghosts(&self) -> &BTreeMap<EntityId, Ghost> {
        &self.ghosts
    }
}
