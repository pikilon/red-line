//! Spec 35 §5c: soldiers garrison a finished trench. There is no Zero Hour
//! precedent for trenches (decision D3); the garrison base copies spec 31
//! block 2 (`garrison.rs`). A trench piece (a 2x1 `earthwork` row) holds a few
//! soldiers who stay visible and stand at slot points along it. A shot that
//! reaches the piece wears the trench down only with the damage types its
//! `trench.breaksWith` names; any other hits one occupant for a small share.
//! Soldiers of two sides in one connected network advance piece by piece
//! until they touch, then fight with their sidearms.

use std::collections::{BTreeMap, VecDeque};

use crate::combat::damage_dealt;
use crate::entity::{EntityId, NEUTRAL, PlayerId};
use crate::features::{blocking_differs, extent, footprint, rect_gap, state_for};
use crate::fixed::FxVec2;
use crate::rules::{TrenchDef, WeaponDef, WeaponId, fx_centi};
use crate::world::World;

/// Damage type that never hurts a soldier in a trench fight (they carry a
/// sidearm instead).
const ANTI_TANK: &str = "antiTank";

impl World {
    /// Trench rules of feature `index` while it stands.
    pub fn trench_def(&self, index: u32) -> Option<TrenchDef> {
        let row = self.features.get(index as usize)?;
        if !row.alive {
            return None;
        }
        self.rules.feature_types[row.kind as usize].trench.clone()
    }

    /// Every standing trench piece, ascending.
    fn trench_pieces(&self) -> Vec<u32> {
        (0..self.features.len() as u32)
            .filter(|&index| self.trench_def(index).is_some())
            .collect()
    }

    /// Whether two pieces touch, diagonals included.
    fn trench_touching(&self, a: u32, b: u32) -> bool {
        let rect = |index: u32| {
            let row = &self.features[index as usize];
            extent(&self.rules.feature_types[row.kind as usize], row)
        };
        a != b && rect_gap(rect(a), rect(b)) <= 1
    }

    /// Pieces connected to `start` (itself first), nearest first: breadth
    /// first, neighbours in ascending feature index. Returns each with its
    /// parent on the way back to `start`.
    fn trench_network(&self, start: u32) -> Vec<(u32, u32)> {
        let pieces = self.trench_pieces();
        let mut order: Vec<(u32, u32)> = vec![(start, start)];
        let mut queue: VecDeque<u32> = VecDeque::from([start]);
        while let Some(piece) = queue.pop_front() {
            for &next in &pieces {
                if !order.iter().any(|&(seen, _)| seen == next) && self.trench_touching(piece, next)
                {
                    order.push((next, piece));
                    queue.push_back(next);
                }
            }
        }
        order
    }

    /// The piece of `start`'s network (nearest first) that takes a rider of
    /// `owner`; `pending` counts riders already assigned to each piece.
    pub(crate) fn trench_entry_piece(
        &self,
        owner: PlayerId,
        start: u32,
        pending: &BTreeMap<u32, u32>,
    ) -> Option<u32> {
        self.trench_network(start)
            .into_iter()
            .map(|(piece, _)| piece)
            .find(|piece| {
                self.piece_accepts(owner, *piece, pending.get(piece).copied().unwrap_or(0))
            })
    }

    /// Slot `slot` of piece `feature`: evenly spaced along its long axis, on
    /// its centre line (slot i of n at (2i+1)/2n of the length).
    fn trench_slot_point(&self, feature: u32, slot: u32) -> FxVec2 {
        let row = &self.features[feature as usize];
        let (w, h) = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
        let slots = self.garrison_def(feature).map_or(1, |def| def.slots.max(1));
        let (w, h) = (w.max(1) as u32 * 100, h.max(1) as u32 * 100);
        let along = |length: u32| length * (2 * slot + 1) / (2 * slots);
        let (dx, dy) = if w >= h {
            (along(w), h / 2)
        } else {
            (w / 2, along(h))
        };
        FxVec2::new(
            fx_centi(row.x as u32 * 100 + dx),
            fx_centi(row.y as u32 * 100 + dy),
        )
    }

