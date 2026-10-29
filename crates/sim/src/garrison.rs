//! Spec 31 block 2: infantry garrison civilian buildings (Zero Hour
//! `GarrisonContain`). A garrisoned unit stays in `World::entities` with
//! `inside = Some(feature index)`: it is hidden, cannot be targeted or moved,
//! and fires from the building centre with the building's range and damage
//! bonus. A neutral building takes the team of its riders and reverts to
//! neutral when emptied (the owner is derived from the occupants, so nothing
//! else is stored or hashed).

use std::collections::{BTreeMap, BTreeSet};

use crate::entity::{EntityId, NEUTRAL, Order, PlayerId};
use crate::features::footprint;
use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, cell_center, cell_of};
use crate::nav::{footprint_center, footprint_distance};
use crate::rules::{Category, GarrisonDef, LocoKind, WeaponDef, fx_centi};
use crate::world::{Layer, World};

/// How close (centi-tiles from the footprint edge) a unit must be to enter.
const ENTER_RANGE_CENTI: u32 = 150;
/// How many rings around the footprint an eviction searches for free cells.
const EVICT_RINGS: i32 = 3;

impl World {
    /// Garrison data of feature `index` while it is standing.
    pub fn garrison_def(&self, index: u32) -> Option<GarrisonDef> {
        let row = self.features.get(index as usize)?;
        if !row.alive {
            return None;
        }
        self.rules.feature_types[row.kind as usize].garrison
    }

    /// Ids of the units inside feature `index`, ascending.
    pub fn occupants(&self, index: u32) -> Vec<EntityId> {
        self.entities
            .iter()
            .filter(|entity| entity.inside == Some(index))
            .map(|entity| entity.id)
            .collect()
    }

    /// Team of a garrisoned feature: its lowest-id occupant's owner, `NEUTRAL`
    /// when empty (Difference 4: no capture progress, only occupancy).
    pub fn feature_owner(&self, index: u32) -> PlayerId {
        self.entities
            .iter()
            .find(|entity| entity.inside == Some(index))
            .map_or(NEUTRAL, |entity| entity.owner)
    }

    /// The rider half of Zero Hour's entry rules: a free, living infantry unit
    /// of a player.
    fn can_ride(&self, unit: EntityId) -> bool {
        let Some(entity) = self.entity(unit) else {
            return false;
        };
        entity.hp > 0
            && entity.site.is_none()
            && !entity.contained()
            && entity.owner != NEUTRAL
            && self.rules.ty(entity.kind).category == Category::Unit
            && self.rules.ty(entity.kind).motion.kind == LocoKind::Foot
    }

    /// The building half (`GarrisonContain::isValidContainerFor`): standing,
    /// not really damaged (a trench must be finished), with a free slot (less
    /// `pending` riders already on their way) and an occupancy that allows
    /// `owner`.
    pub(crate) fn piece_accepts(&self, owner: PlayerId, feature: u32, pending: u32) -> bool {
        let Some(def) = self.garrison_def(feature) else {
            return false;
        };
        let row = &self.features[feature as usize];
        let ty = &self.rules.feature_types[row.kind as usize];
        if row.state >= 2 || (ty.hp > 0 && row.hp == 0) {
            return false;
        }
        if ty.trench.is_some() && row.hp < ty.hp {
            return false;
        }
        let inside = self.occupants(feature);
        if inside.len() as u32 + pending >= def.slots {
            return false;
        }
        if inside.is_empty() {
            def.allow_neutral
        } else {
            self.feature_owner(feature) == owner || def.allow_enemies
        }
    }

    /// Zero Hour entry rules (`canEnterObject`, `GarrisonContain::isValidContainerFor`):
    /// the rider is a free infantry unit, the building is standing, not
    /// really damaged, has a free slot and its occupancy allows the rider. A
    /// trench takes the rider when any piece of its network does (spec 35 §5c).
    pub fn can_garrison(&self, unit: EntityId, feature: u32) -> bool {
        if !self.can_ride(unit) {
            return false;
        }
        let Some(owner) = self.entity(unit).map(|entity| entity.owner) else {
            return false;
        };
        if self.trench_def(feature).is_some() {
            self.trench_entry_piece(owner, feature, &BTreeMap::new())
                .is_some()
        } else {
            self.piece_accepts(owner, feature, 0)
        }
    }

