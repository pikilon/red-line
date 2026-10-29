//! Spec 35: repair works. Infantry and dozers repair a damaged or broken
//! bridge; every worker on the job adds its work points (a deliberate
//! difference from Zero Hour, where one dozer heals at a time and bridges are
//! not repairable). Once a second, a job regains
//! `points * permille_per_second_per_point` permille of its maximum hit points;
//! a broken bridge opens again when it climbs out of the wrecked state.

use std::collections::BTreeMap;

use crate::entity::{EntityId, NEUTRAL, Order, PlayerId};
use crate::features::{FeatureState, blocking_differs, distance_to_rect, extent, state_for};
use crate::fixed::Fx;
use crate::map::{Cell, cell_of};
use crate::rules::{Category, LocoKind, fx_centi};
use crate::world::{TICK_RATE_HZ, World};

/// How close (centi-tiles from the job's cells) a worker must stand to work.
const WORK_RANGE_CENTI: u32 = 150;
/// Feature families that can be repaired: bridges, and earthworks, whose
/// digging is their repair from one hit point.
const REPAIRABLE_FAMILIES: [&str; 2] = ["bridge", EARTHWORK_FAMILY];
/// Longest line a `DigLine` command may dig, in segments.
const MAX_LINE_SEGMENTS: usize = 64;
/// How far (cells) the next unfinished trench of a line may lie from the one
/// just dug; a gap for a blocked segment stays inside it.
const DIG_NEXT_RANGE: i32 = 8;
/// Family of the features soldiers dig during a match (spec 35).
pub const EARTHWORK_FAMILY: &str = "earthwork";

impl World {
    /// Index of the living or broken bridge whose deck covers `cell`.
    pub fn repair_job_at(&self, cell: Cell) -> Option<u32> {
        self.features
            .iter()
            .position(|row| {
                let def = &self.rules.feature_types[row.kind as usize];
                let (x0, y0, x1, y1) = extent(def, row);
                REPAIRABLE_FAMILIES.contains(&def.family.as_str())
                    && (x0..=x1).contains(&cell.x)
                    && (y0..=y1).contains(&cell.y)
            })
            .map(|index| index as u32)
    }

    /// True when feature `feature` is a repairable job below full hit points.
    pub fn needs_repair(&self, feature: u32) -> bool {
        let Some(row) = self.features.get(feature as usize) else {
            return false;
        };
        let def = &self.rules.feature_types[row.kind as usize];
        self.rules.environment.repair.is_some()
            && REPAIRABLE_FAMILIES.contains(&def.family.as_str())
            && def.hp > 0
            && row.collapse == 0
            && (!row.alive || row.hp < def.hp)
    }

    /// Work points the unit brings to a job: dozers (types that build) and
    /// infantry work, everything else does not.
    pub fn work_points(&self, unit: EntityId) -> u32 {
        let (Some(entity), Some(repair)) = (self.entity(unit), self.rules.environment.repair)
        else {
            return 0;
        };
        let ty = self.rules.ty(entity.kind);
        if entity.hp == 0 || entity.site.is_some() || entity.contained() || entity.owner == NEUTRAL
        {
            return 0;
        }
        if ty.category != Category::Unit {
            0
        } else if !ty.builds.is_empty() {
            repair.dozer_points
        } else if ty.motion.kind == LocoKind::Foot {
            repair.infantry_points
        } else {
            0
        }
    }

    /// True when `unit` can work on `feature`.
    pub fn can_repair(&self, unit: EntityId, feature: u32) -> bool {
        self.work_points(unit) > 0 && self.needs_repair(feature)
    }