    /// The first slot point of `feature` nobody stands on.
    pub(crate) fn trench_free_slot_point(&self, feature: u32) -> FxVec2 {
        let slots = self.garrison_def(feature).map_or(1, |def| def.slots);
        (0..slots)
            .map(|slot| self.trench_slot_point(feature, slot))
            .find(|point| {
                !self
                    .entities
                    .iter()
                    .any(|entity| entity.inside == Some(feature) && entity.pos == *point)
            })
            .unwrap_or_else(|| self.trench_slot_point(feature, 0))
    }

    /// A shot reaching trench piece `index` (spec 35 §5c). Damage types in
    /// `breaksWith` wear the trench down; when they would take it below zero
    /// it is destroyed and the overflow hurts the exposed occupants, who are
    /// then put out. Any other damage leaves the trench alone and hurts the
    /// lowest-id exposed occupant for `smallDamagePct` percent (at least 1).
    /// Exposed: not one of the first `shelterSlots` occupants of a covered
    /// (`variant` 1) piece.
    pub(crate) fn hit_trench(&mut self, index: usize, weapon: &WeaponDef) {
        let row = self.features[index];
        let Some(def) = self.trench_def(index as u32) else {
            return;
        };
        if weapon.damage == 0 {
            return;
        }
        let sheltered = if row.variant == 1 {
            def.shelter_slots as usize
        } else {
            0
        };
        let exposed: Vec<usize> = (0..self.entities.len())
            .filter(|&i| self.entities[i].inside == Some(index as u32) && self.entities[i].hp > 0)
            .skip(sheltered)
            .collect();
        if !def.breaks_with.contains(&weapon.damage_type) {
            if let Some(&victim) = exposed.first() {
                let share = (u64::from(weapon.damage) * u64::from(def.small_damage_pct) / 100)
                    .max(1) as u32;
                let hp = self.entities[victim].hp;
                self.entities[victim].hp = hp.saturating_sub(share);
            }
            return;
        }
        let ty = &self.rules.feature_types[row.kind as usize];
        let (max, states) = (ty.hp, ty.states);
        let size = footprint(ty, row.rot);
        if weapon.damage >= row.hp {
            let overflow = weapon.damage - row.hp;
            let next = crate::features::FeatureState {
                hp: 0,
                alive: false,
                burn: 0,
                ..row
            };
            self.features[index] = next;
            if blocking_differs(&self.rules, &row, &next) {
                self.refresh_feature_blocks();
            }
            for victim in exposed {
                let hp = self.entities[victim].hp;
                self.entities[victim].hp = hp.saturating_sub(overflow);
            }
            self.evict_feature(index as u32, false, size);
        } else {
            let hp = row.hp - weapon.damage;
            let computed = state_for(hp, max, states.damaged, states.wrecked);
            let next = crate::features::FeatureState {
                hp,
                state: row.state.max(computed),
                ..row
            };
            self.features[index] = next;
            if blocking_differs(&self.rules, &row, &next) {
                self.refresh_feature_blocks();
            }
        }
    }

    /// The enemy soldier that the occupant at `index` fights hand to hand: the
    /// lowest-id one in a piece touching its own that another player holds.
    /// `held` is `held_buildings()`.
    pub(crate) fn trench_contact_target(
        &self,
        index: usize,
        held: &[(u32, PlayerId)],
    ) -> Option<usize> {
        let attacker = &self.entities[index];
        let piece = attacker.inside?;
        self.trench_def(piece)?;
        let foes: Vec<u32> = held
            .iter()
            .filter(|&&(other, holder)| {
                holder != attacker.owner
                    && holder != NEUTRAL
                    && self.trench_def(other).is_some()
                    && self.trench_touching(piece, other)
            })
            .map(|&(other, _)| other)
            .collect();
        if foes.is_empty() {
            return None;
        }
        (0..self.entities.len()).find(|&i| {
            let entity = &self.entities[i];
            entity.hp > 0
                && entity.owner != attacker.owner
                && entity.inside.is_some_and(|inside| foes.contains(&inside))
        })
    }

