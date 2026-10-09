//! Simulation world: units, move orders and the fixed-tick step.

use std::collections::BTreeMap;

use crate::fixed::{Fx, FxVec2};
use crate::flow::FlowField;
use crate::map::{Cell, CellIndex, MapGrid};

pub type UnitId = u32;

pub const TICK_RATE_HZ: u32 = 15;
pub const MAX_UNITS: u32 = 2000;
pub const UNIT_SPEED: Fx = Fx::from_raw(13107);
pub const SEPARATION_DISTANCE: Fx = Fx::from_raw(32768);
pub const MAX_SEPARATION_PUSH: Fx = Fx::from_raw(6553);
pub const ARRIVAL_CONTACT: Fx = Fx::from_raw(39321);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Order {
    /// `last_order_id` is the order this unit completed (0 = none).
    Idle { last_order_id: u32 },
    Move {
        order_id: u32,
        target: FxVec2,
        goal: Cell,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Unit {
    pub id: UnitId,
    pub pos: FxVec2,
    pub order: Order,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    Move { units: Vec<UnitId>, target: FxVec2 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SimError {
    TooManyUnits { requested: u32, max: u32 },
}

pub struct World {
    tick: u32,
    map: MapGrid,
    /// Index == id, ascending.
    units: Vec<Unit>,
    /// Starts at 1.
    next_order_id: u32,
    pending: Vec<Command>,
    /// Keyed by goal cell index.
    fields: BTreeMap<CellIndex, FlowField>,
}

impl World {
    /// Tick 0, no units.
    pub fn new(map: MapGrid) -> World {
        World {
            tick: 0,
            map,
            units: Vec::new(),
            next_order_id: 1,
            pending: Vec::new(),
            fields: BTreeMap::new(),
        }
    }

    pub fn tech_slice(_seed: u64, _unit_count: u32) -> Result<World, SimError> {
        Ok(World::new(MapGrid::tech_slice()))
    }

    /// Appends a unit with id = current unit count, order `Idle { last_order_id: 0 }`.
    /// Panics if `pos` is not in a passable cell.
    pub fn spawn_unit_at(&mut self, pos: FxVec2) -> UnitId {
        let id = self.units.len() as UnitId;
        self.units.push(Unit {
            id,
            pos,
            order: Order::Idle { last_order_id: 0 },
        });
        id
    }

    /// Applied at the start of the next step.
    pub fn enqueue(&mut self, command: Command) {
        self.pending.push(command);
    }

    pub fn step(&mut self) {}

    pub fn tick(&self) -> u32 {
        self.tick
    }

    pub fn map(&self) -> &MapGrid {
        &self.map
    }

    pub fn units(&self) -> &[Unit] {
        &self.units
    }

    pub fn unit(&self, id: UnitId) -> Option<&Unit> {
        self.units.get(id as usize)
    }

    pub fn next_order_id(&self) -> u32 {
        self.next_order_id
    }

    pub fn flow_field_count(&self) -> usize {
        self.fields.len()
    }
}
