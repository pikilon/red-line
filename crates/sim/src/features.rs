//! Map features during a match (spec 31, base layer): hit points, damage
//! states, destruction into another feature type, and the blocking that
//! follows. Rows are created from the map in map order and never removed, so
//! a row's index is stable for saves, hashes and later snapshots.

use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, MapGrid, WATER_DEEP, WATER_DEPTH_MASK};
use crate::rng::SplitMix64;
use crate::rules::{
    FeatureBlocks, FeatureFlammable, FeatureInstanceDef, FeatureTypeDef, MapDef, Ruleset,
    WeaponDef, fx_centi,
};
use crate::world::World;

/// Feature family of the river bridges (spec 26 §17).
const BRIDGE_FAMILY: &str = "bridge";
/// Damage state at which a bridge is broken (spec 31 block 1).
const STATE_WRECKED: u8 = 2;

/// One feature as it is during a match.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeatureState {
    /// Index into `Ruleset::feature_types`; changes when the feature is destroyed
    /// into another type.
    pub kind: u32,
    pub x: i32,
    pub y: i32,
    pub rot: u8,
    pub variant: u32,
    /// 0 intact, 1 damaged, 2 wrecked; 3 (abandoned, placed by the map) is kept.
    pub state: u8,
    pub hp: u32,
    /// `false` once destroyed without a replacement type; the row stays.
    pub alive: bool,
    /// Bridges only: the last (bottom-right, inclusive) deck cell.
    pub to: Option<[i32; 2]>,
    /// Ticks of fire left; 0 when the feature is not burning (spec 31 block 1).
    pub burn: u32,
    /// Ticks until a building at zero hit points turns into rubble; 0 when it
    /// is not collapsing.
    pub collapse: u32,
}

impl FeatureState {
    /// The row of a map feature, at full hit points.
    fn from_map(rules: &Ruleset, instance: &FeatureInstanceDef) -> FeatureState {
        FeatureState {
            kind: instance.kind,
            x: instance.x,
            y: instance.y,
            rot: instance.rot,
            variant: instance.variant,
            state: instance.state,
            hp: rules.feature_types[instance.kind as usize].hp,
            alive: true,
            to: instance.to,
            burn: 0,
            collapse: 0,
        }
    }
}

/// The rows of `map`'s features, in map order.
pub fn from_map(rules: &Ruleset, map: &MapDef) -> Vec<FeatureState> {
    map.features
        .iter()
        .map(|instance| FeatureState::from_map(rules, instance))
        .collect()
}

/// Footprint `(width, height)` of a feature type turned `rot` quarter turns.
pub fn footprint(def: &FeatureTypeDef, rot: u8) -> (i32, i32) {
    if rot % 2 == 1 {
        (def.footprint[1], def.footprint[0])
    } else {
        (def.footprint[0], def.footprint[1])
    }
}

/// Inclusive cell rectangle `(x0, y0, x1, y1)` a feature covers: its footprint,
/// or the whole deck for a bridge.
pub fn extent(def: &FeatureTypeDef, row: &FeatureState) -> (i32, i32, i32, i32) {
    if let Some([tx, ty]) = row.to {
        return (row.x, row.y, tx, ty);
    }
    let (w, h) = footprint(def, row.rot);
    (row.x, row.y, row.x + w - 1, row.y + h - 1)
}

/// `true` when a bridge row can no longer be crossed over deep water.
fn bridge_broken(def: &FeatureTypeDef, row: &FeatureState) -> bool {
    def.family == BRIDGE_FAMILY && (!row.alive || row.state >= STATE_WRECKED)
}

/// `base` (terrain without features) plus the footprints of every living
/// feature that blocks movement, and the deep-water deck cells of every
/// broken bridge: the terrain vehicles drive on.
pub fn with_blocks(base: &MapGrid, features: &[FeatureState], rules: &Ruleset) -> MapGrid {
    blocks_for(base, features, rules, false, false)
}