    /// Hand-to-hand fire of the trench occupant at `index` at `target` (an
    /// entity in a touching piece): its `trenchWeapon`, else its own weapon,
    /// never an anti-tank one; no trench or cover reduction applies.
    pub(crate) fn fire_in_trench(&mut self, index: usize, target: usize) {
        let kind = self.entities[index].kind;
        let ty = self.rules.ty(kind);
        let chosen = if ty.trench_weapon >= 0 {
            ty.trench_weapon
        } else {
            ty.weapon
        };
        let Ok(slot) = usize::try_from(chosen) else {
            return;
        };
        let Some(weapon) = self.rules.weapons.get(slot).cloned() else {
            return;
        };
        let Ok(weapon_id) = WeaponId::try_from(slot) else {
            return;
        };
        if self.rules.damage_types[usize::from(weapon.damage_type)] == ANTI_TANK {
            return;
        }
        let cooldown = self.entities[index].cooldown;
        if cooldown > 0 {
            self.entities[index].cooldown = cooldown - 1;
            if cooldown > 1 {
                return;
            }
        }
        let shooter: EntityId = self.entities[index].id;
        let victim = &self.entities[target];
        let modifier = self
            .rules
            .modifier(weapon.damage_type, self.rules.ty(victim.kind).armor);
        let damage = damage_dealt(weapon.damage, modifier);
        let victim_id = victim.id;
        if damage > 0 {
            let hp = self.entities[target].hp;
            self.entities[target].hp = hp.saturating_sub(damage);
            self.entities[target].last_hit = Some((shooter, weapon_id));
        }
        self.entities[index].cooldown = weapon.cooldown_ticks;
        self.entities[index].last_target = Some(victim_id);
    }

