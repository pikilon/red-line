//! Spec 40: damaged infantry heal inside an own barracks (Zero Hour
//! `HealContain`). A patient keeps its place in `World::entities` with
//! `aboard = Some(building)`: it is hidden, untargetable and immobile, and its
//! countdown lives in `Order::Heal`. At full health it leaves on the first free
//! foot cell around the building. A destroyed or sold barracks ejects its
//! patients unharmed; one with no free cell dies.

use std::collections::{BTreeMap, BTreeSet};

use crate::entity::{EntityId, NEUTRAL, Order, PlayerId};
use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, cell_center, cell_of};
use crate::nav::{footprint_center, footprint_distance};
use crate::rules::{Category, LocoKind, fx_centi};
use crate::world::{Layer, World};

/// How close (centi-tiles from the footprint edge) a patient must be to enter.
const ENTER_RANGE_CENTI: u32 = 150;

impl World {
    /// Spec 40: the infantry-healing balance, if the ruleset has one.
    pub fn infirmary_def(&self) -> Option<crate::rules::InfirmaryDef> {
        self.rules.environment.infirmary
    }

    /// Ids of the patients inside `building`, ascending.
    pub fn patients(&self, building: EntityId) -> Vec<EntityId> {
        self.entities
            .iter()
            .filter(|entity| entity.aboard == Some(building))
            .map(|entity| entity.id)
            .collect()
    }

    /// Zero Hour `HealContain` entry rules: own living damaged foot infantry, a
    /// standing complete own building with `healsInfantry`, and a free slot.
    pub fn can_heal_at(&self, unit: EntityId, building: EntityId) -> bool {
        let (Some(patient), Some(infirmary)) = (self.entity(unit), self.entity(building)) else {
            return false;
        };
        let Some(def) = self.infirmary_def() else {
            return false;
        };
        let patient_ty = self.rules.ty(patient.kind);
        let building_ty = self.rules.ty(infirmary.kind);
        patient.owner == infirmary.owner
            && patient.owner != NEUTRAL
            && patient.hp > 0
            && patient.hp < patient_ty.hp
            && !patient.contained()
            && patient_ty.category == Category::Unit
            && patient_ty.motion.kind == LocoKind::Foot
            && infirmary.hp > 0
            && building_ty.category == Category::Building
            && building_ty.heals_infantry
            && infirmary.site.as_ref().is_some_and(|site| site.complete)
            && (self.patients(building).len() as u32) < def.slots
    }

