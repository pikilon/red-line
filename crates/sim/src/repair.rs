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
/// Feature family that can be repaired today.
const REPAIRABLE_FAMILY: &str = "bridge";

impl World {
    /// Index of the living or broken bridge whose deck covers `cell`.
    pub fn repair_job_at(&self, cell: Cell) -> Option<u32> {
        self.features
            .iter()
            .position(|row| {
                let def = &self.rules.feature_types[row.kind as usize];
                let (x0, y0, x1, y1) = extent(def, row);
                def.family == REPAIRABLE_FAMILY
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
            && def.family == REPAIRABLE_FAMILY
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
            self.entities[index].order = Order::Idle {
                last_order_id: order_id,
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
            let max = self.rules.feature_types[self.features[feature as usize].kind as usize].hp;
            let gain = u64::from(max)
                * u64::from(repair.permille_per_second_per_point)
                * u64::from(points)
                / 1000;
            self.repair_feature(feature as usize, (gain as u32).max(1));
        }
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
