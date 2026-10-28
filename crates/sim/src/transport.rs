//! Spec 34: infantry ride vehicles (Zero Hour `TransportContain`). A rider
//! stays in `World::entities` with `aboard = Some(vehicle id)`: it is hidden,
//! cannot be targeted, moves with the vehicle and fires from it only when the
//! vehicle type allows it. Riders leave one at a time, `exit_ticks` apart; when
//! the vehicle dies they lose `damage_pct` of their maximum hit points and the
//! survivors are thrown out.

use std::collections::BTreeSet;

use crate::entity::{EntityId, NEUTRAL, Order, PlayerId};
use crate::fixed::Fx;
use crate::map::{Cell, cell_center, cell_of};
use crate::rules::{Category, LocoKind, TransportDef, fx_centi};
use crate::world::{Layer, World};

/// How close (centi-tiles between the two collision circles) a rider must be
/// to board.
const BOARD_RANGE_CENTI: u32 = 40;

impl World {
    /// Transport data of the live vehicle `carrier`.
    pub fn transport_def(&self, carrier: EntityId) -> Option<TransportDef> {
        let entity = self.entity(carrier)?;
        if entity.hp == 0 {
            return None;
        }
        self.rules.ty(entity.kind).transport
    }

    /// Ids of the riders of `carrier`, ascending.
    pub fn riders(&self, carrier: EntityId) -> Vec<EntityId> {
        self.entities
            .iter()
            .filter(|entity| entity.aboard == Some(carrier))
            .map(|entity| entity.id)
            .collect()
    }

    /// Zero Hour entry rules (`TransportContain::isValidContainerFor`): the
    /// rider is a free infantry unit of the vehicle's owner, the vehicle is a
    /// transport, free itself, and has a free slot (one per infantry).
    pub fn can_board(&self, unit: EntityId, carrier: EntityId) -> bool {
        let (Some(rider), Some(vehicle)) = (self.entity(unit), self.entity(carrier)) else {
            return false;
        };
        let Some(def) = self.transport_def(carrier) else {
            return false;
        };
        rider.hp > 0
            && rider.site.is_none()
            && !rider.contained()
            && rider.owner != NEUTRAL
            && rider.owner == vehicle.owner
            && self.rules.ty(rider.kind).category == Category::Unit
            && self.rules.ty(rider.kind).motion.kind == LocoKind::Foot
            && !vehicle.contained()
            && (self.riders(carrier).len() as u32) < def.slots
    }

