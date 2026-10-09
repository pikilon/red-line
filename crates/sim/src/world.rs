//! Simulation world: entities, players, orders and the fixed-tick step.

use std::collections::{BTreeMap, BTreeSet};

use crate::entity::{Entity, PlayerId, Projectile};
pub use crate::entity::{EntityId, Order, Unit};
use crate::fixed::{Fx, FxVec2};
use crate::flow::FlowField;
use crate::map::{Cell, CellIndex, MapGrid, SPAWN_MAX, SPAWN_MIN, cell_center, cell_of};
use crate::player::Player;
use crate::rng::SplitMix64;
use crate::rules::{Ruleset, TypeId, fx_centi};

pub type UnitId = EntityId;

pub const TICK_RATE_HZ: u32 = 15;
pub const MAX_UNITS: u32 = 2000;
pub const UNIT_SPEED: Fx = Fx::from_raw(13107);
pub const SEPARATION_DISTANCE: Fx = Fx::from_raw(32768);
pub const MAX_SEPARATION_PUSH: Fx = Fx::from_raw(6553);
pub const ARRIVAL_CONTACT: Fx = Fx::from_raw(39321);

/// Behaviour of every variant but `Move` arrives in later issues; until then
/// they are ignored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    /// Phase 1 shape.
    Move {
        units: Vec<EntityId>,
        target: FxVec2,
    },
    Attack {
        units: Vec<EntityId>,
        target: EntityId,
    },
    Harvest {
        units: Vec<EntityId>,
        depot: EntityId,
    },
    Construct {
        dozer: EntityId,
        kind: TypeId,
        origin: Cell,
    },
    Resume {
        units: Vec<EntityId>,
        building: EntityId,
    },
    Produce {
        building: EntityId,
        kind: TypeId,
    },
    Cancel {
        building: EntityId,
    },
    Rally {
        building: EntityId,
        target: FxVec2,
    },
    Stop {
        units: Vec<EntityId>,
    },
    DebugSpawn {
        kind: TypeId,
        pos: FxVec2,
    },
    DebugSetHp {
        entity: EntityId,
        hp: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SimError {
    TooManyUnits { requested: u32, max: u32 },
    UnknownMap { id: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Ongoing,
    Winner(PlayerId),
    Draw,
}

pub struct World {
    pub(crate) tick: u32,
    pub(crate) rules: Ruleset,
    pub(crate) terrain: MapGrid,
    /// Terrain plus building and depot footprints (derived).
    pub(crate) nav: MapGrid,
    pub(crate) players: Vec<Player>,
    /// Ascending id; removed entities leave gaps.
    pub(crate) entities: Vec<Entity>,
    /// Starts at 0, never reused.
    pub(crate) next_entity_id: u32,
    /// Starts at 1.
    pub(crate) next_order_id: u32,
    /// Creation order.
    pub(crate) projectiles: Vec<Projectile>,
    pub(crate) pending: Vec<(PlayerId, Command)>,
    /// Keyed by goal cell index.
    pub(crate) fields: BTreeMap<CellIndex, FlowField>,
    pub(crate) outcome: Outcome,
    #[expect(dead_code, reason = "read by the victory phase (P2-14)")]
    pub(crate) victory_enabled: bool,
    #[expect(dead_code, reason = "read by the debug commands (P2-08)")]
    pub(crate) debug_commands: bool,
}

impl World {
    /// Tick 0, no entities, builtin rules, one player (id 0, faction 0,
    /// credits 0), victory disabled.
    pub fn new(map: MapGrid) -> World {
        let cells = usize::from(map.width()) * usize::from(map.height());
        World {
            tick: 0,
            rules: Ruleset::builtin(),
            terrain: map.clone(),
            nav: map,
            players: vec![Player::new(0, 0, 0, cells)],
            entities: Vec::new(),
            next_entity_id: 0,
            next_order_id: 1,
            projectiles: Vec::new(),
            pending: Vec::new(),
            fields: BTreeMap::new(),
            outcome: Outcome::Ongoing,
            victory_enabled: false,
            debug_commands: false,
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
            .filter(|&cell| world.nav.is_passable(cell))
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

    /// Appends a `tech-slice-placeholder` owned by player 0 with the next
    /// entity id, order `Idle { last_order_id: 0 }`.
    /// Panics if `pos` is not in a passable cell.
    pub fn spawn_unit_at(&mut self, pos: FxVec2) -> EntityId {
        assert!(
            self.nav.is_passable(cell_of(pos)),
            "spawn position {pos:?} is not in a passable cell"
        );
        let kind = self
            .rules
            .type_index("tech-slice-placeholder")
            .expect("the rules define tech-slice-placeholder");
        let id = self.next_entity_id;
        self.next_entity_id += 1;
        self.entities.push(Entity {
            id,
            owner: 0,
            kind,
            pos,
            hp: self.rules.ty(kind).hp,
            order: Order::Idle { last_order_id: 0 },
            cooldown: 0,
            cargo: 0,
            last_target: None,
            site: None,
        });
        id
    }

    /// == `enqueue_as(0, command)`.
    pub fn enqueue(&mut self, command: Command) {
        self.enqueue_as(0, command);
    }

    /// Applied at the start of the next step.
    pub fn enqueue_as(&mut self, player: PlayerId, command: Command) {
        self.pending.push((player, command));
    }

    pub fn step(&mut self) {
        self.apply_commands();
        self.move_units();
        self.separate_units();
        self.arrive_on_contact();
        self.drop_unused_fields();
        self.tick += 1;
    }

    /// Phase 1: applies pending commands in enqueue order.
    fn apply_commands(&mut self) {
        for (_, command) in std::mem::take(&mut self.pending) {
            if let Command::Move { units, target } = command {
                self.apply_move(&units, target);
            }
        }
    }

    fn apply_move(&mut self, units: &[EntityId], target: FxVec2) {
        let max_x = i32::from(self.nav.width()) * 65536 - 1;
        let max_y = i32::from(self.nav.height()) * 65536 - 1;
        let mut target = FxVec2::new(
            Fx::from_raw(target.x.raw().clamp(0, max_x)),
            Fx::from_raw(target.y.raw().clamp(0, max_y)),
        );
        let cell = cell_of(target);
        if !self.nav.is_passable(cell) {
            let Some(found) = self.nav.nearest_passable(cell) else {
                return;
            };
            target = cell_center(found);
        }
        let goal = cell_of(target);
        let map = &self.nav;
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
            if let Some(index) = self.index_of(id) {
                self.entities[index].order = order;
            }
        }
    }

    /// Phase 2: moves every unit with a move order one tick along its field.
    fn move_units(&mut self) {
        for unit in &mut self.entities {
            let speed = fx_centi(self.rules.ty(unit.kind).speed_centi);
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
                if delta.length() <= speed {
                    unit.pos = target;
                    unit.order = Order::Idle {
                        last_order_id: order_id,
                    };
                } else {
                    unit.pos = unit.pos + delta.normalize().scale(speed);
                }
                continue;
            }
            let direction = self
                .fields
                .get(&self.nav.index(goal))
                .and_then(|field| field.direction(cell));
            match direction {
                Some(dir) => unit.pos = unit.pos + dir.unit_vector().scale(speed),
                None => {
                    unit.order = Order::Idle {
                        last_order_id: order_id,
                    }
                }
            }
        }
    }

    /// Phase 3: pushes apart units closer than `SEPARATION_DISTANCE`, per
    /// axis and only into passable cells.
    fn separate_units(&mut self) {
        let before: Vec<FxVec2> = self.entities.iter().map(|unit| unit.pos).collect();
        let buckets = self.bucket_by_cell(&before);
        let half_push = Fx::from_raw(SEPARATION_DISTANCE.raw() / 2);
        for a in 0..self.entities.len() {
            let mut push = FxVec2::ZERO;
            for b in self.neighbours(&buckets, cell_of(before[a])) {
                if b == a {
                    continue;
                }
                let offset = before[a] - before[b];
                let d = offset.length();
                if d >= SEPARATION_DISTANCE {
                    continue;
                }
                let term = if d == Fx::ZERO {
                    let x = if a < b { -half_push } else { half_push };
                    FxVec2::new(x, Fx::ZERO)
                } else {
                    offset
                        .normalize()
                        .scale(Fx::from_raw((SEPARATION_DISTANCE - d).raw() / 2))
                };
                push = push + term;
            }
            if push.length() > MAX_SEPARATION_PUSH {
                push = push.normalize().scale(MAX_SEPARATION_PUSH);
            }
            let pos = self.entities[a].pos;
            let x = FxVec2::new(pos.x + push.x, pos.y);
            let pos = if self.nav.is_passable(cell_of(x)) {
                x
            } else {
                pos
            };
            let y = FxVec2::new(pos.x, pos.y + push.y);
            self.entities[a].pos = if self.nav.is_passable(cell_of(y)) {
                y
            } else {
                pos
            };
        }
    }

    /// Phase 4: a moving unit stops when it touches a unit that already
    /// completed the same order.
    fn arrive_on_contact(&mut self) {
        let orders: Vec<Order> = self.entities.iter().map(|unit| unit.order).collect();
        let positions: Vec<FxVec2> = self.entities.iter().map(|unit| unit.pos).collect();
        let buckets = self.bucket_by_cell(&positions);
        for a in 0..self.entities.len() {
            let Order::Move { order_id, .. } = orders[a] else {
                continue;
            };
            let touches = self.neighbours(&buckets, cell_of(positions[a])).any(|b| {
                orders[b]
                    == Order::Idle {
                        last_order_id: order_id,
                    }
                    && (positions[a] - positions[b]).length() <= ARRIVAL_CONTACT
            });
            if touches {
                self.entities[a].order = Order::Idle {
                    last_order_id: order_id,
                };
            }
        }
    }

    /// Unit indices grouped by the cell of `positions`, ascending within a cell.
    /// Units are always in passable (hence in-bounds) cells.
    fn bucket_by_cell(&self, positions: &[FxVec2]) -> Vec<Vec<usize>> {
        let cells = usize::from(self.nav.width()) * usize::from(self.nav.height());
        let mut buckets = vec![Vec::new(); cells];
        for (i, &pos) in positions.iter().enumerate() {
            buckets[self.nav.index(cell_of(pos)) as usize].push(i);
        }
        buckets
    }

    /// Unit indices in the 3 x 3 cells around `center`. Both
    /// `SEPARATION_DISTANCE` and `ARRIVAL_CONTACT` are below one tile, so
    /// this covers every candidate.
    fn neighbours<'a>(
        &'a self,
        buckets: &'a [Vec<usize>],
        center: Cell,
    ) -> impl Iterator<Item = usize> + 'a {
        (-1..=1)
            .flat_map(move |dy| {
                (-1..=1).map(move |dx| Cell {
                    x: center.x + dx,
                    y: center.y + dy,
                })
            })
            .filter(|&cell| self.nav.in_bounds(cell))
            .flat_map(move |cell| buckets[self.nav.index(cell) as usize].iter().copied())
    }

    /// Phase 5: removes flow fields no move order uses any more.
    fn drop_unused_fields(&mut self) {
        let used: BTreeSet<CellIndex> = self
            .entities
            .iter()
            .filter_map(|unit| match unit.order {
                Order::Move { goal, .. } => Some(self.nav.index(goal)),
                _ => None,
            })
            .collect();
        self.fields.retain(|goal, _| used.contains(goal));
    }

    /// Index of `id` in `entities` (binary search).
    fn index_of(&self, id: EntityId) -> Option<usize> {
        self.entities.binary_search_by_key(&id, |e| e.id).ok()
    }

    pub fn tick(&self) -> u32 {
        self.tick
    }

    pub fn rules(&self) -> &Ruleset {
        &self.rules
    }

    /// Navigation grid (terrain + footprints).
    pub fn map(&self) -> &MapGrid {
        &self.nav
    }

    pub fn terrain(&self) -> &MapGrid {
        &self.terrain
    }

    pub fn players(&self) -> &[Player] {
        &self.players
    }

    pub fn player(&self, id: PlayerId) -> Option<&Player> {
        self.players.get(usize::from(id))
    }

    pub fn entities(&self) -> &[Entity] {
        &self.entities
    }

    /// == `entities()`; Phase 1 name.
    pub fn units(&self) -> &[Entity] {
        &self.entities
    }

    pub fn entity(&self, id: EntityId) -> Option<&Entity> {
        self.index_of(id).map(|index| &self.entities[index])
    }

    /// == `entity(id)`; Phase 1 name.
    pub fn unit(&self, id: EntityId) -> Option<&Entity> {
        self.entity(id)
    }

    pub fn projectiles(&self) -> &[Projectile] {
        &self.projectiles
    }

    pub fn outcome(&self) -> Outcome {
        self.outcome
    }

    pub fn next_entity_id(&self) -> u32 {
        self.next_entity_id
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
