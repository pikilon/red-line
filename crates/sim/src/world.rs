//! Simulation world: units, move orders and the fixed-tick step.

use std::collections::{BTreeMap, BTreeSet};

use crate::fixed::{Fx, FxVec2};
use crate::flow::FlowField;
use crate::map::{Cell, CellIndex, MapGrid, SPAWN_MAX, SPAWN_MIN, cell_center, cell_of};
use crate::rng::SplitMix64;

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

    pub fn tech_slice(seed: u64, unit_count: u32) -> Result<World, SimError> {
        if unit_count > MAX_UNITS {
            return Err(SimError::TooManyUnits {
                requested: unit_count,
                max: MAX_UNITS,
            });
        }
        let mut world = World::new(MapGrid::tech_slice());
        let mut rng = SplitMix64::new(seed);
        let cells = (SPAWN_MIN.y..=SPAWN_MAX.y)
            .flat_map(|y| (SPAWN_MIN.x..=SPAWN_MAX.x).map(move |x| Cell { x, y }))
            .filter(|&cell| world.map.is_passable(cell))
            .take(unit_count as usize)
            .collect::<Vec<_>>();
        for cell in cells {
            let center = cell_center(cell);
            let x = center.x.raw() + jitter(&mut rng);
            let y = center.y.raw() + jitter(&mut rng);
            world.spawn_unit_at(FxVec2::new(Fx::from_raw(x), Fx::from_raw(y)));
        }
        Ok(world)
    }

    /// Appends a unit with id = current unit count, order `Idle { last_order_id: 0 }`.
    /// Panics if `pos` is not in a passable cell.
    pub fn spawn_unit_at(&mut self, pos: FxVec2) -> UnitId {
        assert!(
            self.map.is_passable(cell_of(pos)),
            "spawn position {pos:?} is not in a passable cell"
        );
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

    pub fn step(&mut self) {
        self.apply_commands();
        self.move_units();
        // Separation and contact arrival (phases 3 and 4) belong to P1-06.
        self.drop_unused_fields();
        self.tick += 1;
    }

    /// Phase 1: applies pending commands in enqueue order.
    fn apply_commands(&mut self) {
        for command in std::mem::take(&mut self.pending) {
            let Command::Move { units, target } = command;
            self.apply_move(&units, target);
        }
    }

    fn apply_move(&mut self, units: &[UnitId], target: FxVec2) {
        let max_x = i32::from(self.map.width()) * 65536 - 1;
        let max_y = i32::from(self.map.height()) * 65536 - 1;
        let mut target = FxVec2::new(
            Fx::from_raw(target.x.raw().clamp(0, max_x)),
            Fx::from_raw(target.y.raw().clamp(0, max_y)),
        );
        let cell = cell_of(target);
        if !self.map.is_passable(cell) {
            let Some(found) = self.map.nearest_passable(cell) else {
                return;
            };
            target = cell_center(found);
        }
        let goal = cell_of(target);
        let map = &self.map;
        self.fields
            .entry(map.index(goal))
            .or_insert_with(|| FlowField::compute(map, goal));
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        let order = Order::Move {
            order_id,
            target,
            goal,
        };
        for &id in units {
            if let Some(unit) = self.units.get_mut(id as usize) {
                unit.order = order;
            }
        }
    }

    /// Phase 2: moves every unit with a move order one tick along its field.
    fn move_units(&mut self) {
        for unit in &mut self.units {
            let Order::Move {
                order_id,
                target,
                goal,
            } = unit.order
            else {
                continue;
            };
            let cell = cell_of(unit.pos);
            if cell == goal {
                let delta = target - unit.pos;
                if delta.length() <= UNIT_SPEED {
                    unit.pos = target;
                    unit.order = Order::Idle {
                        last_order_id: order_id,
                    };
                } else {
                    unit.pos = unit.pos + delta.normalize().scale(UNIT_SPEED);
                }
                continue;
            }
            let direction = self
                .fields
                .get(&self.map.index(goal))
                .and_then(|field| field.direction(cell));
            match direction {
                Some(dir) => unit.pos = unit.pos + dir.unit_vector().scale(UNIT_SPEED),
                None => {
                    unit.order = Order::Idle {
                        last_order_id: order_id,
                    }
                }
            }
        }
    }

    /// Phase 5: removes flow fields no move order uses any more.
    fn drop_unused_fields(&mut self) {
        let used: BTreeSet<CellIndex> = self
            .units
            .iter()
            .filter_map(|unit| match unit.order {
                Order::Move { goal, .. } => Some(self.map.index(goal)),
                Order::Idle { .. } => None,
            })
            .collect();
        self.fields.retain(|goal, _| used.contains(goal));
    }

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

/// Raw offset in `[-16384, 16383]` (one RNG draw).
fn jitter(rng: &mut SplitMix64) -> i32 {
    (rng.next_u32() % 32768) as i32 - 16384
}