    /// `Board` command: every listed unit of `player` that could board walks
    /// to the vehicle and enters it.
    pub(crate) fn apply_board(&mut self, player: PlayerId, units: &[EntityId], carrier: EntityId) {
        if self.transport_def(carrier).is_none() {
            return;
        }
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            if self.entities[index].owner == player && self.can_board(id, carrier) {
                self.entities[index].order = Order::Board { order_id, carrier };
            }
        }
    }

    /// `Disembark` command: the vehicle's owner starts unloading it.
    pub(crate) fn apply_disembark(&mut self, player: PlayerId, carrier: EntityId) {
        // Spec 40: patients inside a barracks are not riders; only real
        // transports unload early.
        if self.transport_def(carrier).is_none() || self.riders(carrier).is_empty() {
            return;
        }
        if let Some(index) = self.index_of(carrier) {
            let entity = &mut self.entities[index];
            if entity.owner == player && entity.unloading.is_none() {
                entity.unloading = Some(0);
            }
        }
    }

    /// `Board` order step: walk toward the vehicle (re-aimed every tick, as
    /// Zero Hour's enter state), board once the two circles nearly touch.
    pub(crate) fn step_board(&mut self, index: usize, order_id: u32, carrier: EntityId) {
        let id = self.entities[index].id;
        let Some(vehicle) = self
            .index_of(carrier)
            .filter(|_| self.can_board(id, carrier))
        else {
            self.entities[index].order = Order::Idle {
                last_order_id: order_id,
            };
            return;
        };
        let pos = self.entities[index].pos;
        let target = self.entities[vehicle].pos;
        let reach = self.radius_of(index) + self.radius_of(vehicle) + fx_centi(BOARD_RANGE_CENTI);
        if (target - pos).length() <= reach {
            let entity = &mut self.entities[index];
            entity.aboard = Some(carrier);
            entity.pos = target;
            entity.speed = Fx::ZERO;
            entity.reversing = false;
            entity.aim = None;
            entity.order = Order::Idle {
                last_order_id: order_id,
            };
            return;
        }
        if let Some(goal) = self.board_goal(carrier) {
            self.step_toward_goal(index, goal);
        }
    }

    /// Where a rider walks to board `carrier`: the passable foot cell nearest
    /// to the vehicle's cell.
    pub(crate) fn board_goal(&self, carrier: EntityId) -> Option<Cell> {
        let vehicle = self.entity(carrier)?;
        self.grid(Layer::Foot)
            .nearest_passable(cell_of(vehicle.pos))
    }

    /// Movement phase, after the vehicles moved: riders take their vehicle's
    /// position, so they fire and see from it.
    pub(crate) fn carry_riders(&mut self) {
        for index in 0..self.entities.len() {
            let Some(carrier) = self.entities[index].aboard else {
                continue;
            };
            match self.index_of(carrier) {
                Some(vehicle) => self.entities[index].pos = self.entities[vehicle].pos,
                None => self.entities[index].aboard = None,
            }
        }
    }

    /// Spec 34: a rider fires only from a vehicle with fire ports, and only an
    /// infantry rider (`TransportContain` passenger fire).
    pub(crate) fn rider_may_fire(&self, index: usize) -> bool {
        match self.entities[index].aboard {
            None => true,
            Some(carrier) => self
                .transport_def(carrier)
                .is_some_and(|def| def.fire_from_inside),
        }
    }

    /// Unloading vehicles let their lowest-id rider out on a free cell around
    /// them, then wait `exit_ticks` before the next (Zero Hour `ExitDelay`).
    /// With no free cell the rider waits inside.
    pub(crate) fn unload_transports(&mut self) {
        for index in 0..self.entities.len() {
            let Some(wait) = self.entities[index].unloading else {
                continue;
            };
            if wait > 0 {
                self.entities[index].unloading = Some(wait - 1);
                continue;
            }
            let carrier = self.entities[index].id;
            let riders = self.riders(carrier);
            let Some(&first) = riders.first() else {
                self.entities[index].unloading = None;
                continue;
            };
            let cell = cell_of(self.entities[index].pos);
            let Some(free) = self.free_cell_around(cell.x, cell.y, 1, 1, &BTreeSet::new()) else {
                continue;
            };
            let exit_ticks = self.transport_def(carrier).map_or(0, |def| def.exit_ticks);
            if let Some(rider) = self.index_of(first) {
                let entity = &mut self.entities[rider];
                entity.aboard = None;
                entity.pos = cell_center(free);
                entity.order = Order::Idle { last_order_id: 0 };
            }
            self.entities[index].unloading = (riders.len() > 1).then_some(exit_ticks);
        }
    }

    /// Deaths phase, before the dead are removed: the riders of each destroyed
    /// vehicle lose `damage_pct` of their maximum hit points (`OpenContain::onDie`,
    /// 100 kills them) and the survivors are thrown out around the wreck; those
    /// with no free cell die.
    pub(crate) fn empty_dead_transports(&mut self) {
        let dead: Vec<(EntityId, Cell, u32)> = self
            .entities
            .iter()
            .filter(|entity| entity.hp == 0)
            .filter_map(|entity| {
                let def = self.rules.ty(entity.kind).transport?;
                Some((entity.id, cell_of(entity.pos), def.damage_pct))
            })
            .collect();
        for (carrier, cell, damage_pct) in dead {
            let killer = self.entity(carrier).and_then(|entity| entity.last_hit);
            let mut used: BTreeSet<Cell> = BTreeSet::new();
            for id in self.riders(carrier) {
                let Some(index) = self.index_of(id) else {
                    continue;
                };
                let max_hp = self.rules.ty(self.entities[index].kind).hp;
                let loss = (u64::from(max_hp) * u64::from(damage_pct) / 100) as u32;
                let free = self.free_cell_around(cell.x, cell.y, 1, 1, &used);
                let entity = &mut self.entities[index];
                entity.aboard = None;
                entity.hp = if damage_pct >= 100 {
                    0
                } else {
                    entity.hp.saturating_sub(loss)
                };
                if entity.hp == 0 {
                    entity.last_hit = killer;
                    continue;
                }
                match free {
                    Some(free) => {
                        used.insert(free);
                        entity.pos = cell_center(free);
                        entity.order = Order::Idle { last_order_id: 0 };
                    }
                    None => {
                        entity.hp = 0;
                        entity.last_hit = killer;
                    }
                }
            }
        }
    }
}
