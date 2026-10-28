//! Entities (units, buildings, depots) and their orders, ghosts and projectiles.

use crate::angle::Angle;
use crate::fixed::{Fx, FxVec2};
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

/// `Projectile::target` and `Entity::last_target` of a shot at the ground.
pub const GROUND_TARGET: EntityId = u32::MAX;

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
    /// Force-fire at a ground point (spec 20): approach until the point is in
    /// weapon range, then shoot at it until stopped or re-ordered.
    AttackGround {
        order_id: u32,
        target: FxVec2,
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
    /// Spec 31 block 2: walk to the map feature `feature` (index into
    /// `World::features`) and garrison it.
    Garrison {
        order_id: u32,
        feature: u32,
    },
    /// Spec 32: walk to the own vehicle `carrier` and board it.
    Board {
        order_id: u32,
        carrier: EntityId,
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
    /// Last `(shooter, weapon)` that damaged this entity; presentation only,
    /// never read by game rules and not hashed (spec 17 §4.1, §4.3).
    pub last_hit: Option<(EntityId, WeaponId)>,
    /// `Some` for buildings and depots.
    pub site: Option<Site>,
    /// Hull heading (spec 11 §5.1); buildings keep `Angle(0)`.
    pub heading: Angle,
    /// Turret angle relative to the hull (spec 11 §5.1).
    pub turret: Angle,
    /// Current speed in fixed-point tiles per tick (spec 11 §5.1).
    pub speed: Fx,
    /// True while a vehicle drives its short reverse move (spec 11 §5.2.1).
    pub reversing: bool,
    /// Sticky turret target (spec 11 §5.3).
    pub aim: Option<EntityId>,
    /// Ticks since the turret last had a target (spec 11 §5.3).
    pub idle_aim_ticks: u32,
    /// Spec 31 block 2: index of the feature this unit garrisons; it is hidden
    /// and fires from the building. `None` for everything on the map.
    pub inside: Option<u32>,
    /// Spec 32: id of the vehicle this unit rides; it is hidden and moves with
    /// it. `None` for everything on the map.
    pub aboard: Option<EntityId>,
    /// Spec 32: on a transport that is unloading, ticks until the next rider
    /// leaves; `None` when it is not unloading.
    pub unloading: Option<u32>,
}

/// The locomotion and turret state of an entity (spec 11 §5.1). Read and written
/// as one value so tests can set any field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LocomotionState {
    pub heading: Angle,
    pub turret: Angle,
    pub speed: Fx,
    pub reversing: bool,
    pub aim: Option<EntityId>,
    pub idle_aim_ticks: u32,
}

impl Entity {
    /// True while the unit is inside a building or a vehicle: hidden, not
    /// targetable, not moved or pushed (spec 31 block 2, spec 32).
    pub fn contained(&self) -> bool {
        self.inside.is_some() || self.aboard.is_some()
    }

    /// The locomotion and turret state of this entity.
    pub fn locomotion(&self) -> LocomotionState {
        LocomotionState {
            heading: self.heading,
            turret: self.turret,
            speed: self.speed,
            reversing: self.reversing,
            aim: self.aim,
            idle_aim_ticks: self.idle_aim_ticks,
        }
    }
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
    pub id: u32,
    pub owner: PlayerId,
    /// Firing entity, even after it dies (spec 17 §4.3).
    pub shooter: EntityId,
    pub weapon: WeaponId,
    pub target: EntityId,
    /// Shooter position at fire time.
    pub origin: FxVec2,
    /// Aim point plus scatter, updated each tick for homing (spec 17 §4.2–§4.3).
    pub impact: FxVec2,
    pub launch_tick: u32,
    pub impact_tick: u32,
}
