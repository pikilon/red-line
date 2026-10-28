//! Map features during a match (spec 31, base layer): hit points, damage
//! states, destruction into another feature type, and the blocking that
//! follows. Rows are created from the map in map order and never removed, so
//! a row's index is stable for saves, hashes and later snapshots.

use crate::map::{Cell, MapGrid};
use crate::rules::{FeatureBlocks, FeatureInstanceDef, FeatureTypeDef, MapDef, Ruleset};
use crate::world::World;

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

/// `base` (terrain without features) plus the footprints of every living
/// feature that blocks movement.
pub fn with_blocks(base: &MapGrid, features: &[FeatureState], rules: &Ruleset) -> MapGrid {
    let mut terrain = base.clone();
    for row in features {
        if !row.alive {
            continue;
        }
        let def = &rules.feature_types[row.kind as usize];
        if def.blocks == FeatureBlocks::None {
            continue;
        }
        let (w, h) = footprint(def, row.rot);
        terrain.block_footprint(Cell { x: row.x, y: row.y }, w, h);
    }
    terrain
}

/// Damage state of `hp` out of `max` under the type's thresholds: 2 when at
/// or below the wrecked threshold, 1 at or below the damaged one, else 0.
fn state_for(hp: u32, max: u32, damaged: u32, wrecked: u32) -> u8 {
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

    /// Spec 31: applies `amount` damage to feature `index`. Damage states only
    /// get worse. At zero hit points the feature becomes its `destroy` type at
    /// full hit points, or stops blocking when it has none. Returns `false` when
    /// the feature is missing, already gone or cannot be damaged.
    pub fn damage_feature(&mut self, index: usize, amount: u32) -> bool {
        let Some(row) = self.features.get(index).copied() else {
            return false;
        };
        if !row.alive {
            return false;
        }
        let def = &self.rules.feature_types[row.kind as usize];
        if def.hp == 0 {
            return false;
        }
        let (max, states) = (def.hp, def.states);
        let becomes = def.destroy.as_ref().map(|destroy| destroy.becomes.clone());
        let hp = row.hp.saturating_sub(amount);

        let next = if hp == 0 {
            let replacement = becomes.and_then(|id| {
                self.rules
                    .feature_types
                    .iter()
                    .position(|candidate| candidate.id == id)
            });
            match replacement {
                Some(kind) => {
                    let ty = &self.rules.feature_types[kind];
                    FeatureState {
                        kind: kind as u32,
                        variant: 0,
                        state: 0,
                        hp: ty.hp,
                        ..row
                    }
                }
                None => FeatureState {
                    hp: 0,
                    alive: false,
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
        self.refresh_feature_blocks();
        true
    }

    /// Recomputes `terrain` from the base terrain and the living features, then
    /// rebuilds `nav` (which also clears the flow fields). Every change of
    /// blocking goes through here (spec 31 §4.1).
    pub(crate) fn refresh_feature_blocks(&mut self) {
        self.terrain = with_blocks(&self.terrain_base, &self.features, &self.rules);
        self.rebuild_nav();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::state_hash;
    use crate::rules::FeatureDestroy;
    use crate::save::{load_state, save_state};

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
}
