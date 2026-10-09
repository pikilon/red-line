//! Players: faction, credits, power and fog-of-war memory.

use std::collections::BTreeMap;

use crate::entity::{EntityId, Ghost, PlayerId};
use crate::rules::FactionId;

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
    #[expect(dead_code, reason = "read by the vision phase (P2-07)")]
    pub(crate) visible: Vec<bool>,
    pub(crate) ghosts: BTreeMap<EntityId, Ghost>,
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
        }
    }

    /// (produced, consumed)
    pub fn power(&self) -> (u32, u32) {
        (self.power_produced, self.power_consumed)
    }

    pub fn ghosts(&self) -> &BTreeMap<EntityId, Ghost> {
        &self.ghosts
    }
}