    /// `HealAt` command: every eligible unit walks to the building and enters.
    pub(crate) fn apply_heal_at(
        &mut self,
        player: PlayerId,
        units: &[EntityId],
        building: EntityId,
    ) {
        if self
            .entity(building)
            .is_none_or(|entity| entity.owner != player)
        {
            return;
        }
        let Some(def) = self.infirmary_def() else {
            return;
        };
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            if self.entities[index].owner != player || !self.can_heal_at(id, building) {
                continue;
            }
            let missing = self.rules.ty(self.entities[index].kind).hp - self.entities[index].hp;
            self.entities[index].order = Order::Heal {
                order_id,
                building,
                missing,
                remaining: def.heal_ticks.max(1),
            };
        }
    }

    /// `Heal` order step: walk to the building footprint, then enter it.
    pub(crate) fn step_heal(&mut self, index: usize, order_id: u32, building: EntityId) {
        let id = self.entities[index].id;
        let Some((origin, size)) = self.infantry_site(building) else {
            self.entities[index].order = Order::Idle {
                last_order_id: order_id,
            };
            return;
        };
        if !self.can_heal_at(id, building) {
            self.entities[index].order = Order::Idle {
                last_order_id: order_id,
            };
            return;
        }
        let Some(def) = self.infirmary_def() else {
            return;
        };
        let pos = self.entities[index].pos;
        if footprint_distance(pos, origin, size) <= fx_centi(ENTER_RANGE_CENTI) {
            let max = self.rules.ty(self.entities[index].kind).hp;
            let hp = self.entities[index].hp;
            let entity = &mut self.entities[index];
            entity.aboard = Some(building);
            entity.pos = footprint_center(origin, size);
            entity.speed = Fx::ZERO;
            entity.reversing = false;
            entity.aim = None;
            entity.order = Order::Heal {
                order_id,
                building,
                missing: max - hp,
                remaining: def.heal_ticks.max(1),
            };
            return;
        }
        if let Some(goal) = self.heal_goal(pos, building) {
            self.step_toward_goal(index, goal);
        }
    }

    /// Every tick: active patients heal their entry deficit over `healTicks`,
    /// then leave on the first free cell around the building.
    pub(crate) fn heal_infirmaries(&mut self) {
        let Some(def) = self.infirmary_def() else {
            return;
        };
        let ticks = def.heal_ticks.max(1);
        let mut used: BTreeMap<EntityId, BTreeSet<Cell>> = BTreeMap::new();
        for index in 0..self.entities.len() {
            let Order::Heal {
                order_id,
                building,
                missing,
                remaining,
            } = self.entities[index].order
            else {
                continue;
            };
            if self.entities[index].aboard != Some(building) {
                continue;
            }
            let Some((origin, size)) = self.infantry_site(building) else {
                // The building no longer exists: never stay contained by nothing.
                self.entities[index].aboard = None;
                self.entities[index].order = Order::Idle {
                    last_order_id: order_id,
                };
                continue;
            };
            if !self
                .entity(building)
                .is_some_and(|entity| entity.hp > 0 && self.rules.ty(entity.kind).heals_infantry)
            {
                // A dead building is ejected by the death pass this tick.
                continue;
            }
            let max = self.rules.ty(self.entities[index].kind).hp;
            if remaining > 1 {
                let done = u64::from(ticks.saturating_sub(remaining));
                let before = u64::from(missing) * done / u64::from(ticks);
                let after = u64::from(missing) * (done + 1) / u64::from(ticks);
                let gain = (after - before) as u32;
                self.entities[index].hp = self.entities[index].hp.saturating_add(gain).min(max);
            } else {
                // The last active tick always leaves the patient whole.
                self.entities[index].hp = max;
            }
            let hp = self.entities[index].hp;
            let next = remaining.saturating_sub(1);
            self.entities[index].order = Order::Heal {
                order_id,
                building,
                missing,
                remaining: next,
            };
            if hp < max {
                continue;
            }
            let used = used.entry(building).or_default();
            self.exit_infirmary(index, origin, size, order_id, used);
        }
    }

    /// Deaths phase: a destroyed or sold barracks throws its patients out
    /// unharmed; a patient with no free cell dies. Zero Hour `OpenContain::onDie`.
    pub(crate) fn empty_dead_infirmaries(&mut self) {
        let dead: Vec<(EntityId, Cell, [u16; 2])> = self
            .entities
            .iter()
            .filter(|entity| entity.hp == 0 && self.rules.ty(entity.kind).heals_infantry)
            .filter_map(|entity| {
                let site = entity.site.as_ref()?;
                Some((entity.id, site.origin, self.rules.ty(entity.kind).footprint))
            })
            .collect();
        for (building, origin, size) in dead {
            let mut used: BTreeSet<Cell> = BTreeSet::new();
            for index in 0..self.entities.len() {
                if self.entities[index].aboard != Some(building) {
                    continue;
                }
                let order_id = match self.entities[index].order {
                    Order::Heal { order_id, .. } => order_id,
                    _ => 0,
                };
                if !self.exit_infirmary(index, origin, size, order_id, &mut used) {
                    let entity = &mut self.entities[index];
                    entity.aboard = None;
                    entity.hp = 0;
                }
            }
        }
    }

    /// Takes patient `index` out on a free foot cell around `origin`; false when
    /// there is none (the caller decides between waiting and dying).
    fn exit_infirmary(
        &mut self,
        index: usize,
        origin: Cell,
        size: [u16; 2],
        order_id: u32,
        used: &mut BTreeSet<Cell>,
    ) -> bool {
        let (w, h) = (i32::from(size[0]), i32::from(size[1]));
        let Some(cell) = self.free_cell_around(origin.x, origin.y, w, h, used) else {
            return false;
        };
        used.insert(cell);
        let entity = &mut self.entities[index];
        entity.aboard = None;
        entity.pos = cell_center(cell);
        entity.speed = Fx::ZERO;
        entity.reversing = false;
        entity.order = Order::Idle {
            last_order_id: order_id,
        };
        true
    }

    /// `(origin, footprint)` of a standing entity building.
    fn infantry_site(&self, building: EntityId) -> Option<(Cell, [u16; 2])> {
        let entity = self.entity(building)?;
        let site = entity.site.as_ref()?;
        Some((site.origin, self.rules.ty(entity.kind).footprint))
    }

    /// Where a patient at `pos` walks to enter `building`: the passable foot
    /// cell nearest to the footprint cell closest to it.
    fn heal_goal(&self, pos: FxVec2, building: EntityId) -> Option<Cell> {
        let (origin, size) = self.infantry_site(building)?;
        let here = cell_of(pos);
        let inner = Cell {
            x: here.x.clamp(origin.x, origin.x + i32::from(size[0]) - 1),
            y: here.y.clamp(origin.y, origin.y + i32::from(size[1]) - 1),
        };
        self.grid(Layer::Foot).nearest_passable(inner)
    }
}