/// Spec 31 A7: the terrain foot units walk on, `with_blocks` without the
/// footprints of `blocks: vehicles` features (rubble: Zero Hour's
/// `CELL_RUBBLE`, which infantry cross and vehicles do not). `None` while no
/// living feature blocks vehicles only, when it would equal `with_blocks`.
pub fn foot_blocks(base: &MapGrid, features: &[FeatureState], rules: &Ruleset) -> Option<MapGrid> {
    let split = features.iter().any(|row| {
        let def = &rules.feature_types[row.kind as usize];
        row.alive && def.blocks == FeatureBlocks::Vehicles && def.family != BRIDGE_FAMILY
    });
    split.then(|| blocks_for(base, features, rules, true, false))
}

/// Spec 36: the terrain amphibious vehicles drive on, `with_blocks` with deep
/// water open (a broken bridge does not stop them). `None` without deep water,
/// when it would equal `with_blocks`.
pub fn water_blocks(base: &MapGrid, features: &[FeatureState], rules: &Ruleset) -> Option<MapGrid> {
    base.has_deep_water()
        .then(|| blocks_for(&base.with_open_water(), features, rules, false, true))
}

/// `base` plus the blocking features; `foot` lets `blocks: vehicles` pass and
/// `amphibious` leaves broken bridge decks open (the water under them is).
fn blocks_for(
    base: &MapGrid,
    features: &[FeatureState],
    rules: &Ruleset,
    foot: bool,
    amphibious: bool,
) -> MapGrid {
    let mut terrain = base.clone();
    for row in features {
        let def = &rules.feature_types[row.kind as usize];
        if bridge_broken(def, row) {
            if amphibious {
                continue;
            }
            let (x0, y0, x1, y1) = extent(def, row);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let cell = Cell { x, y };
                    if base.water_at(cell) & WATER_DEPTH_MASK == WATER_DEEP {
                        terrain.set_blocked(cell, true);
                    }
                }
            }
            continue;
        }
        let passes =
            def.blocks == FeatureBlocks::None || (foot && def.blocks == FeatureBlocks::Vehicles);
        if !row.alive || passes {
            continue;
        }
        let (w, h) = footprint(def, row.rot);
        terrain.block_footprint(Cell { x: row.x, y: row.y }, w, h);
    }
    terrain
}

