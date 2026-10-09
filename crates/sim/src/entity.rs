//! Entities (units, buildings, depots) and their orders, ghosts and projectiles.

use crate::fixed::FxVec2;
use crate::map::Cell;
use crate::rules::{TypeId, WeaponId};

pub type EntityId = u32;
pub type PlayerId = u8;
pub const NEUTRAL: PlayerId = 255;
pub const OBSERVER: PlayerId = 255;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HarvestPhase {
    ToDepot,
    Loading,
    ToCenter,
    Unloading,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Order {
    /// `last_order_id` is the order this unit completed (0 = none).
    Idle {
        last_order_id: u32,
    },
    Move {
        order_id: u32,
        target: FxVec2,
        goal: Cell,
    },
    Attack {
        order_id: u32,
        target: EntityId,
    },
    Harvest {
        order_id: u32,
        depot: EntityId,
        center: Option<EntityId>,
        phase: HarvestPhase,
        timer: u32,
    },
    Build {
        order_id: u32,
        building: EntityId,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct QueueItem {
    pub kind: TypeId,
    pub progress: u32,
}

/// Buildings and depots. `progress` counts speed-percent points; the site is
/// complete at build_ticks * 100. Depots are created complete.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Site {
    pub origin: Cell,
    pub progress: u32,
    pub complete: bool,
    pub queue: Vec<QueueItem>,
    pub rally: Option<FxVec2>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entity {
    pub id: EntityId,
    /// `NEUTRAL` for depots.
    pub owner: PlayerId,
    pub kind: TypeId,
    /// Buildings and depots: footprint centre.
    pub pos: FxVec2,
    /// Depots: remaining supply.
    pub hp: u32,
    /// Buildings and depots: always `Idle { last_order_id: 0 }`.
    pub order: Order,
    pub cooldown: u32,
    pub cargo: u32,
    /// Entity fired at during this tick's combat phase.
    pub last_target: Option<EntityId>,
    /// `Some` for buildings and depots.
    pub site: Option<Site>,
}

/// Phase 1 name, kept for the Phase 1 tests.
pub type Unit = Entity;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ghost {
    pub kind: TypeId,
    pub owner: PlayerId,
    pub origin: Cell,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Projectile {
    pub owner: PlayerId,
    pub weapon: WeaponId,
    pub target: EntityId,
    pub impact: FxVec2,
    pub impact_tick: u32,
}