    /// Every `advanceTicks`, soldiers of one trench network that holds
    /// opposing sides close in: one not touching an enemy-held piece moves one
    /// piece along the shortest path to the nearest enemy-held one, when the
    /// next piece has room and no enemy in it. Ascending soldier id.
    pub(crate) fn advance_in_trenches(&mut self) {
        let soldiers: Vec<EntityId> = self
            .entities
            .iter()
            .filter(|e| {
                e.hp > 0
                    && e.inside
                        .is_some_and(|piece| self.trench_def(piece).is_some())
            })
            .map(|e| e.id)
            .collect();
        let sides = |world: &World| {
            let mut owners: Vec<PlayerId> = world
                .entities
                .iter()
                .filter(|e| {
                    e.inside
                        .is_some_and(|piece| world.trench_def(piece).is_some())
                })
                .map(|e| e.owner)
                .collect();
            owners.sort_unstable();
            owners.dedup();
            owners.len()
        };
        if soldiers.is_empty() || sides(self) < 2 {
            return;
        }
        for id in soldiers {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            let (owner, Some(piece)) = (self.entities[index].owner, self.entities[index].inside)
            else {
                continue;
            };
            let Some(def) = self.trench_def(piece) else {
                continue;
            };
            if !self.tick.is_multiple_of(def.advance_ticks.max(1)) {
                continue;
            }
            let held = self.held_buildings();
            let foe = |other: u32| {
                held.iter()
                    .any(|&(held, holder)| held == other && holder != owner && holder != NEUTRAL)
            };
            let network = self.trench_network(piece);
            if network
                .iter()
                .any(|&(other, _)| foe(other) && self.trench_touching(piece, other))
            {
                continue;
            }
            let Some(&(goal, _)) = network.iter().find(|&&(other, _)| foe(other)) else {
                continue;
            };
            // Walk the parents back from the goal to the piece next to `piece`.
            let mut next = goal;
            while let Some(&(_, parent)) = network.iter().find(|&&(other, _)| other == next) {
                if parent == piece {
                    break;
                }
                next = parent;
            }
            if foe(next) || !self.piece_accepts(owner, next, 0) {
                continue;
            }
            let pos = self.trench_free_slot_point(next);
            let entity = &mut self.entities[index];
            entity.inside = Some(next);
            entity.pos = pos;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::Order;
    use crate::hash::state_hash;
    use crate::map::{Cell, cell_of};
    use crate::rules::Ruleset;
    use crate::save::{load_state, save_state};
    use crate::snapshot::{FLAG_INSIDE, encode_match_snapshot};
    use crate::world::Command;

    fn ground() -> World {
        let mut world = World::skirmish_with(Ruleset::builtin(), "demo-ground", false).unwrap();
        world.victory_enabled = false;
        world
    }

    /// A finished trench piece at `(x, y)`.
    fn piece(world: &mut World, x: i32, y: i32, variant: u8) -> u32 {
        let index = world.dig_trench(Cell { x, y }, 0, variant).unwrap();
        let hp = world.rules.feature_types[world.features[index as usize].kind as usize].hp;
        world.features[index as usize].hp = hp;
        world.features[index as usize].state = 0;
        index
    }

    fn soldier(world: &mut World, kind: &str, owner: PlayerId, x: u32, y: u32) -> EntityId {
        let kind = world.rules.type_index(kind).unwrap();
        world.spawn(owner, kind, FxVec2::new(fx_centi(x), fx_centi(y)))
    }

    fn garrison(world: &mut World, player: PlayerId, units: &[EntityId], feature: u32) {
        world.enqueue_as(
            player,
            Command::Garrison {
                units: units.to_vec(),
                feature,
            },
        );
    }

    fn run(world: &mut World, ticks: u32) {
        for _ in 0..ticks {
            world.step();
        }
    }

    fn weapon(world: &World, id: &str) -> WeaponDef {
        world
            .rules
            .weapons
            .iter()
            .find(|w| w.id == id)
            .unwrap()
            .clone()
    }

    #[test]
    fn riders_fill_a_piece_then_overflow_to_the_connected_one() {
        let mut world = ground();
        let first = piece(&mut world, 40, 40, 0);
        let second = piece(&mut world, 42, 40, 0);
        let far = piece(&mut world, 36, 44, 0);
        let units: Vec<EntityId> = (0..4)
            .map(|i| soldier(&mut world, "ua-rifleman", 0, 4000 + 40 * i, 4350))
            .collect();
        garrison(&mut world, 0, &units, first);
        run(&mut world, 200);
        assert_eq!(world.occupants(first).len(), 3);
        assert_eq!(world.occupants(second).len(), 1);
        assert!(world.occupants(far).is_empty(), "not connected");
        // Slots sit at 1/6, 3/6 and 5/6 of the piece on its centre line.
        let mut xs: Vec<i32> = world
            .occupants(first)
            .iter()
            .map(|&id| world.entity(id).unwrap().pos.x.raw())
            .collect();
        xs.sort_unstable();
        let expected: Vec<i32> = [4033, 4100, 4166]
            .iter()
            .map(|&c| fx_centi(c).raw())
            .collect();
        assert_eq!(xs, expected);
        let y = world.entity(units[0]).unwrap().pos.y;
        assert_eq!(y, fx_centi(4050));
    }

    #[test]
    fn only_a_finished_trench_takes_riders() {
        let mut world = ground();
        let index = piece(&mut world, 40, 40, 0);
        world.features[index as usize].hp = 150;
        let unit = soldier(&mut world, "ua-rifleman", 0, 4000, 4300);
        assert!(!world.can_garrison(unit, index));
        world.features[index as usize].hp = 300;
        assert!(world.can_garrison(unit, index));
        let tank = soldier(&mut world, "ua-leopard-2a4", 0, 4500, 4300);
        assert!(!world.can_garrison(tank, index));
    }

    #[test]
    fn occupants_stay_visible_to_the_enemy() {
        let mut world = ground();
        let index = piece(&mut world, 40, 40, 0);
        let unit = soldier(&mut world, "ua-rifleman", 0, 4000, 4300);
        garrison(&mut world, 0, &[unit], index);
        let watcher = soldier(&mut world, "ru-rifleman", 1, 4000, 4450);
        run(&mut world, 90);
        assert_eq!(world.entity(unit).unwrap().inside, Some(index));
        world.refresh_visibility();
        let snapshot = encode_match_snapshot(&world, 1);
        let rows = snapshot[7] as usize;
        let listed: Vec<(i32, i32)> = (0..rows)
            .map(|i| (snapshot[8 + i * 11], snapshot[8 + i * 11 + 6]))
            .collect();
        assert!(listed.iter().any(|&(id, _)| id == watcher as i32));
        let seen = listed.iter().find(|&&(id, _)| id == unit as i32);
        assert_eq!(
            seen.map(|&(_, flags)| flags & FLAG_INSIDE),
            Some(FLAG_INSIDE)
        );
    }

    #[test]
    fn a_rifle_grazes_one_occupant_and_leaves_the_trench() {
        let mut world = ground();
        let index = piece(&mut world, 40, 40, 0);
        let units: Vec<EntityId> = (0..2)
            .map(|i| soldier(&mut world, "ua-rifleman", 0, 4000 + 40 * i, 4300))
            .collect();
        garrison(&mut world, 0, &units, index);
        run(&mut world, 90);
        let rifle = weapon(&world, "ru-ak74");
        let centre = world.feature_center(index).unwrap();
        world.hit_features(centre, &rifle);
        let hp = |world: &World, id| world.entity(id).unwrap().hp;
        assert_eq!(hp(&world, units[0]), 100 - 1, "10 percent of 9, at least 1");
        assert_eq!(hp(&world, units[1]), 100);
        assert_eq!(world.features[index as usize].hp, 300);
        let mut big = rifle.clone();
        big.damage = 50;
        world.hit_features(centre, &big);
        assert_eq!(hp(&world, units[0]), 100 - 1 - 5);
    }

    #[test]
    fn high_explosives_break_the_trench_and_hurt_only_the_exposed() {
        let mut world = ground();
        let index = piece(&mut world, 40, 40, 1);
        let units: Vec<EntityId> = (0..3)
            .map(|i| soldier(&mut world, "ua-rifleman", 0, 4000 + 40 * i, 4300))
            .collect();
        garrison(&mut world, 0, &units, index);
        run(&mut world, 90);
        assert_eq!(world.occupants(index).len(), 3);
        let he = weapon(&world, "ua-gmlrs");
        let centre = world.feature_center(index).unwrap();
        // Rifle fire on a covered piece hurts the one exposed soldier only.
        let rifle = weapon(&world, "ru-ak74");
        world.hit_features(centre, &rifle);
        let hp = |world: &World, id| world.entity(id).unwrap().hp;
        assert_eq!((hp(&world, units[0]), hp(&world, units[1])), (100, 100));
        assert_eq!(hp(&world, units[2]), 99);
        // 125 + 125 wear it to 50; the third salvo breaks it with 75 over.
        world.hit_features(centre, &he);
        world.hit_features(centre, &he);
        assert_eq!(world.features[index as usize].hp, 50);
        assert_eq!(world.occupants(index).len(), 3, "still held");
        world.hit_features(centre, &he);
        assert!(!world.features[index as usize].alive);
        assert!(world.occupants(index).is_empty(), "put out of the wreck");
        assert_eq!((hp(&world, units[0]), hp(&world, units[1])), (100, 100));
        assert_eq!(hp(&world, units[2]), 99 - 75);
        let cells: Vec<Cell> = units
            .iter()
            .map(|&id| cell_of(world.entity(id).unwrap().pos))
            .collect();
        assert!(cells.iter().all(|&c| world.nav.is_passable(c)));
    }

    #[test]
    fn a_broken_empty_trench_dies_too() {
        let mut world = ground();
        let index = piece(&mut world, 40, 40, 0);
        let he = weapon(&world, "ua-gmlrs");
        let centre = world.feature_center(index).unwrap();
        for _ in 0..3 {
            world.hit_features(centre, &he);
        }
        assert!(!world.features[index as usize].alive);
    }

    #[test]
    fn opposing_squads_advance_along_the_line_and_fight_with_sidearms() {
        let mut world = ground();
        let line: Vec<u32> = (0..5)
            .map(|i| piece(&mut world, 36 + 2 * i, 40, 0))
            .collect();
        let stugna = soldier(&mut world, "ua-stugna-team", 0, 3700, 4300);
        let foe = soldier(&mut world, "ru-rifleman", 1, 4500, 4300);
        garrison(&mut world, 0, &[stugna], line[0]);
        garrison(&mut world, 1, &[foe], line[4]);
        run(&mut world, 40);
        assert!(world.entity(stugna).unwrap().inside.is_some());
        assert!(world.entity(foe).unwrap().inside.is_some());
        let mut met = None;
        for _ in 0..600 {
            world.step();
            let at = |id| world.entity(id).and_then(|e| e.inside);
            if let (Some(a), Some(b)) = (at(stugna), at(foe))
                && world.trench_touching(a, b)
            {
                met = Some((a, b));
                break;
            }
        }
        let (a, b) = met.expect("the squads meet");
        assert!(a > line[0] && b < line[4], "both closed in: {a} {b}");
        run(&mut world, 60);
        let shot = world.entity(foe).and_then(|e| e.last_hit);
        let shot = shot.map(|(by, id)| (by, world.rules.weapons[usize::from(id)].id.clone()));
        assert_eq!(shot, Some((stugna, "ua-sidearm".to_string())));
        let rifle_hit = world.entity(stugna).and_then(|e| e.last_hit);
        assert_eq!(rifle_hit.map(|(by, _)| by), Some(foe));
    }

    #[test]
    fn unload_puts_the_occupants_out_off_the_trench() {
        let mut world = ground();
        let index = piece(&mut world, 40, 40, 0);
        let units: Vec<EntityId> = (0..3)
            .map(|i| soldier(&mut world, "ua-rifleman", 0, 4000 + 40 * i, 4300))
            .collect();
        garrison(&mut world, 0, &units, index);
        run(&mut world, 120);
        assert_eq!(world.occupants(index).len(), 3);
        world.enqueue_as(0, Command::Unload { feature: index });
        run(&mut world, 1);
        assert!(world.occupants(index).is_empty());
        let cells: std::collections::BTreeSet<Cell> = units
            .iter()
            .map(|&id| cell_of(world.entity(id).unwrap().pos))
            .collect();
        assert_eq!(cells.len(), 3);
        assert!(
            units
                .iter()
                .all(|&id| matches!(world.entity(id).unwrap().order, Order::Idle { .. }))
        );
        // They climb out: none is left standing on the trench.
        assert!(!cells.contains(&Cell { x: 40, y: 40 }) && !cells.contains(&Cell { x: 41, y: 40 }));
    }

    #[test]
    fn occupants_survive_a_save() {
        let mut world = ground();
        let index = piece(&mut world, 40, 40, 1);
        let units: Vec<EntityId> = (0..2)
            .map(|i| soldier(&mut world, "ua-rifleman", 0, 4000 + 40 * i, 4300))
            .collect();
        let before = state_hash(&world);
        garrison(&mut world, 0, &units, index);
        run(&mut world, 120);
        let after = state_hash(&world);
        assert_ne!(before, after);
        let saved = save_state(&world, 3, &[]).unwrap();
        let (loaded, _, _) = load_state(&saved).unwrap();
        assert_eq!(loaded.occupants(index), units);
        for &id in &units {
            assert_eq!(
                loaded.entity(id).unwrap().pos,
                world.entity(id).unwrap().pos
            );
        }
        assert_eq!(state_hash(&loaded), after);
    }
}