    /// `Repair` command: every listed unit of `player` that can work walks to
    /// the job and works on it.
    pub(crate) fn apply_repair(&mut self, player: PlayerId, units: &[EntityId], feature: u32) {
        if !self.needs_repair(feature) {
            return;
        }
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            if self.entities[index].owner == player && self.can_repair(id, feature) {
                self.entities[index].order = Order::Repair { order_id, feature };
            }
        }
    }

    /// True when an entity building is alive, complete and below full HP (spec 38).
    pub fn needs_building_repair(&self, building: EntityId) -> bool {
        self.rules.environment.repair.is_some()
            && self.entity(building).is_some_and(|entity| {
                let ty = self.rules.ty(entity.kind);
                entity.hp > 0
                    && entity.hp < ty.hp
                    && ty.category == Category::Building
                    && entity.site.as_ref().is_some_and(|site| site.complete)
            })
    }

    /// Only a dozer of the building's owner repairs entity buildings (spec 38).
    pub fn can_repair_building(&self, unit: EntityId, building: EntityId) -> bool {
        let (Some(worker), Some(target)) = (self.entity(unit), self.entity(building)) else {
            return false;
        };
        worker.owner == target.owner
            && !self.rules.ty(worker.kind).builds.is_empty()
            && self.work_points(unit) > 0
            && self.needs_building_repair(building)
    }

    /// `RepairBuilding` command: every listed dozer of the owner approaches;
    /// only the lowest-id active dozer heals, as Zero Hour's sole benefactor.
    pub(crate) fn apply_repair_building(
        &mut self,
        player: PlayerId,
        units: &[EntityId],
        building: EntityId,
    ) {
        if self
            .entity(building)
            .is_none_or(|entity| entity.owner != player)
            || !self.needs_building_repair(building)
        {
            return;
        }
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            if self.entities[index].owner == player && self.can_repair_building(id, building) {
                self.entities[index].order = Order::RepairBuilding { order_id, building };
            }
        }
    }

    /// True when this damaged non-foot vehicle can dock at that own repair pad.
    pub fn can_repair_vehicle_at(&self, unit: EntityId, factory: EntityId) -> bool {
        let (Some(vehicle), Some(pad)) = (self.entity(unit), self.entity(factory)) else {
            return false;
        };
        let vehicle_ty = self.rules.ty(vehicle.kind);
        let pad_ty = self.rules.ty(pad.kind);
        vehicle.owner == pad.owner
            && vehicle.hp > 0
            && vehicle.hp < vehicle_ty.hp
            && !vehicle.contained()
            && vehicle_ty.category == Category::Unit
            && vehicle_ty.motion.kind != LocoKind::Foot
            && pad.hp > 0
            && pad_ty.category == Category::Building
            && pad_ty.repairs_vehicles
            && pad.site.as_ref().is_some_and(|site| site.complete)
    }

    /// `RepairVehicle` command: every eligible vehicle approaches the factory;
    /// one docked vehicle is repaired at a time (spec 39).
    pub(crate) fn apply_repair_vehicle(
        &mut self,
        player: PlayerId,
        units: &[EntityId],
        factory: EntityId,
    ) {
        if self
            .entity(factory)
            .is_none_or(|entity| entity.owner != player)
        {
            return;
        }
        let Some(repair) = self.rules.environment.repair else {
            return;
        };
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            if self.entities[index].owner != player || !self.can_repair_vehicle_at(id, factory) {
                continue;
            }
            let missing = self.rules.ty(self.entities[index].kind).hp - self.entities[index].hp;
            self.entities[index].order = Order::RepairVehicle {
                order_id,
                factory,
                missing,
                remaining: repair.vehicle_repair_ticks,
            };
        }
    }

    /// Number of features the map placed; later rows were dug in the match.
    pub fn placed_feature_count(&self) -> usize {
        self.map_id
            .as_ref()
            .and_then(|id| self.rules.maps.iter().find(|map| &map.id == id))
            .map_or(self.features.len(), |map| map.features.len())
            .min(self.features.len())
    }

    /// The cells feature type `kind` would cover at `origin` turned `rot`,
    /// when they are on the map, open to infantry and free of other features.
    fn dig_cells(&self, kind: usize, origin: Cell, rot: u8) -> Option<Vec<Cell>> {
        let (w, h) = crate::features::footprint(&self.rules.feature_types[kind], rot);
        let grid = self.grid(crate::world::Layer::Foot);
        let mut cells = Vec::new();
        for y in origin.y..origin.y + h {
            for x in origin.x..origin.x + w {
                let cell = Cell { x, y };
                if !grid.in_bounds(cell)
                    || !grid.is_passable(cell)
                    || self.feature_at(cell).is_some()
                    || self.repair_job_at(cell).is_some()
                {
                    return None;
                }
                cells.push(cell);
            }
        }
        Some(cells)
    }

    /// Pushes an empty trench (one hit point) at `origin` and returns its
    /// feature index, or `None` when its cells are not free.
    fn dig_trench(&mut self, origin: Cell, rot: u8) -> Option<u32> {
        let kind = self
            .rules
            .feature_types
            .iter()
            .position(|ty| ty.family == EARTHWORK_FAMILY)?;
        self.dig_cells(kind, origin, rot % 4)?;
        let def = &self.rules.feature_types[kind];
        self.features.push(FeatureState {
            kind: kind as u32,
            x: origin.x,
            y: origin.y,
            rot: rot % 4,
            variant: 0,
            state: state_for(1, def.hp, def.states.damaged, def.states.wrecked),
            hp: 1,
            alive: true,
            to: None,
            burn: 0,
            collapse: 0,
        });
        Some((self.features.len() - 1) as u32)
    }

    fn has_digger(&self, player: PlayerId, units: &[EntityId]) -> bool {
        units.iter().any(|&id| {
            self.entity(id).is_some_and(|e| e.owner == player) && self.work_points(id) > 0
        })
    }

    /// `Dig` command: a new trench at `origin` (empty, one hit point) and the
    /// listed workers of `player` dig it. Refused when the cells are not free.
    pub(crate) fn apply_dig(
        &mut self,
        player: PlayerId,
        units: &[EntityId],
        origin: Cell,
        rot: u8,
    ) {
        if !self.has_digger(player, units) {
            return;
        }
        if let Some(index) = self.dig_trench(origin, rot) {
            self.apply_repair(player, units, index);
        }
    }

    /// `DigLine` command (spec 35 §5b.1): every segment whose cells are free
    /// becomes an empty trench, in the given order; blocked ones are skipped.
    /// The workers dig the first and `step_repair` hands them on to the next.
    pub(crate) fn apply_dig_line(
        &mut self,
        player: PlayerId,
        units: &[EntityId],
        segments: &[(Cell, u8)],
    ) {
        if !self.has_digger(player, units) {
            return;
        }
        let mut first = None;
        for &(origin, rot) in segments.iter().take(MAX_LINE_SEGMENTS) {
            if let Some(index) = self.dig_trench(origin, rot) {
                first.get_or_insert(index);
            }
        }
        if let Some(index) = first {
            self.apply_repair(player, units, index);
        }
    }

    /// The next unfinished trench after a worker finishes `done`: the lowest
    /// row (the order the line was drawn in) within `DIG_NEXT_RANGE` cells.
    fn next_trench(&self, done: u32) -> Option<u32> {
        let row = self.features.get(done as usize)?;
        let def = &self.rules.feature_types[row.kind as usize];
        if def.family != EARTHWORK_FAMILY {
            return None;
        }
        let (x, y) = (row.x, row.y);
        (0..self.features.len() as u32).find(|&index| {
            let other = &self.features[index as usize];
            self.needs_repair(index)
                && self.rules.feature_types[other.kind as usize].family == EARTHWORK_FAMILY
                && (other.x - x).abs().max((other.y - y).abs()) <= DIG_NEXT_RANGE
        })
    }

    /// Distance from the unit to the cells of `feature`.
    fn job_distance(&self, index: usize, feature: u32) -> Fx {
        let row = &self.features[feature as usize];
        let rect = extent(&self.rules.feature_types[row.kind as usize], row);
        distance_to_rect(self.entities[index].pos, rect)
    }

    /// `Repair` order step: walk to the job, then stand and work until it is
    /// whole (the work itself is `repair_works`).
    pub(crate) fn step_repair(&mut self, index: usize, order_id: u32, feature: u32) {
        let id = self.entities[index].id;
        if !self.can_repair(id, feature) {
            // A finished trench hands the digger on to the next of its line.
            self.entities[index].order = match self.next_trench(feature) {
                Some(next) if self.can_repair(id, next) => Order::Repair {
                    order_id,
                    feature: next,
                },
                _ => Order::Idle {
                    last_order_id: order_id,
                },
            };
            return;
        }
        if self.job_distance(index, feature) <= fx_centi(WORK_RANGE_CENTI) {
            self.entities[index].speed = Fx::ZERO;
            return;
        }
        if let Some(goal) = self.repair_goal(index, feature) {
            self.step_toward_goal(index, goal);
        }
    }

    /// Approach an entity building and stand within work range (spec 38).
    pub(crate) fn step_repair_building(&mut self, index: usize, order_id: u32, building: EntityId) {
        let id = self.entities[index].id;
        if !self.can_repair_building(id, building) {
            self.entities[index].order = Order::Idle {
                last_order_id: order_id,
            };
            return;
        }
        let pos = self.entities[index].pos;
        let docked = self
            .entity(building)
            .is_some_and(|target| self.entity_distance(pos, target) <= fx_centi(WORK_RANGE_CENTI));
        if docked {
            self.entities[index].speed = Fx::ZERO;
            return;
        }
        if let Some(goal) = self.build_goal(building) {
            self.step_toward_goal(index, goal);
        }
    }

    /// Approach the factory's outside dock and wait there (spec 39).
    pub(crate) fn step_repair_vehicle(&mut self, index: usize, order_id: u32, factory: EntityId) {
        let id = self.entities[index].id;
        if !self.can_repair_vehicle_at(id, factory) {
            self.entities[index].order = Order::Idle {
                last_order_id: order_id,
            };
            return;
        }
        let pos = self.entities[index].pos;
        let docked = self.entity(factory).is_some_and(|target| {
            self.entity_distance(pos, target) <= fx_centi(self.rules.dock_range_centi)
        });
        if docked {
            self.entities[index].speed = Fx::ZERO;
            return;
        }
        if let Some(goal) = self.build_goal(factory) {
            self.step_toward_goal(index, goal);
        }
    }

    /// Where unit `index` walks to work on `feature`: the passable cell, on its
    /// own layer, nearest to the job cell closest to it.
    pub(crate) fn repair_goal(&self, index: usize, feature: u32) -> Option<Cell> {
        let row = self.features.get(feature as usize)?;
        let (x0, y0, x1, y1) = extent(&self.rules.feature_types[row.kind as usize], row);
        let here = cell_of(self.entities[index].pos);
        let inner = Cell {
            x: here.x.clamp(x0, x1),
            y: here.y.clamp(y0, y1),
        };
        self.grid(self.layer_of(index)).nearest_passable(inner)
    }

    /// Once a second: every job gains the work of the workers in range (lowest
    /// ids first, at most `max_workers`).
    pub(crate) fn repair_works(&mut self) {
        let Some(repair) = self.rules.environment.repair else {
            return;
        };
        if !self.tick.is_multiple_of(TICK_RATE_HZ) {
            return;
        }
        let mut jobs: BTreeMap<u32, (u32, u32)> = BTreeMap::new();
        for index in 0..self.entities.len() {
            let Order::Repair { feature, .. } = self.entities[index].order else {
                continue;
            };
            if !self.needs_repair(feature)
                || self.job_distance(index, feature) > fx_centi(WORK_RANGE_CENTI)
            {
                continue;
            }
            let points = self.work_points(self.entities[index].id);
            let job = jobs.entry(feature).or_insert((0, 0));
            if points > 0 && job.0 < repair.max_workers {
                *job = (job.0 + 1, job.1 + points);
            }
        }
        for (feature, (_, points)) in jobs {
            let def = &self.rules.feature_types[self.features[feature as usize].kind as usize];
            let gain = u64::from(def.hp)
                * u64::from(repair.permille_per_second_per_point)
                * u64::from(points)
                * u64::from(def.repair_pct)
                / 100_000;
            self.repair_feature(feature as usize, (gain as u32).max(1));
        }

        // Entity buildings use one active dozer, not additive bridge work.
        let mut buildings: BTreeMap<EntityId, u32> = BTreeMap::new();
        for index in 0..self.entities.len() {
            let Order::RepairBuilding { building, .. } = self.entities[index].order else {
                continue;
            };
            let id = self.entities[index].id;
            if !self.can_repair_building(id, building) {
                continue;
            }
            let pos = self.entities[index].pos;
            let in_range = self.entity(building).is_some_and(|target| {
                self.entity_distance(pos, target) <= fx_centi(WORK_RANGE_CENTI)
            });
            if !in_range {
                continue;
            }
            let points = self.work_points(id);
            if points > 0 {
                buildings.entry(building).or_insert(points);
            }
        }
        for (building, points) in buildings {
            let Some(target) = self.entity(building) else {
                continue;
            };
            let gain = u64::from(self.rules.ty(target.kind).hp)
                * u64::from(repair.permille_per_second_per_point)
                * u64::from(points)
                / 1000;
            self.repair_entity(building, (gain as u32).max(1));
        }
        for index in 0..self.entities.len() {
            let Order::RepairBuilding { order_id, building } = self.entities[index].order else {
                continue;
            };
            if !self.needs_building_repair(building) {
                self.entities[index].order = Order::Idle {
                    last_order_id: order_id,
                };
            }
        }
    }

    /// Every tick, the lowest-id docked vehicle at each factory repairs its
    /// initial deficit over `vehicleRepairTicks`; waiting vehicles keep their
    /// own countdown untouched (spec 39).
    pub(crate) fn repair_vehicles(&mut self) {
        let Some(repair) = self.rules.environment.repair else {
            return;
        };
        let mut bays: BTreeMap<EntityId, EntityId> = BTreeMap::new();
        for index in 0..self.entities.len() {
            let Order::RepairVehicle { factory, .. } = self.entities[index].order else {
                continue;
            };
            let id = self.entities[index].id;
            if !self.can_repair_vehicle_at(id, factory) {
                continue;
            }
            let pos = self.entities[index].pos;
            let docked = self.entity(factory).is_some_and(|target| {
                self.entity_distance(pos, target) <= fx_centi(self.rules.dock_range_centi)
            });
            if docked {
                bays.entry(factory).or_insert(id);
            }
        }
        for (factory, id) in bays {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            let Order::RepairVehicle {
                order_id,
                missing,
                remaining,
                ..
            } = self.entities[index].order
            else {
                continue;
            };
            let max = self.rules.ty(self.entities[index].kind).hp;
            let ticks = repair.vehicle_repair_ticks.max(1);
            let remaining = remaining.max(1);
            // The rate is fixed when the cycle starts: the share of the initial
            // deficit that is due by this tick, so the whole deficit is repaired
            // in exactly `ticks` active ticks no matter how `remaining` shrinks.
            let done = u64::from(ticks.saturating_sub(remaining));
            let before = u64::from(missing) * done / u64::from(ticks);
            let after = u64::from(missing) * (done + 1) / u64::from(ticks);
            self.repair_entity(id, (after - before) as u32);
            let hp = self.entities[index].hp;
            self.entities[index].order = if hp == max {
                Order::Idle {
                    last_order_id: order_id,
                }
            } else if remaining == 1 {
                Order::RepairVehicle {
                    order_id,
                    factory,
                    missing: max - hp,
                    remaining: repair.vehicle_repair_ticks,
                }
            } else {
                Order::RepairVehicle {
                    order_id,
                    factory,
                    missing,
                    remaining: remaining - 1,
                }
            };
        }
    }

    /// Restores hit points to an entity without touching construction,
    /// production or rally state (spec 38).
    pub(crate) fn repair_entity(&mut self, building: EntityId, amount: u32) {
        let Some(index) = self.index_of(building) else {
            return;
        };
        let max = self.rules.ty(self.entities[index].kind).hp;
        self.entities[index].hp = self.entities[index].hp.saturating_add(amount).min(max);
    }

    /// Restores `amount` hit points to feature `index`: it stands again, and its
    /// damage state follows the hit points back up.
    pub(crate) fn repair_feature(&mut self, index: usize, amount: u32) {
        let row = self.features[index];
        let def = &self.rules.feature_types[row.kind as usize];
        let hp = row.hp.saturating_add(amount).min(def.hp);
        let next = FeatureState {
            hp,
            alive: true,
            state: state_for(hp, def.hp, def.states.damaged, def.states.wrecked),
            ..row
        };
        self.features[index] = next;
        if blocking_differs(&self.rules, &row, &next) {
            self.refresh_feature_blocks();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::state_hash;
    use crate::rules::Ruleset;
    use crate::save::{load_state, save_state};
    use crate::snapshot::{FEATURE_STRIDE, encode_features};
    use crate::world::Command;

    fn ground() -> World {
        World::skirmish(Ruleset::builtin(), "demo-ground", 3).unwrap()
    }

    fn rifleman(world: &mut World, x: i32, y: i32) -> EntityId {
        let kind = world.rules.type_index("ua-rifleman").unwrap();
        world.spawn(0, kind, crate::map::cell_center(Cell { x, y }))
    }

    fn dig(world: &mut World, units: Vec<EntityId>, x: i32, y: i32) {
        world.enqueue_as(
            0,
            Command::Dig {
                units,
                origin: Cell { x, y },
                rot: 0,
            },
        );
    }

    #[test]
    fn workers_dig_a_trench_that_covers_infantry_once_finished() {
        let mut world = ground();
        let placed = world.features.len();
        let units: Vec<EntityId> = (0..3).map(|i| rifleman(&mut world, 28 + i, 30)).collect();
        dig(&mut world, units.clone(), 30, 33);
        world.step();
        assert_eq!(world.features.len(), placed + 1, "the trench row appears");
        let trench = placed as u32;
        assert!(world.needs_repair(trench), "it starts empty");
        let soldier = world.index_of(units[0]).unwrap();
        world.entities[soldier].pos = crate::map::cell_center(Cell { x: 30, y: 33 });
        assert_eq!(
            world.unit_cover_pct(None, soldier),
            0,
            "no cover while digging"
        );
        for _ in 0..3000 {
            world.step();
            if !world.needs_repair(trench) {
                break;
            }
        }
        assert!(!world.needs_repair(trench), "dug to full");
        let soldier = world.index_of(units[0]).unwrap();
        world.entities[soldier].pos = crate::map::cell_center(Cell { x: 31, y: 33 });
        assert_eq!(world.unit_cover_pct(None, soldier), 50);
        // Vehicles get no trench cover.
        let tank = world.rules.type_index("ua-leopard-2a4").unwrap();
        let tank = world.spawn(0, tank, crate::map::cell_center(Cell { x: 30, y: 33 }));
        let tank = world.index_of(tank).unwrap();
        assert_eq!(world.unit_cover_pct(None, tank), 0);
    }

    #[test]
    fn a_trench_needs_free_open_cells() {
        let mut world = ground();
        let placed = world.features.len();
        let unit = rifleman(&mut world, 28, 30);
        dig(&mut world, vec![unit], 30, 33);
        world.step();
        dig(&mut world, vec![unit], 31, 33);
        world.step();
        assert_eq!(
            world.features.len(),
            placed + 1,
            "overlapping trench refused"
        );
        dig(&mut world, vec![unit], 63, 33);
        world.step();
        assert_eq!(world.features.len(), placed + 1, "off the map refused");
    }

    #[test]
    fn a_dug_line_skips_blocked_cells_and_is_dug_in_order() {
        let mut world = ground();
        let placed = world.features.len();
        let unit = rifleman(&mut world, 28, 30);
        // Block the middle segment with a trench already there.
        dig(&mut world, vec![unit], 34, 33);
        world.step();
        let segments = [(30, 0), (32, 0), (34, 0), (36, 0), (63, 0)]
            .map(|(x, rot)| (Cell { x, y: 33 }, rot))
            .to_vec();
        world.enqueue_as(
            0,
            Command::DigLine {
                units: vec![unit],
                segments,
            },
        );
        world.step();
        let xs: Vec<i32> = world.features[placed..].iter().map(|f| f.x).collect();
        assert_eq!(xs, vec![34, 30, 32, 36], "blocked and off-map ones skipped");
        for _ in 0..6000 {
            world.step();
            if (placed..placed + 4).all(|i| !world.needs_repair(i as u32)) {
                break;
            }
        }
        assert!(
            (placed..placed + 4).all(|i| !world.needs_repair(i as u32)),
            "the one soldier dug every segment"
        );
    }

    #[test]
    fn dug_rows_trail_the_feature_table_and_survive_a_save() {
        let mut world = ground();
        let unit = rifleman(&mut world, 28, 30);
        dig(&mut world, vec![unit], 30, 33);
        for _ in 0..40 {
            world.step();
        }
        let placed = world.placed_feature_count();
        let table = encode_features(&world);
        let rows = table[0] as usize;
        let trailer = 1 + rows * FEATURE_STRIDE;
        assert_eq!(&table[trailer..], &[placed as i32, 30, 33, 0]);
        let saved = save_state(&world, 3, &[]).unwrap();
        let (mut loaded, _, _) = load_state(&saved).unwrap();
        assert_eq!(state_hash(&loaded), state_hash(&world));
        for _ in 0..200 {
            world.step();
            loaded.step();
        }
        assert_eq!(state_hash(&loaded), state_hash(&world));
    }
}