    /// `Garrison` command: every listed unit of `player` that could enter walks
    /// to the building and enters it.
    pub(crate) fn apply_garrison(&mut self, player: PlayerId, units: &[EntityId], feature: u32) {
        if self.garrison_def(feature).is_none() {
            return;
        }
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        // Riders a trench piece cannot hold go to the nearest connected piece
        // with room (spec 35 §5c); `pending` counts those already assigned.
        let mut pending: BTreeMap<u32, u32> = BTreeMap::new();
        let trench = self.trench_def(feature).is_some();
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            if self.entities[index].owner != player || !self.can_ride(id) {
                continue;
            }
            let target = if trench {
                self.trench_entry_piece(player, feature, &pending)
            } else {
                self.piece_accepts(player, feature, 0).then_some(feature)
            };
            if let Some(target) = target {
                *pending.entry(target).or_insert(0) += 1;
                self.entities[index].order = Order::Garrison {
                    order_id,
                    feature: target,
                };
            }
        }
    }

    /// `Unload` command: the owner of the building evacuates it.
    pub(crate) fn apply_unload(&mut self, player: PlayerId, feature: u32) {
        if self.feature_owner(feature) == player && player != NEUTRAL {
            let row = self.features[feature as usize];
            let size = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
            self.evict_feature(feature, false, size);
        }
    }

    /// `Garrison` order step: walk toward the building, enter once close.
    pub(crate) fn step_garrison(&mut self, index: usize, order_id: u32, feature: u32) {
        let id = self.entities[index].id;
        let mut feature = feature;
        // A trench piece that filled up while the rider walked: next one on.
        if self.trench_def(feature).is_some()
            && !self.piece_accepts(self.entities[index].owner, feature, 0)
            && let Some(next) =
                self.trench_entry_piece(self.entities[index].owner, feature, &BTreeMap::new())
        {
            feature = next;
            self.entities[index].order = Order::Garrison { order_id, feature };
        }
        if !self.can_garrison(id, feature) {
            self.entities[index].order = Order::Idle {
                last_order_id: order_id,
            };
            return;
        }
        let row = self.features[feature as usize];
        let (w, h) = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
        let size = [w as u16, h as u16];
        let origin = Cell { x: row.x, y: row.y };
        let pos = self.entities[index].pos;
        if footprint_distance(pos, origin, size) <= fx_centi(ENTER_RANGE_CENTI) {
            let pos = if self.trench_def(feature).is_some() {
                self.trench_free_slot_point(feature)
            } else {
                footprint_center(origin, size)
            };
            let entity = &mut self.entities[index];
            entity.inside = Some(feature);
            entity.pos = pos;
            entity.speed = Fx::ZERO;
            entity.reversing = false;
            entity.order = Order::Idle {
                last_order_id: order_id,
            };
            return;
        }
        if let Some(goal) = self.garrison_goal(pos, feature) {
            self.step_toward_goal(index, goal);
        }
    }

    /// Where a unit at `pos` walks to enter `feature`: the passable cell
    /// nearest to the footprint cell closest to it, i.e. the side of the
    /// building the unit is already on.
    pub(crate) fn garrison_goal(&self, pos: FxVec2, feature: u32) -> Option<Cell> {
        let row = self.features.get(feature as usize)?;
        let (w, h) = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
        let here = cell_of(pos);
        let inner = Cell {
            x: here.x.clamp(row.x, row.x + w - 1),
            y: here.y.clamp(row.y, row.y + h - 1),
        };
        self.grid(Layer::Foot).nearest_passable(inner)
    }

    /// Takes every occupant out of `feature` onto free cells around its
    /// footprint. An occupant with no free cell stays inside, unless the
    /// building is `destroyed`, when it dies (`OpenContain::onDie`).
    ///
    /// `(w, h)` is the footprint the occupants were in: a destroyed building may
    /// already be another type by now.
    pub(crate) fn evict_feature(&mut self, feature: u32, destroyed: bool, (w, h): (i32, i32)) {
        let row = self.features[feature as usize];
        let mut used: BTreeSet<Cell> = BTreeSet::new();
        // Soldiers leaving a trench climb out onto the ground around it, off
        // every trench; only with no room there do they stay on its cells, and
        // a destroyed one leaves them on its cells (spec 35 §5c).
        let trench = self.rules.feature_types[row.kind as usize].trench.is_some();
        let own: Vec<Cell> = if trench {
            (row.y..row.y + h)
                .flat_map(|y| (row.x..row.x + w).map(move |x| Cell { x, y }))
                .collect()
        } else {
            Vec::new()
        };
        for index in 0..self.entities.len() {
            if self.entities[index].inside != Some(feature) {
                continue;
            }
            let on_own = || own.iter().copied().find(|cell| !used.contains(cell));
            let spot = if trench && !destroyed {
                self.free_cell_off_trenches(row.x, row.y, w, h, &used)
                    .or_else(on_own)
            } else {
                on_own().or_else(|| self.free_cell_around(row.x, row.y, w, h, &used))
            };
            match spot {
                Some(cell) => {
                    used.insert(cell);
                    let entity = &mut self.entities[index];
                    entity.inside = None;
                    entity.pos = cell_center(cell);
                    entity.order = Order::Idle { last_order_id: 0 };
                }
                None if destroyed => {
                    let entity = &mut self.entities[index];
                    entity.inside = None;
                    entity.hp = 0;
                }
                None => {}
            }
        }
    }

    /// As `free_cell_around`, skipping cells of any trench.
    fn free_cell_off_trenches(
        &self,
        ox: i32,
        oy: i32,
        w: i32,
        h: i32,
        used: &BTreeSet<Cell>,
    ) -> Option<Cell> {
        let mut taken = used.clone();
        for ring in 1..=EVICT_RINGS {
            for y in (oy - ring)..(oy + h + ring) {
                for x in (ox - ring)..(ox + w + ring) {
                    let cell = Cell { x, y };
                    let trench = self.feature_at(cell).is_some_and(|index| {
                        let row = &self.features[index as usize];
                        self.rules.feature_types[row.kind as usize].trench.is_some()
                    });
                    if trench {
                        taken.insert(cell);
                    }
                }
            }
        }
        self.free_cell_around(ox, oy, w, h, &taken)
    }

    /// First passable, unused cell in the rings around the rectangle, scanning
    /// each ring in ascending `(y, x)` order.
    pub(crate) fn free_cell_around(
        &self,
        ox: i32,
        oy: i32,
        w: i32,
        h: i32,
        used: &BTreeSet<Cell>,
    ) -> Option<Cell> {
        for ring in 1..=EVICT_RINGS {
            for y in (oy - ring)..(oy + h + ring) {
                for x in (ox - ring)..(ox + w + ring) {
                    let on_ring = x == ox - ring
                        || x == ox + w + ring - 1
                        || y == oy - ring
                        || y == oy + h + ring - 1;
                    let cell = Cell { x, y };
                    let nav = self.grid(Layer::Foot);
                    if on_ring
                        && nav.in_bounds(cell)
                        && nav.is_passable(cell)
                        && !used.contains(&cell)
                    {
                        return Some(cell);
                    }
                }
            }
        }
        None
    }

    /// The weapon of `shooter` with the garrison bonus when it fires from a
    /// building (Zero Hour `GarrisonContain` weapon bonus: range and damage).
    pub(crate) fn garrison_weapon(&self, shooter: EntityId, weapon: WeaponDef) -> WeaponDef {
        let Some(feature) = self.entity(shooter).and_then(|entity| entity.inside) else {
            return weapon;
        };
        let Some(def) = self.garrison_def(feature) else {
            return weapon;
        };
        let scale = |value: u32, pct: u32| (u64::from(value) * u64::from(pct) / 100) as u32;
        WeaponDef {
            range_centi: scale(weapon.range_centi, def.range_pct),
            damage: scale(weapon.damage, def.damage_pct).max(1),
            ..weapon
        }
    }

    /// Buildings held by a player, `(feature, holder)` in ascending feature
    /// order: the holder is the first occupant's owner, as `feature_owner`.
    pub(crate) fn held_buildings(&self) -> Vec<(u32, PlayerId)> {
        let mut held: Vec<(u32, PlayerId)> = Vec::new();
        for entity in &self.entities {
            if let Some(feature) = entity.inside
                && !held.iter().any(|&(f, _)| f == feature)
            {
                held.push((feature, entity.owner));
            }
        }
        held.sort_unstable_by_key(|&(feature, _)| feature);
        held
    }

    /// Zero Hour `PartitionFilterRejectBuildings`: a building garrisoned by
    /// another player is an enemy the shooter at `index` picks on its own;
    /// an empty one never is. Returns the point to fire at (the footprint cell
    /// nearest the shooter) of the nearest such building it sees and reaches
    /// with `weapon`. The shot damages the building, not the occupants
    /// (`GarrisonContain::onDamage` is empty).
    pub(crate) fn held_building_target(
        &self,
        index: usize,
        weapon: &WeaponDef,
        held: &[(u32, PlayerId)],
    ) -> Option<FxVec2> {
        let attacker = &self.entities[index];
        if attacker.owner == NEUTRAL || weapon.damage == 0 {
            return None;
        }
        let here = cell_of(attacker.pos);
        let mut best: Option<(Fx, FxVec2)> = None;
        for &(feature, holder) in held {
            if holder == attacker.owner || Some(feature) == attacker.inside {
                continue;
            }
            let row = &self.features[feature as usize];
            if !row.alive || row.collapse > 0 {
                continue;
            }
            let (w, h) = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
            let cell = Cell {
                x: here.x.clamp(row.x, row.x + w - 1),
                y: here.y.clamp(row.y, row.y + h - 1),
            };
            if self.fog(attacker.owner, cell) != 2 {
                continue;
            }
            let point = cell_center(cell);
            let distance = (point - attacker.pos).length();
            let range = self.effective_range(fx_centi(weapon.range_centi), attacker.pos, point);
            if distance < fx_centi(weapon.min_range_centi) || distance > range {
                continue;
            }
            if best.is_none_or(|(nearest, _)| distance < nearest) {
                best = Some((distance, point));
            }
        }
        best.map(|(_, point)| point)
    }

    /// Centre of feature `index`'s footprint.
    pub fn feature_center(&self, index: u32) -> Option<FxVec2> {
        let row = self.features.get(index as usize)?;
        let (w, h) = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
        Some(footprint_center(
            Cell { x: row.x, y: row.y },
            [w as u16, h as u16],
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::state_hash;
    use crate::rules::{FeatureDestroy, Ruleset};
    use crate::save::{load_state, save_state};
    use crate::snapshot::{FLAG_INSIDE, encode_match_snapshot};
    use crate::world::Command;

    /// Apartment block of `demo-town` at (15, 23), 3x3, holding 10.
    const BLOCK: Cell = Cell { x: 15, y: 23 };

    fn town(damageable: bool) -> (World, u32) {
        let mut rules = Ruleset::builtin();
        if damageable {
            for ty in &mut rules.feature_types {
                if ty.garrison.is_some() {
                    ty.hp = 100;
                    ty.destroy = None::<FeatureDestroy>;
                }
            }
        }
        let mut world = World::skirmish_with(rules, "demo-town", false).unwrap();
        world.victory_enabled = false;
        let feature = world.feature_at(BLOCK).expect("apartment block");
        (world, feature)
    }

    fn at(x: u32, y: u32) -> FxVec2 {
        FxVec2::new(fx_centi(x), fx_centi(y))
    }

    fn rifleman(world: &mut World, owner: PlayerId, x: u32, y: u32) -> EntityId {
        let kind = world.rules.type_index("ua-rifleman").unwrap();
        world.spawn(owner, kind, at(x, y))
    }

    fn run(world: &mut World, ticks: u32) {
        for _ in 0..ticks {
            world.step();
        }
    }

    #[test]
    fn infantry_walk_in_and_the_building_takes_their_team() {
        let (mut world, feature) = town(false);
        assert_eq!(world.feature_owner(feature), NEUTRAL);
        let a = rifleman(&mut world, 0, 1650, 2750);
        let b = rifleman(&mut world, 0, 1750, 2750);
        world.enqueue_as(
            0,
            Command::Garrison {
                units: vec![a, b],
                feature,
            },
        );
        run(&mut world, 150);
        assert_eq!(world.occupants(feature), vec![a, b]);
        assert_eq!(world.feature_owner(feature), 0);
        let inside = world.entity(a).unwrap();
        assert_eq!(inside.inside, Some(feature));
        assert!(matches!(inside.order, Order::Idle { .. }));

        // Evacuate: out on passable cells, building neutral again.
        world.enqueue_as(0, Command::Unload { feature });
        run(&mut world, 1);
        assert!(world.occupants(feature).is_empty());
        assert_eq!(world.feature_owner(feature), NEUTRAL);
        let out = world.entity(a).unwrap();
        assert!(world.nav.is_passable(cell_of(out.pos)));
    }

    #[test]
    fn entry_rules_follow_zero_hour() {
        let (mut world, feature) = town(false);
        let mine = rifleman(&mut world, 0, 1650, 2650);
        let foe = rifleman(&mut world, 1, 1600, 2650);
        let tank = world.spawn(
            0,
            world.rules.type_index("ua-leopard-2a4").unwrap(),
            at(1450, 2750),
        );
        assert!(world.can_garrison(mine, feature));
        assert!(
            !world.can_garrison(tank, feature),
            "vehicles never garrison"
        );
        let hq = world
            .entities
            .iter()
            .find(|e| e.site.is_some())
            .map(|e| e.id);
        if let Some(hq) = hq {
            assert!(
                !world.can_garrison(hq, feature),
                "structures never garrison"
            );
        }
        // Not a garrisonable feature: a lamp post.
        let plain = world
            .features()
            .iter()
            .position(|row| {
                world.rules.feature_types[row.kind as usize]
                    .garrison
                    .is_none()
            })
            .unwrap() as u32;
        assert!(!world.can_garrison(mine, plain));

        world.enqueue_as(
            0,
            Command::Garrison {
                units: vec![mine],
                feature,
            },
        );
        run(&mut world, 120);
        assert_eq!(world.feature_owner(feature), 0);
        assert!(
            !world.can_garrison(foe, feature),
            "enemy cannot join a held building"
        );
    }

    #[test]
    fn capacity_limits_the_riders() {
        let (mut world, feature) = town(false);
        let slots = world.garrison_def(feature).unwrap().slots;
        let units: Vec<EntityId> = (0..slots + 2)
            .map(|i| rifleman(&mut world, 0, 1500 + 40 * i, 2650))
            .collect();
        for &unit in &units {
            world.enqueue_as(
                0,
                Command::Garrison {
                    units: vec![unit],
                    feature,
                },
            );
        }
        run(&mut world, 240);
        assert_eq!(world.occupants(feature).len() as u32, slots);
    }

    #[test]
    fn occupants_are_hidden_and_untouchable() {
        let (mut world, feature) = town(false);
        let mine = rifleman(&mut world, 0, 1650, 2650);
        world.enqueue_as(
            0,
            Command::Garrison {
                units: vec![mine],
                feature,
            },
        );
        run(&mut world, 90);
        assert_eq!(world.entity(mine).unwrap().inside, Some(feature));
        let hp = world.entity(mine).unwrap().hp;
        for i in 0..4 {
            rifleman(&mut world, 1, 1500 + 60 * i, 2900);
        }
        // Header of 7 values, the row count, then 11 values per row.
        let listed = |viewer: PlayerId| {
            let snapshot = encode_match_snapshot(&world, viewer);
            let rows = snapshot[7] as usize;
            (0..rows)
                .map(|i| (snapshot[8 + i * 11], snapshot[8 + i * 11 + 6]))
                .collect::<Vec<_>>()
        };
        // The owner sees its unit flagged inside; the enemy sees no row for it.
        assert!(listed(0).contains(&(mine as i32, FLAG_INSIDE)));
        assert!(listed(1).iter().all(|&(id, _)| id != mine as i32));
        assert!(
            listed(NEUTRAL).contains(&(mine as i32, FLAG_INSIDE)),
            "revealed view"
        );
        run(&mut world, 120);
        assert_eq!(world.entity(mine).unwrap().hp, hp, "no shot can hit it");
    }

    #[test]
    fn occupants_fire_with_the_window_bonus() {
        let (mut world, feature) = town(false);
        let mine = rifleman(&mut world, 0, 1650, 2650);
        let base = world
            .rules
            .weapon_of(world.entity(mine).unwrap().kind)
            .unwrap()
            .clone();
        assert_eq!(world.garrison_weapon(mine, base.clone()), base);
        world.enqueue_as(
            0,
            Command::Garrison {
                units: vec![mine],
                feature,
            },
        );
        run(&mut world, 90);
        let boosted = world.garrison_weapon(mine, base.clone());
        assert_eq!(boosted.range_centi, base.range_centi * 133 / 100);
        assert_eq!(boosted.damage, base.damage * 125 / 100);
        // A foe 5.5 tiles from the centre is beyond a normal rifle but not a garrisoned one.
        let foe = rifleman(&mut world, 1, 1650, 2400 + 600);
        let hp = world.entity(foe).unwrap().hp;
        run(&mut world, 60);
        assert!(world.entity(foe).is_none_or(|e| e.hp < hp));
    }

    #[test]
    fn wrecked_buildings_eject_and_destroyed_ones_kill_the_trapped() {
        let (mut world, feature) = town(true);
        let units: Vec<EntityId> = (0..3)
            .map(|i| rifleman(&mut world, 0, 1550 + 80 * i, 2650))
            .collect();
        world.enqueue_as(
            0,
            Command::Garrison {
                units: units.clone(),
                feature,
            },
        );
        run(&mut world, 120);
        assert_eq!(world.occupants(feature).len(), 3);

        assert!(world.damage_feature(feature as usize, 40));
        assert_eq!(world.features()[feature as usize].state, 1);
        assert_eq!(world.occupants(feature).len(), 3, "damaged still holds");
        assert!(world.damage_feature(feature as usize, 30));
        assert_eq!(world.features()[feature as usize].state, 2);
        assert!(world.occupants(feature).is_empty(), "wrecked ejects");
        assert_eq!(world.feature_owner(feature), NEUTRAL);
        let cells: BTreeSet<Cell> = units
            .iter()
            .map(|&id| cell_of(world.entity(id).unwrap().pos))
            .collect();
        assert_eq!(cells.len(), 3, "each on its own free cell");
        assert!(cells.iter().all(|&c| world.nav.is_passable(c)));
        assert!(
            !world.can_garrison(units[0], feature),
            "a wrecked building takes no riders"
        );

        // Destroyed with no room around: the trapped die.
        let (mut world, feature) = town(true);
        let mut def =
            world.rules.feature_types[world.features[feature as usize].kind as usize].clone();
        def.garrison.as_mut().unwrap().evict_on_wrecked = false;
        let kind = world.features[feature as usize].kind as usize;
        world.rules.feature_types[kind] = def;
        let unit = rifleman(&mut world, 0, 1650, 2650);
        world.enqueue_as(
            0,
            Command::Garrison {
                units: vec![unit],
                feature,
            },
        );
        run(&mut world, 90);
        assert_eq!(world.occupants(feature), vec![unit]);
        for y in 19..30 {
            for x in 11..22 {
                let cell = Cell { x, y };
                let inside = (15..18).contains(&x) && (23..26).contains(&y);
                if !inside {
                    world.terrain_base.set_blocked(cell, true);
                }
            }
        }
        world.refresh_feature_blocks();
        assert!(world.damage_feature(feature as usize, 1000));
        assert_eq!(world.entity(unit).unwrap().hp, 0);
        assert_eq!(world.entity(unit).unwrap().inside, None);
    }

    #[test]
    fn a_collapsing_building_empties_before_it_turns_to_rubble() {
        // Real data: the apartment block collapses into rubble (spec 31 block 1).
        let (mut world, feature) = town(false);
        let kind = world.features[feature as usize].kind as usize;
        world.rules.feature_types[kind]
            .garrison
            .as_mut()
            .unwrap()
            .evict_on_wrecked = false;
        let units: Vec<EntityId> = (0..2)
            .map(|i| rifleman(&mut world, 0, 1550 + 80 * i, 2650))
            .collect();
        world.enqueue_as(
            0,
            Command::Garrison {
                units: units.clone(),
                feature,
            },
        );
        run(&mut world, 120);
        assert_eq!(world.occupants(feature).len(), 2);
        let hp = world.features[feature as usize].hp;
        assert!(world.damage_feature(feature as usize, hp));
        assert!(world.features[feature as usize].collapse > 0);
        assert!(
            world.occupants(feature).is_empty(),
            "the collapse throws them out"
        );
        assert!(units.iter().all(|&id| world.entity(id).unwrap().hp > 0));
        run(&mut world, 61);
        assert_ne!(world.features[feature as usize].kind as usize, kind);
        assert!(world.occupants(feature).is_empty());
    }

    #[test]
    fn the_feature_table_names_the_holder_of_a_building() {
        let (mut world, feature) = town(false);
        let foe = rifleman(&mut world, 1, 1650, 2650);
        world.enqueue_as(
            1,
            Command::Garrison {
                units: vec![foe],
                feature,
            },
        );
        run(&mut world, 120);
        let table = crate::snapshot::encode_features(&world);
        let base = 1 + feature as usize * crate::snapshot::FEATURE_STRIDE;
        assert_eq!(table[base], feature as i32);
        assert_eq!((table[base + 5], table[base + 6]), (1, 1));
        let empty = 1 + (feature as usize + 1) * crate::snapshot::FEATURE_STRIDE;
        assert_eq!(table[empty + 5], i32::from(NEUTRAL));
    }

    #[test]
    fn units_attack_an_enemy_held_building_on_their_own() {
        let (mut world, feature) = town(false);
        let foe = rifleman(&mut world, 1, 1650, 2650);
        world.enqueue_as(
            1,
            Command::Garrison {
                units: vec![foe],
                feature,
            },
        );
        run(&mut world, 120);
        assert_eq!(world.feature_owner(feature), 1);
        let foe_hp = world.entity(foe).unwrap().hp;
        let hp = world.features[feature as usize].hp;
        let empty = world.feature_at(Cell { x: 19, y: 24 }).expect("house");
        let empty_hp = world.features[empty as usize].hp;
        // A tank idle 4 tiles south of the block, out of the rifle's reach.
        world.spawn(
            0,
            world.rules.type_index("ua-leopard-2a4").unwrap(),
            at(1650, 3000),
        );
        world.refresh_visibility();
        run(&mut world, 200);
        assert!(
            world.features[feature as usize].hp < hp,
            "the held block is shelled"
        );
        assert_eq!(
            world.features[empty as usize].hp, empty_hp,
            "empty ones are not"
        );
        if let Some(rider) = world.entity(foe)
            && rider.inside.is_some()
        {
            assert_eq!(rider.hp, foe_hp, "occupants take no damage while inside");
        }
    }

    #[test]
    fn garrison_changes_the_hash_and_survives_a_save() {
        let (mut world, feature) = town(false);
        let unit = rifleman(&mut world, 0, 1650, 2650);
        let before = state_hash(&world);
        world.enqueue_as(
            0,
            Command::Garrison {
                units: vec![unit],
                feature,
            },
        );
        run(&mut world, 90);
        assert_eq!(world.entity(unit).unwrap().inside, Some(feature));
        let after = state_hash(&world);
        assert_ne!(before, after);
        let saved = save_state(&world, 7, &[]).unwrap();
        let (loaded, _, _) = load_state(&saved).unwrap();
        assert_eq!(loaded.entity(unit).unwrap().inside, Some(feature));
        assert_eq!(state_hash(&loaded), after);
        assert_eq!(loaded.feature_owner(feature), 0);
    }

    #[test]
    fn the_ai_garrisons_a_building_enemy_infantry_approach() {
        use crate::ai::garrison_orders_for_test;
        let (mut world, feature) = town(false);
        let defender = rifleman(&mut world, 0, 1650, 2750);
        rifleman(&mut world, 1, 1650, 2200);
        world.refresh_visibility();
        let commands = garrison_orders_for_test(&world, 0, 800);
        assert_eq!(
            commands,
            vec![Command::Garrison {
                units: vec![defender],
                feature
            }]
        );
        assert!(garrison_orders_for_test(&world, 0, 0).is_empty());
    }
}
