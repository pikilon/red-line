//! Spec 31 block 3: height and cover in combat. A shooter well above its target
//! reaches farther (accuracy is untouched); a target in cover takes less
//! damage. Values come from `Ruleset::environment` (`data/balance/environment.yaml`),
//! everything is integer or fixed point. Craters are not tracked by the sim
//! yet, so they give no cover; forests (vegetation features) and walls or
//! buildings (a footprint the shot crosses) do. Covers never stack: the best
//! one applies (spec 31 A3).

use crate::features::{FeatureState, footprint};
use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, cell_of, line_all};
use crate::rules::FeatureBlocks;
use crate::world::World;

impl World {
    /// Weapon range of a shot from `from` at `to`: `range` itself, or
    /// `highGround.rangePct` percent of it when the ground under the shooter is
    /// at least `highGround.minTiles` above the ground under the target.
    pub(crate) fn effective_range(&self, range: Fx, from: FxVec2, to: FxVec2) -> Fx {
        let high = self.rules.environment.high_ground;
        if high.range_pct <= 100 || self.terrain.heights().is_empty() {
            return range;
        }
        let rise = self.terrain.ground_height(from) - self.terrain.ground_height(to);
        if rise < Fx::from_int(high.min_tiles as i32) {
            return range;
        }
        let scaled = i64::from(range.raw()) * i64::from(high.range_pct) / 100;
        Fx::from_raw(scaled.min(i64::from(i32::MAX)) as i32)
    }

    /// Percent of damage a target at `target` avoids against a shot from
    /// `shooter` (`None` when the shooter is gone: only static cover counts).
    /// The best of the forest and wall covers, never their sum.
    pub(crate) fn cover_pct(&self, shooter: Option<FxVec2>, target: FxVec2) -> u32 {
        let cover = self.rules.environment.cover;
        let mut best = 0;
        if cover.forest_pct > best && self.in_forest(cell_of(target)) {
            best = cover.forest_pct;
        }
        if cover.wall_pct > best
            && let Some(from) = shooter
            && self.shot_crosses_wall(from, target)
        {
            best = cover.wall_pct;
        }
        best.min(100)
    }

    /// Whether `cell` or a neighbour holds a living tree or hedge (vegetation
    /// that blocks movement). Trees block movement, so a unit "in a forest"
    /// stands beside them; stumps and bushes give no cover.
    fn in_forest(&self, cell: Cell) -> bool {
        self.features.iter().any(|row| {
            let def = &self.rules.feature_types[row.kind as usize];
            row.alive
                && def.family == "vegetation"
                && def.blocks != FeatureBlocks::None
                && self.row_covers(row, cell, 1)
        })
    }

    /// Whether the line of fire crosses the footprint of a living wall or
    /// building feature, ignoring the shooter's and the target's own cells and
    /// any footprint they stand in (a garrison fires out of its own building).
    fn shot_crosses_wall(&self, from: FxVec2, to: FxVec2) -> bool {
        let walls: Vec<&FeatureState> = self
            .features
            .iter()
            .filter(|row| {
                row.alive && {
                    let family = self.rules.feature_types[row.kind as usize].family.as_str();
                    family == "wall" || family == "building"
                }
            })
            .collect();
        if walls.is_empty() {
            return false;
        }
        let (start, end) = (cell_of(from), cell_of(to));
        let walls: Vec<&FeatureState> = walls
            .into_iter()
            .filter(|row| !self.row_covers(row, start, 0) && !self.row_covers(row, end, 0))
            .collect();
        !line_all(from, to, |cell| {
            cell == start || cell == end || !walls.iter().any(|row| self.row_covers(row, cell, 0))
        })
    }

    /// Whether `cell` lies within `margin` cells of the footprint of `row`.
    fn row_covers(&self, row: &FeatureState, cell: Cell, margin: i32) -> bool {
        let (w, h) = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
        cell.x >= row.x - margin
            && cell.x < row.x + w + margin
            && cell.y >= row.y - margin
            && cell.y < row.y + h + margin
    }
}