/// Chebyshev distance in cells between two cell rectangles; 1 when they touch.
fn rect_gap(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> i32 {
    let dx = (b.0 - a.2).max(a.0 - b.2).max(0);
    let dy = (b.1 - a.3).max(a.1 - b.3).max(0);
    dx.max(dy)
}

/// Distance from `pos` to the nearest point of the cell rectangle `rect`; zero
/// inside it.
pub fn distance_to_rect(pos: FxVec2, rect: (i32, i32, i32, i32)) -> Fx {
    let one = i64::from(Fx::from_int(1).raw());
    let clamp = |value: i32, lo: i32, hi: i32| -> i64 {
        i64::from(value).clamp(i64::from(lo) * one, (i64::from(hi) + 1) * one)
    };
    let nx = clamp(pos.x.raw(), rect.0, rect.2);
    let ny = clamp(pos.y.raw(), rect.1, rect.3);
    let near = FxVec2::new(Fx::from_raw(nx as i32), Fx::from_raw(ny as i32));
    (near - pos).length()
}

/// `true` when going from `old` to `new` can change which cells are blocked.
pub(crate) fn blocking_differs(rules: &Ruleset, old: &FeatureState, new: &FeatureState) -> bool {
    old.kind != new.kind
        || old.alive != new.alive
        || (new.state != old.state
            && rules.feature_types[new.kind as usize].family == BRIDGE_FAMILY)
}

/// Damage state of `hp` out of `max` under the type's thresholds: 2 when at
/// or below the wrecked threshold, 1 at or below the damaged one, else 0.
pub(crate) fn state_for(hp: u32, max: u32, damaged: u32, wrecked: u32) -> u8 {
    let percent = hp * 100 / max;
    if percent <= wrecked {
        2
    } else if percent <= damaged {
        1
    } else {
        0
    }
}

impl World {
    /// Spec 31: the rows of the map features, in map order.
    pub fn features(&self) -> &[FeatureState] {
        &self.features
    }

    /// Index of the living feature whose footprint covers `cell`.
    pub fn feature_at(&self, cell: Cell) -> Option<u32> {
        self.features
            .iter()
            .position(|row| {
                if !row.alive {
                    return false;
                }
                let (w, h) = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
                (row.x..row.x + w).contains(&cell.x) && (row.y..row.y + h).contains(&cell.y)
            })
            .map(|index| index as u32)
    }

    /// Spec 31: applies `amount` damage to feature `index`. Damage states only
    /// get worse. At zero hit points the feature becomes its `destroy` type at
    /// full hit points (after `collapseTicks`, when the type has them), or stops
    /// blocking when it has none. Returns `false` when the feature is missing,
    /// already gone, collapsing or cannot be damaged.
    pub fn damage_feature(&mut self, index: usize, amount: u32) -> bool {
        let Some(row) = self.features.get(index).copied() else {
            return false;
        };
        if !row.alive || row.collapse > 0 {
            return false;
        }
        let def = &self.rules.feature_types[row.kind as usize];
        if def.hp == 0 {
            return false;
        }
        let (max, states) = (def.hp, def.states);
        let destroy = def.destroy.clone();
        let hp = row.hp.saturating_sub(amount);

        let next = if hp == 0 {
            let replacement = destroy.as_ref().and_then(|d| self.feature_kind(&d.becomes));
            match (replacement, destroy) {
                (Some(_), Some(d)) if d.collapse_ticks > 0 => FeatureState {
                    hp: 0,
                    state: STATE_WRECKED,
                    collapse: d.collapse_ticks,
                    ..row
                },
                (Some(kind), _) => self.replaced(row, kind),
                (None, _) => FeatureState {
                    hp: 0,
                    alive: false,
                    burn: 0,
                    ..row
                },
            }
        } else {
            let computed = state_for(hp, max, states.damaged, states.wrecked);
            FeatureState {
                hp,
                state: row.state.max(computed),
                ..row
            }
        };
        if next == row {
            return false;
        }
        self.features[index] = next;
        if blocking_differs(&self.rules, &row, &next) {
            self.refresh_feature_blocks();
        }
        self.evict_if_unfit(index as u32, row);
        true
    }

    /// Spec 31 block 2: occupants leave a feature that was wrecked (when its
    /// type evicts) or destroyed; those with no room to leave die when it was
    /// destroyed. `before` is the row as it was, which gives the footprint.
    fn evict_if_unfit(&mut self, index: u32, before: FeatureState) {
        if !self.entities.iter().any(|e| e.inside == Some(index)) {
            return;
        }
        let after = self.features[index as usize];
        let destroyed = !after.alive || after.kind != before.kind || after.collapse > 0;
        let keeps = !destroyed
            && self
                .garrison_def(index)
                .is_some_and(|def| !(def.evict_on_wrecked && after.state >= 2));
        if !keeps {
            let size = footprint(&self.rules.feature_types[before.kind as usize], before.rot);
            self.evict_feature(index, destroyed, size);
        }
    }

    /// Index of the feature type `id`.
    fn feature_kind(&self, id: &str) -> Option<usize> {
        self.rules.feature_types.iter().position(|ty| ty.id == id)
    }

    /// `row` turned into feature type `kind` at full hit points, not burning.
    fn replaced(&self, row: FeatureState, kind: usize) -> FeatureState {
        FeatureState {
            kind: kind as u32,
            variant: 0,
            state: 0,
            hp: self.rules.feature_types[kind].hp,
            burn: 0,
            collapse: 0,
            ..row
        }
    }

    /// Spec 31 block 1: sets feature `index` on fire when its type burns.
    pub(crate) fn ignite_feature(&mut self, index: usize) {
        let row = self.features[index];
        let def = &self.rules.feature_types[row.kind as usize];
        if let Some(fire) = def.flammable
            && row.alive
            && row.hp > 0
            && row.burn == 0
        {
            self.features[index].burn = fire.burn_ticks;
        }
    }

    /// Spec 31 block 1: a shot landing at `impact` damages the features it
    /// covers (the footprint it lands in, or within the splash radius) and sets
    /// the flammable ones on fire.
    pub(crate) fn hit_features(&mut self, impact: FxVec2, weapon: &WeaponDef) {
        if self.features.is_empty() {
            return;
        }
        let reach = fx_centi(weapon.splash_centi);
        for index in 0..self.features.len() {
            let row = self.features[index];
            let def = &self.rules.feature_types[row.kind as usize];
            if !row.alive || def.hp == 0 || row.collapse > 0 {
                continue;
            }
            if distance_to_rect(impact, extent(def, &row)) > reach {
                continue;
            }
            self.damage_feature(index, weapon.damage);
            self.ignite_feature(index);
        }
    }

    /// Spec 31 block 1, after `run_over`: crushed features, fire and collapse.
    pub(crate) fn features_step(&mut self) {
        if self.features.is_empty() {
            return;
        }
        self.crush_features();
        self.burn_features();
        self.collapse_features();
    }

    /// Fire: a burning feature loses `dps` hit points every `everyTicks`, may
    /// light each flammable neighbour (one seeded roll per burning neighbour per
    /// tick) and burns out after `burnTicks`.
    fn burn_features(&mut self) {
        let tick = self.tick;
        let mut lit: Vec<usize> = Vec::new();
        for index in 0..self.features.len() {
            let row = self.features[index];
            if !row.alive || row.burn == 0 {
                continue;
            }
            let Some(fire) = self.rules.feature_types[row.kind as usize].flammable else {
                self.features[index].burn = 0;
                continue;
            };
            if tick.is_multiple_of(fire.every_ticks.max(1)) {
                self.damage_feature(index, fire.dps);
            }
            let row = self.features[index];
            if !row.alive || row.burn == 0 {
                continue;
            }
            self.spread_fire(index, fire, &mut lit);
            self.features[index].burn = row.burn - 1;
        }
        for index in lit {
            self.ignite_feature(index);
        }
    }

    /// Rolls the seeded chance that the fire at `from` lights each flammable
    /// neighbour within `spreadRadius`; pushes the ones it lights to `lit`.
    fn spread_fire(&self, from: usize, fire: FeatureFlammable, lit: &mut Vec<usize>) {
        let source = self.features[from];
        let source_rect = extent(&self.rules.feature_types[source.kind as usize], &source);
        for (to, row) in self.features.iter().enumerate() {
            let def = &self.rules.feature_types[row.kind as usize];
            let Some(neighbour) = def.flammable else {
                continue;
            };
            if to == from || !row.alive || row.burn > 0 || row.hp == 0 || lit.contains(&to) {
                continue;
            }
            if rect_gap(source_rect, extent(def, row)) > fire.spread_radius {
                continue;
            }
            let seed = (u64::from(self.tick) << 40) ^ ((from as u64) << 20) ^ to as u64;
            if SplitMix64::new(seed).next_u32() % 1000 < neighbour.spread_permille {
                lit.push(to);
            }
        }
    }

    /// Collapse: a building at zero hit points turns into its rubble when its
    /// timer runs out.
    fn collapse_features(&mut self) {
        let mut collapsed: Vec<(usize, FeatureState)> = Vec::new();
        for index in 0..self.features.len() {
            let row = self.features[index];
            if !row.alive || row.collapse == 0 {
                continue;
            }
            if row.collapse > 1 {
                self.features[index].collapse = row.collapse - 1;
                continue;
            }
            let becomes = self.rules.feature_types[row.kind as usize]
                .destroy
                .as_ref()
                .and_then(|destroy| self.feature_kind(&destroy.becomes));
            self.features[index] = match becomes {
                Some(kind) => self.replaced(row, kind),
                None => FeatureState {
                    alive: false,
                    collapse: 0,
                    ..row
                },
            };
            collapsed.push((index, row));
        }
        if collapsed.is_empty() {
            return;
        }
        self.refresh_feature_blocks();
        for (index, before) in collapsed {
            self.evict_if_unfit(index as u32, before);
        }
    }

    /// Recomputes `terrain` and `terrain_foot` from the base terrain and the
    /// living features, then rebuilds `nav` and `nav_foot` (which also clears
    /// the flow fields). Every change of blocking goes through here (spec 31
    /// §4.1).
    pub(crate) fn refresh_feature_blocks(&mut self) {
        self.terrain = with_blocks(&self.terrain_base, &self.features, &self.rules);
        self.terrain_foot = foot_blocks(&self.terrain_base, &self.features, &self.rules);
        self.terrain_water = water_blocks(&self.terrain_base, &self.features, &self.rules);
        self.rebuild_nav();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::state_hash;
    use crate::map::{Cell, MapGrid, WATER_DEEP, WATER_DEPTH_MASK, cell_of};
    use crate::rules::FeatureDestroy;
    use crate::save::{load_state, save_state};
    use crate::world::Layer;

    #[test]
    fn states_follow_the_thresholds() {
        assert_eq!(state_for(100, 100, 70, 35), 0);
        assert_eq!(state_for(70, 100, 70, 35), 1);
        assert_eq!(state_for(36, 100, 70, 35), 1);
        assert_eq!(state_for(35, 100, 70, 35), 2);
        assert_eq!(state_for(0, 100, 70, 35), 2);
    }

    /// `demo-town` with every feature type damageable (100 hp). Returns the
    /// world and the first feature that blocks movement.
    fn damageable_town(destroy: Option<&str>) -> (World, usize) {
        let mut rules = Ruleset::builtin();
        for ty in &mut rules.feature_types {
            ty.hp = 100;
            ty.destroy = destroy.map(|id| FeatureDestroy {
                becomes: id.to_owned(),
                collapse_ticks: 0,
            });
        }
        let world = World::skirmish_with(rules, "demo-town", false).unwrap();
        let index = world
            .features()
            .iter()
            .position(|row| {
                let ty = &world.rules.feature_types[row.kind as usize];
                ty.blocks == FeatureBlocks::All
            })
            .expect("demo-town has a blocking feature");
        (world, index)
    }

    fn origin(world: &World, index: usize) -> Cell {
        let row = world.features()[index];
        Cell { x: row.x, y: row.y }
    }

    #[test]
    fn damage_moves_through_the_states_and_destruction_unblocks() {
        let (mut world, index) = damageable_town(None);
        let cell = origin(&world, index);
        assert!(!world.terrain.is_passable(cell));

        assert!(world.damage_feature(index, 40));
        assert_eq!(world.features()[index].state, 1);
        assert!(world.damage_feature(index, 35));
        assert_eq!(world.features()[index].state, 2);
        assert!(world.features()[index].alive);

        assert!(world.damage_feature(index, 1000));
        assert!(!world.features()[index].alive);
        assert_eq!(world.features()[index].hp, 0);
        if world.terrain_base.is_passable(cell) {
            assert!(world.terrain.is_passable(cell));
            assert!(world.nav.is_passable(cell));
        }
        assert!(
            !world.damage_feature(index, 1),
            "a removed feature takes no damage"
        );
    }

    #[test]
    fn destruction_into_another_type_keeps_the_row() {
        let (mut world, index) = damageable_town(Some("rubble-pile"));
        let rubble = world
            .rules
            .feature_types
            .iter()
            .position(|ty| ty.id == "rubble-pile")
            .unwrap();
        assert!(world.damage_feature(index, 1000));
        let row = world.features()[index];
        assert!(row.alive);
        assert_eq!(row.kind as usize, rubble);
        assert_eq!((row.state, row.variant), (0, 0));
    }

    #[test]
    fn damage_changes_the_state_hash_and_survives_a_save() {
        let (mut world, index) = damageable_town(None);
        let before = state_hash(&world);
        assert!(world.damage_feature(index, 40));
        let after = state_hash(&world);
        assert_ne!(before, after);

        let saved = save_state(&world, 7, &[]).unwrap();
        let (loaded, _, _) = load_state(&saved).unwrap();
        assert_eq!(loaded.features(), world.features());
        assert_eq!(state_hash(&loaded), after);
        assert!(!loaded.terrain.is_passable(origin(&loaded, index)));
    }

    #[test]
    fn saves_without_feature_rows_load_from_the_map() {
        // Saves load with the builtin ruleset, so this world uses it too.
        let world = World::skirmish_with(Ruleset::builtin(), "demo-town", false).unwrap();
        let mut saved = save_state(&world, 7, &[]).unwrap();
        saved.features.clear();
        let (loaded, _, _) = load_state(&saved).unwrap();
        assert_eq!(loaded.features(), world.features());
        assert_eq!(state_hash(&loaded), state_hash(&world));
    }

    /// An open 40x40 sandbox with two players and no weapons except what a test
    /// gives back; features are added with `place`.
    fn sandbox() -> World {
        World::sandbox(Ruleset::builtin(), MapGrid::open(40, 40), &[0, 1])
    }

    /// Adds a feature of type `id` at `(x, y)`; returns its row index.
    fn place(world: &mut World, id: &str, x: i32, y: i32) -> usize {
        let kind = world.feature_kind(id).expect("feature type exists");
        let hp = world.rules.feature_types[kind].hp;
        world.features.push(FeatureState {
            kind: kind as u32,
            x,
            y,
            rot: 0,
            variant: 0,
            state: 0,
            hp,
            alive: true,
            to: None,
            burn: 0,
            collapse: 0,
        });
        world.refresh_feature_blocks();
        world.features.len() - 1
    }

    fn centre(x: i32, y: i32) -> FxVec2 {
        FxVec2::new(
            Fx::from_raw(x * 65536 + 32768),
            Fx::from_raw(y * 65536 + 32768),
        )
    }

    fn kind_of(world: &World, id: &str) -> usize {
        world.feature_kind(id).unwrap()
    }

    fn drive(world: &mut World, unit: &str, from: (i32, i32), to: (i32, i32), ticks: u32) {
        let kind = world.rules.type_index(unit).unwrap();
        let id = world.spawn(0, kind, centre(from.0, from.1));
        world.enqueue(crate::world::Command::Move {
            units: vec![id],
            target: centre(to.0, to.1),
        });
        for _ in 0..ticks {
            world.step();
        }
    }

    #[test]
    fn a_tank_flattens_bushes_and_fells_trees() {
        let mut world = sandbox();
        let bush = place(&mut world, "bush", 14, 20);
        let fence = place(&mut world, "fence", 16, 20);
        let tree = place(&mut world, "pine", 22, 30);
        let far = place(&mut world, "bush", 14, 10);
        drive(&mut world, "ua-leopard-2a4", (10, 20), (26, 20), 600);
        drive(&mut world, "ua-leopard-2a4", (10, 30), (21, 30), 600);
        assert!(!world.features()[bush].alive, "the bush is flattened");
        assert!(!world.features()[fence].alive, "the fence is flattened");
        assert_eq!(
            world.features()[tree].kind as usize,
            kind_of(&world, "tree-stump"),
            "the tree is felled and leaves a stump"
        );
        assert!(world.terrain.is_passable(Cell { x: 19, y: 20 }));
        assert!(world.features()[far].alive, "untouched features stay");
    }

    #[test]
    fn a_wheeled_vehicle_damages_decor_but_cannot_fell_trees() {
        let mut world = sandbox();
        let bush = place(&mut world, "bush", 14, 20);
        let tree = place(&mut world, "pine", 22, 30);
        drive(&mut world, "ua-supply-truck", (10, 20), (26, 20), 600);
        drive(&mut world, "ua-supply-truck", (10, 30), (22, 30), 600);
        assert!(world.features()[bush].hp < 30, "the bush is damaged");
        assert_eq!(world.features()[tree].hp, 150, "the tree is untouched");
    }

    #[test]
    fn fire_spreads_along_a_row_of_trees_and_is_deterministic() {
        let run = || {
            let mut world = sandbox();
            let trees: Vec<usize> = (10..20).map(|x| place(&mut world, "pine", x, 20)).collect();
            world.ignite_feature(trees[0]);
            for _ in 0..400 {
                world.step();
            }
            (state_hash(&world), world.features().to_vec(), trees)
        };
        let (hash_a, rows, trees) = run();
        let (hash_b, _, _) = run();
        assert_eq!(hash_a, hash_b);
        let stump = rows[trees[0]].kind;
        assert_eq!(stump as usize, {
            let world = sandbox();
            kind_of(&world, "tree-stump")
        });
        let felled = trees.iter().filter(|&&i| rows[i].kind == stump).count();
        assert!(
            felled >= 3,
            "the fire reached several trees, felled {felled}"
        );
    }

    #[test]
    fn a_wrecked_building_collapses_into_rubble_that_blocks_vehicles() {
        let mut world = sandbox();
        let house = place(&mut world, "house-small", 10, 10);
        assert!(world.damage_feature(house, 250));
        assert_eq!(world.features()[house].state, 2);
        assert!(world.damage_feature(house, 1000));
        let row = world.features()[house];
        assert_eq!((row.hp, row.collapse), (0, 60));
        assert!(
            !world.damage_feature(house, 1),
            "a collapsing house is done"
        );
        for _ in 0..60 {
            world.step();
        }
        let row = world.features()[house];
        assert_eq!(row.kind as usize, kind_of(&world, "rubble-2x2"));
        assert_eq!(row.collapse, 0);
        for (x, y) in [(10, 10), (11, 11)] {
            assert!(
                !world.nav.is_passable(Cell { x, y }),
                "rubble blocks vehicles"
            );
            assert!(
                world.grid(Layer::Foot).is_passable(Cell { x, y }),
                "infantry walk on rubble"
            );
        }
    }

    /// A rubble wall across the map at rows 18..=20, open only at x 36..=39.
    fn rubble_wall() -> World {
        let mut world = sandbox();
        for x in (0..36).step_by(4) {
            place(&mut world, "rubble-4x3", x, 18);
        }
        world
    }

    /// Moves a new `unit` from `from` to `to`; returns its cells along the
    /// way and whether it arrived within `ticks`.
    fn route(
        world: &mut World,
        unit: &str,
        from: (i32, i32),
        to: (i32, i32),
        ticks: u32,
    ) -> (Vec<Cell>, bool) {
        let kind = world.rules.type_index(unit).unwrap();
        let id = world.spawn(0, kind, centre(from.0, from.1));
        world.enqueue(crate::world::Command::Move {
            units: vec![id],
            target: centre(to.0, to.1),
        });
        let mut cells = Vec::new();
        for _ in 0..ticks {
            world.step();
            let unit = world.entity(id).unwrap();
            cells.push(cell_of(unit.pos));
            if matches!(unit.order, crate::world::Order::Idle { .. }) {
                return (cells, cell_of(unit.pos) == Cell { x: to.0, y: to.1 });
            }
        }
        (cells, false)
    }

    #[test]
    fn infantry_walk_straight_across_rubble() {
        let mut world = rubble_wall();
        let (cells, arrived) = route(&mut world, "ua-rifleman", (10, 10), (10, 30), 1200);
        assert!(arrived, "the rifleman reached the far side");
        assert!(
            cells
                .iter()
                .any(|cell| (18..=20).contains(&cell.y) && cell.x < 36)
        );
        assert!(
            cells.iter().all(|cell| cell.x <= 12),
            "no detour: {cells:?}"
        );
    }

    #[test]
    fn a_tank_routes_around_rubble() {
        let mut world = rubble_wall();
        let (cells, arrived) = route(&mut world, "ua-leopard-2a4", (10, 10), (10, 30), 2400);
        assert!(arrived, "the tank reached the far side");
        assert!(
            cells
                .iter()
                .all(|cell| !(18..=20).contains(&cell.y) || cell.x >= 36),
            "the tank never drove onto the rubble"
        );
    }

    #[test]
    fn foot_fields_survive_a_save() {
        let mut world = World::skirmish_with(Ruleset::builtin(), "demo-town", false).unwrap();
        let before = save_state(&world, 7, &[]).unwrap();
        assert!(
            before.foot_flow_goals.is_empty(),
            "no rubble, no foot layer"
        );
        let house = world
            .features()
            .iter()
            .position(|row| row.kind as usize == kind_of(&world, "house-small"))
            .expect("demo-town has a small house");
        world.features[house].kind = kind_of(&world, "rubble-2x2") as u32;
        world.refresh_feature_blocks();
        let rubble = Cell {
            x: world.features[house].x,
            y: world.features[house].y,
        };
        world.field(Layer::Foot, rubble);
        let saved = save_state(&world, 7, &[]).unwrap();
        assert_eq!(saved.foot_flow_goals, vec![[rubble.x, rubble.y]]);
        let (loaded, _, _) = load_state(&saved).unwrap();
        assert!(
            loaded
                .fields
                .contains_key(&(Layer::Foot, loaded.nav.index(rubble)))
        );
        assert_eq!(state_hash(&loaded), state_hash(&world));
    }

    #[test]
    fn a_shell_on_a_tree_damages_it_and_sets_it_on_fire() {
        let mut world = sandbox();
        let tree = place(&mut world, "pine", 20, 20);
        let tank = world.rules.type_index("ua-leopard-2a4").unwrap();
        let id = world.spawn(0, tank, centre(15, 20));
        world.enqueue(crate::world::Command::AttackGround {
            units: vec![id],
            target: centre(20, 20),
        });
        let mut burned = false;
        for _ in 0..90 {
            world.step();
            burned |= world.features()[tree].burn > 0;
        }
        assert!(burned, "the tree caught fire");
        assert!(world.features()[tree].hp < 150);
    }

    #[test]
    fn a_broken_bridge_blocks_its_deck_over_deep_water() {
        let mut world = World::skirmish_with(Ruleset::builtin(), "demo-bridges", false).unwrap();
        let bridge = world
            .features()
            .iter()
            .position(|row| row.to.is_some())
            .expect("demo-bridges has a bridge");
        let row = world.features()[bridge];
        let (x0, y0, x1, y1) = (row.x, row.y, row.to.unwrap()[0], row.to.unwrap()[1]);
        let deep: Vec<Cell> = (y0..=y1)
            .flat_map(|y| (x0..=x1).map(move |x| Cell { x, y }))
            .filter(|&cell| world.terrain_base.water_at(cell) & WATER_DEPTH_MASK == WATER_DEEP)
            .collect();
        assert!(!deep.is_empty());
        assert!(deep.iter().all(|&cell| world.terrain.is_passable(cell)));
        let max = world.rules.feature_types[row.kind as usize].hp;
        assert!(max > 0);
        assert!(world.damage_feature(bridge, max));
        assert!(deep.iter().all(|&cell| !world.terrain.is_passable(cell)));
        assert!(deep.iter().all(|&cell| !world.nav.is_passable(cell)));
    }

    #[test]
    fn burning_and_collapse_survive_a_save() {
        let mut rules = Ruleset::builtin();
        for ty in &mut rules.feature_types {
            ty.hp = 100;
        }
        let mut world = World::skirmish_with(rules, "demo-forest", false).unwrap();
        let tree = world
            .features()
            .iter()
            .position(|row| {
                world.rules.feature_types[row.kind as usize]
                    .flammable
                    .is_some()
            })
            .expect("demo-forest has a flammable feature");
        world.ignite_feature(tree);
        world.features[tree].collapse = 9;
        let saved = save_state(&world, 7, &[]).unwrap();
        assert_eq!(saved.features[tree].burn, 200);
        let (loaded, _, _) = load_state(&saved).unwrap();
        assert_eq!(loaded.features()[tree].burn, 200);
        assert_eq!(loaded.features()[tree].collapse, 9);
    }
}
