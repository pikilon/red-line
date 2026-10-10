//! Simulation world: entities, players, orders and the fixed-tick step.

use std::collections::{BTreeMap, BTreeSet};

use crate::entity::{Entity, NEUTRAL, PlayerId, Projectile, Site};
pub use crate::entity::{EntityId, Order, Unit};
use crate::fixed::{Fx, FxVec2};
use crate::flow::FlowField;
use crate::map::{Cell, CellIndex, MapGrid, SPAWN_MAX, SPAWN_MIN, cell_center, cell_of};
use crate::nav::{footprint_cells, footprint_center};
use crate::player::Player;
use crate::rng::SplitMix64;
use crate::rules::{Category, FactionId, Ruleset, TypeId, fx_centi};

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
    pub(crate) victory_enabled: bool,
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

    /// Players `0..factions.len()` with credits = `rules.starting_credits`;
    /// victory and debug commands disabled; nothing explored.
    pub fn sandbox(rules: Ruleset, map: MapGrid, factions: &[FactionId]) -> World {
        let mut world = World::new(map);
        let cells = world.players[0].explored.len();
        world.players = factions
            .iter()
            .enumerate()
            .map(|(id, &faction)| {
                Player::new(id as PlayerId, faction, rules.starting_credits, cells)
            })
            .collect();
        world.rules = rules;
        world
    }

    /// AC-03-09, spec §5.6: builds a skirmish from `map_id`: terrain from the
    /// blocked rectangles, one player per start, every depot, then each start's
    /// HQ and dozer in normative id order, victory enabled and initial
    /// visibility. `seed` is reserved for later phases and does not affect the
    /// Phase 2 state.
    pub fn skirmish(rules: Ruleset, map_id: &str, _seed: u64) -> Result<World, SimError> {
        let map = rules
            .map(map_id)
            .cloned()
            .ok_or_else(|| SimError::UnknownMap {
                id: map_id.to_string(),
            })?;

        let mut terrain = MapGrid::open(map.width, map.height);
        for rect in &map.blocked {
            for y in rect[1]..=rect[3] {
                for x in rect[0]..=rect[2] {
                    terrain.set_blocked(Cell { x, y }, true);
                }
            }
        }

        let factions: Vec<FactionId> = map.starts.iter().map(|start| start.faction).collect();
        let mut world = World::sandbox(rules, terrain, &factions);

        for depot in &map.depots {
            world.place_depot(
                Cell {
                    x: depot.origin[0],
                    y: depot.origin[1],
                },
                depot.amount,
            );
        }

        for (index, start) in map.starts.iter().enumerate() {
            let player = index as PlayerId;
            let faction = &world.rules.factions[usize::from(start.faction)];
            let (hq, dozer) = (faction.hq, faction.dozer);
            world.place_building(
                player,
                hq,
                Cell {
                    x: start.hq[0],
                    y: start.hq[1],
                },
                true,
            );
            world.spawn(
                player,
                dozer,
                FxVec2::new(
                    fx_centi(start.dozer_centi[0]),
                    fx_centi(start.dozer_centi[1]),
                ),
            );
        }

        world.victory_enabled = true;
        world.refresh_visibility();
        Ok(world)
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
        let hp = self.rules.ty(kind).hp;
        self.push_entity(0, kind, pos, hp, None)
    }

    /// Unit of `kind` (category Unit), order `Idle { last_order_id: 0 }`, hp =
    /// type hp. Panics if not a unit type, the cell is not nav-passable, or
    /// `MAX_UNITS` entities exist.
    pub fn spawn(&mut self, owner: PlayerId, kind: TypeId, pos: FxVec2) -> EntityId {
        let ty = self.rules.ty(kind);
        assert_eq!(ty.category, Category::Unit, "type {kind} is not a unit");
        assert!(
            self.nav.is_passable(cell_of(pos)),
            "spawn position {pos:?} is not in a passable cell"
        );
        assert!(
            (self.entities.len() as u32) < MAX_UNITS,
            "MAX_UNITS entities exist"
        );
        let hp = ty.hp;
        self.push_entity(owner, kind, pos, hp, None)
    }

    /// Building (category Building). complete: hp = type hp, progress =
    /// build_ticks * 100; else hp = max(1, type hp / 10), progress 0. Panics
    /// unless the footprint is free. Rebuilds the nav grid.
    pub fn place_building(
        &mut self,
        owner: PlayerId,
        kind: TypeId,
        origin: Cell,
        complete: bool,
    ) -> EntityId {
        let ty = self.rules.ty(kind);
        assert_eq!(
            ty.category,
            Category::Building,
            "type {kind} is not a building"
        );
        let (hp, progress) = if complete {
            (ty.hp, ty.build_ticks * 100)
        } else {
            ((ty.hp / 10).max(1), 0)
        };
        self.place_site(owner, kind, origin, hp, progress, complete)
    }

    /// Depot of `rules.depot_type()`, owner `NEUTRAL`, hp = amount, complete.
    /// Panics unless the footprint is free. Rebuilds the nav grid.
    pub fn place_depot(&mut self, origin: Cell, amount: u32) -> EntityId {
        let kind = self.rules.depot_type();
        self.place_site(NEUTRAL, kind, origin, amount, 0, true)
    }

    pub fn set_credits(&mut self, player: PlayerId, credits: u32) {
        self.players[usize::from(player)].credits = credits;
    }

    /// Removal happens in the next deaths phase.
    pub fn set_hp(&mut self, id: EntityId, hp: u32) {
        if let Some(index) = self.index_of(id) {
            self.entities[index].hp = hp;
        }
    }

    pub fn enable_victory(&mut self) {
        self.victory_enabled = true;
    }

    pub fn enable_debug_commands(&mut self) {
        self.debug_commands = true;
    }

    fn place_site(
        &mut self,
        owner: PlayerId,
        kind: TypeId,
        origin: Cell,
        hp: u32,
        progress: u32,
        complete: bool,
    ) -> EntityId {
        let size = self.rules.ty(kind).footprint;
        assert!(
            self.footprint_free(origin, size),
            "footprint at {origin:?} is not free"
        );
        let site = Site {
            origin,
            progress,
            complete,
            queue: Vec::new(),
            rally: None,
        };
        let id = self.push_entity(owner, kind, footprint_center(origin, size), hp, Some(site));
        self.rebuild_nav();
        id
    }

    fn push_entity(
        &mut self,
        owner: PlayerId,
        kind: TypeId,
        pos: FxVec2,
        hp: u32,
        site: Option<Site>,
    ) -> EntityId {
        let id = self.next_entity_id;
        self.next_entity_id += 1;
        self.entities.push(Entity {
            id,
            owner,
            kind,
            pos,
            hp,
            order: Order::Idle { last_order_id: 0 },
            cooldown: 0,
            cargo: 0,
            last_target: None,
            site,
        });
        id
    }

    /// Every cell is in bounds and nav-passable, and no unit stands inside.
    pub(crate) fn footprint_free(&self, origin: Cell, size: [u16; 2]) -> bool {
        let cells = footprint_cells(origin, size);
        cells.iter().all(|&cell| self.nav.is_passable(cell))
            && !self
                .entities
                .iter()
                .any(|e| e.site.is_none() && cells.contains(&cell_of(e.pos)))
    }

    /// `nav = terrain` plus every building and depot footprint; clears the flow
    /// fields and remaps every `Move` whose goal became blocked (Phase 1 rule).
    pub(crate) fn rebuild_nav(&mut self) {
        let mut nav = self.terrain.clone();
        for entity in &self.entities {
            if let Some(site) = &entity.site {
                for cell in footprint_cells(site.origin, self.rules.ty(entity.kind).footprint) {
                    nav.set_blocked(cell, true);
                }
            }
        }
        self.nav = nav;
        self.fields.clear();
        for entity in &mut self.entities {
            let Order::Move { order_id, goal, .. } = entity.order else {
                continue;
            };
            if self.nav.is_passable(goal) {
                continue;
            }
            entity.order = match self.nav.nearest_passable(goal) {
                None => Order::Idle {
                    last_order_id: order_id,
                },
                Some(found) => Order::Move {
                    order_id,
                    target: cell_center(found),
                    goal: found,
                },
            };
        }
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
        self.update_visibility();
        self.drop_unused_fields();
        self.tick += 1;
    }

    /// Phase 1: applies pending commands in enqueue order.
    fn apply_commands(&mut self) {
        for (player, command) in std::mem::take(&mut self.pending) {
            if let Command::Move { units, target } = command {
                self.apply_move(player, &units, target);
            }
        }
    }

    /// Only units owned by `player` receive the order.
    fn apply_move(&mut self, player: PlayerId, units: &[EntityId], target: FxVec2) {
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
                let entity = &mut self.entities[index];
                if entity.owner == player && entity.site.is_none() {
                    entity.order = order;
                }
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
        // Buildings and depots neither push nor are pushed.
        let is_unit: Vec<bool> = self.entities.iter().map(|e| e.site.is_none()).collect();
        for a in 0..self.entities.len() {
            if !is_unit[a] {
                continue;
            }
            let mut push = FxVec2::ZERO;
            for b in self.neighbours(&buckets, cell_of(before[a])) {
                if b == a || !is_unit[b] {
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