/// `damage` less `pct` percent, never below 1 for a damaging hit.
pub(crate) fn reduce_damage(damage: u32, pct: u32) -> u32 {
    if damage == 0 || pct == 0 {
        return damage;
    }
    (u64::from(damage) * u64::from(100 - pct.min(100)) / 100).max(1) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::MapGrid;
    use crate::rules::{Ruleset, fx_centi};

    fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
        FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
    }

    /// 60 x 24 cells; the ground is flat west of x = 20 and climbs 8 steps
    /// (half a tile) per cell to 64 steps (4 tiles) at x = 28.
    fn hill() -> MapGrid {
        let mut map = MapGrid::open(60, 24);
        let heights = (0..25)
            .flat_map(|_| (0..61).map(|x| ((x - 20).clamp(0, 8) * 8) as u8))
            .collect();
        map.set_heights(heights);
        map
    }

    fn world(map: MapGrid) -> World {
        let mut world = World::sandbox(Ruleset::builtin(), map, &[0, 0]);
        assert_eq!(world.rules.environment.high_ground.min_tiles, 2);
        assert!(world.rules.environment.cover.wall_pct > 0);
        world.rules.environment.cover.forest_pct = 25;
        world.rules.environment.cover.wall_pct = 40;
        world
    }

    fn add_feature(world: &mut World, id: &str, x: i32, y: i32) {
        let kind = world
            .rules
            .feature_types
            .iter()
            .position(|ty| ty.id == id)
            .unwrap() as u32;
        world.features.push(FeatureState {
            kind,
            x,
            y,
            rot: 0,
            variant: 0,
            state: 0,
            hp: 0,
            alive: true,
            to: None,
            burn: 0,
            collapse: 0,
        });
        world.refresh_feature_blocks();
    }

    /// Hit points the target loses to the first rifle round.
    fn first_hit(mut world: World, shooter: FxVec2, target: FxVec2) -> u32 {
        let rifleman = world.rules.type_index("ua-rifleman").unwrap();
        world.spawn(0, rifleman, shooter);
        let victim = world.spawn(1, rifleman, target);
        let hp = world.entity(victim).unwrap().hp;
        for _ in 0..60 {
            world.step();
            let now = world.entity(victim).unwrap().hp;
            if now < hp {
                return hp - now;
            }
        }
        0
    }

    #[test]
    fn high_ground_extends_range_only_from_two_tiles_up() {
        let world = world(hill());
        let range = fx_centi(450);
        let low = at(2050, 1250);
        // 4.8 tiles away, shooter 2.4 tiles higher: in range at 115 %.
        let high = at(2530, 1250);
        assert!(world.effective_range(range, high, low) > range);
        assert_eq!(
            world.effective_range(range, high, low),
            Fx::from_raw((i64::from(range.raw()) * 115 / 100) as i32)
        );
        // Same pair the other way round, and two points on the flat: no change.
        assert_eq!(world.effective_range(range, low, high), range);
        assert_eq!(
            world.effective_range(range, at(500, 500), at(900, 500)),
            range
        );
        // 1.5 tiles up is below `minTiles`.
        assert_eq!(world.effective_range(range, at(2430, 1250), low), range);
    }

    #[test]
    fn a_shooter_on_the_hill_fires_from_beyond_flat_range() {
        let rifleman = Ruleset::builtin().type_index("ua-rifleman").unwrap();
        let fires = |map: MapGrid| {
            let mut world = world(map);
            let shooter = world.spawn(0, rifleman, at(2530, 1250));
            let victim = world.spawn(1, rifleman, at(2050, 1250));
            let hp = world.entity(victim).unwrap().hp;
            for _ in 0..40 {
                world.step();
            }
            world.entity(victim).is_none_or(|v| v.hp < hp) && world.entity(shooter).is_some()
        };
        assert!(fires(hill()), "the shooter on the hill reaches 4.8 tiles");
        assert!(!fires(MapGrid::open(60, 24)), "flat ground stops at 4.5");
    }

    #[test]
    fn forest_cover_reduces_damage() {
        let open = first_hit(world(MapGrid::open(40, 24)), at(1050, 1050), at(1350, 1050));
        let mut covered = world(MapGrid::open(40, 24));
        add_feature(&mut covered, "pine", 14, 10);
        let forest = first_hit(covered, at(1050, 1050), at(1350, 1050));
        assert_eq!((open, forest), (10, 7));
    }

    #[test]
    fn a_wall_on_the_line_of_fire_reduces_damage() {
        let mut covered = world(MapGrid::open(40, 24));
        add_feature(&mut covered, "stone-wall", 11, 10);
        let walled = first_hit(covered, at(1050, 1050), at(1350, 1050));
        assert_eq!(walled, 6);
        // A wall that is not on the line does nothing.
        let mut aside = world(MapGrid::open(40, 24));
        add_feature(&mut aside, "stone-wall", 11, 5);
        assert_eq!(first_hit(aside, at(1050, 1050), at(1350, 1050)), 10);
    }

    #[test]
    fn covers_do_not_stack() {
        let mut both = world(MapGrid::open(40, 24));
        add_feature(&mut both, "pine", 14, 10);
        add_feature(&mut both, "stone-wall", 11, 10);
        assert_eq!(both.cover_pct(Some(at(1050, 1050)), at(1350, 1050)), 40);
        assert_eq!(first_hit(both, at(1050, 1050), at(1350, 1050)), 6);
        assert_eq!(reduce_damage(10, 40), 6);
        assert_eq!(reduce_damage(1, 90), 1);
        assert_eq!(reduce_damage(10, 0), 10);
    }

    #[test]
    fn stumps_and_own_buildings_give_no_cover() {
        let mut stumps = world(MapGrid::open(40, 24));
        add_feature(&mut stumps, "tree-stump", 14, 10);
        assert_eq!(stumps.cover_pct(None, at(1350, 1050)), 0);
        // A shooter inside a 2x2 house (a garrison) fires out without its own
        // walls covering the target; a house between them still does.
        let mut town = world(MapGrid::open(40, 24));
        add_feature(&mut town, "house-small", 10, 10);
        assert_eq!(town.cover_pct(Some(at(1100, 1100)), at(1500, 1100)), 0);
        assert_eq!(town.cover_pct(Some(at(800, 1100)), at(1500, 1100)), 40);
    }
}
