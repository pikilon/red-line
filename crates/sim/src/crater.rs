//! Spec 60: craters as simulation terrain. A shell that lands on open ground
//! digs a bowl into the per-cell depth grid (`World::craters`, centi-tiles);
//! tracked hulls cross it slowed, wheeled hulls are slowed and cannot enter a
//! cell dug past their block depth, which closes the `Wheels` navigation grid
//! so pathfinding routes around it. Integer math only; every number comes from
//! `Ruleset::craters` (`data/balance/environment.yaml`).

use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, cell_of};
use crate::rules::{CraterMover, LocoKind, Motion};
use crate::world::World;

impl World {
    /// Depth of the crater under `cell` in centi-tiles (0 on flat ground).
    pub fn crater_depth(&self, cell: Cell) -> u32 {
        if self.craters.is_empty() || !self.nav.in_bounds(cell) {
            return 0;
        }
        u32::from(self.craters[self.nav.index(cell) as usize])
    }

    /// Craters as `(x, y, depth)` rows in cell order, for saves and the client.
    pub fn crater_cells(&self) -> Vec<(i32, i32, u8)> {
        self.craters
            .iter()
            .enumerate()
            .filter(|(_, depth)| **depth > 0)
            .map(|(index, depth)| {
                let cell = self.nav.cell(index as u32);
                (cell.x, cell.y, *depth)
            })
            .collect()
    }

    /// Digs the crater of a `damage_type` shell landing at `impact`; nothing
    /// for a type with no entry. Cells inside the radius sink by
    /// `depth * (1 - t^2)^2`, `t` being their distance in radii (Zero Hour has
    /// no crater gameplay; the profile is the client's bowl, spec 29 §4).
    pub(crate) fn dig_crater(&mut self, damage_type: u8, impact: FxVec2) {
        let rules = &self.rules.craters;
        let Some(dig) = rules.digs.iter().find(|d| d.damage_type == damage_type) else {
            return;
        };
        let (radius, depth, max) = (
            i64::from(dig.radius_centi),
            i64::from(dig.depth_centi),
            rules.max_depth_centi.min(255),
        );
        let limit = rules.wheels.block_depth_centi;
        let (cx, cy) = (centi(impact.x), centi(impact.y));
        let (x0, x1) = ((cx - radius).div_euclid(100), (cx + radius).div_euclid(100));
        let (y0, y1) = ((cy - radius).div_euclid(100), (cy + radius).div_euclid(100));
        let r2 = radius * radius;
        let mut closed = false;
        for y in y0..=y1 {
            for x in x0..=x1 {
                let cell = Cell {
                    x: x as i32,
                    y: y as i32,
                };
                if !self.nav.in_bounds(cell)
                    || !self.terrain.is_passable(cell)
                    || self.terrain.water_at(cell) != 0
                {
                    continue;
                }
                let (dx, dy) = (x * 100 + 50 - cx, y * 100 + 50 - cy);
                let q = r2 - (dx * dx + dy * dy);
                if q <= 0 {
                    continue;
                }
                let add = (depth * q * q + r2 * r2 / 2) / (r2 * r2);
                if add == 0 {
                    continue;
                }
                if self.craters.is_empty() {
                    let cells = usize::from(self.nav.width()) * usize::from(self.nav.height());
                    self.craters = vec![0; cells];
                }
                let slot = &mut self.craters[self.nav.index(cell) as usize];
                let before = u32::from(*slot);
                *slot = (i64::from(*slot) + add).min(i64::from(max)) as u8;
                let after = u32::from(*slot);
                closed |= limit.is_some_and(|limit| before < limit && after >= limit);
            }
        }
        if closed {
            self.refresh_feature_blocks();
        }
    }

    /// `motion` of unit `index` with its top speeds cut by the crater it
    /// stands in (spec 60 §4).
    pub(crate) fn cratered_motion(&self, index: usize) -> Motion {
        let entity = &self.entities[index];
        let mut motion = self.rules.ty(entity.kind).motion;
        let depth = self.crater_depth(cell_of(entity.pos));
        let rules = &self.rules.craters;
        let mover: CraterMover = match motion.kind {
            LocoKind::Tracks => rules.tracks,
            LocoKind::Wheels => rules.wheels,
            LocoKind::Foot => rules.foot,
            _ => return motion,
        };
        if depth == 0 || mover.slow_pct == 0 || rules.max_depth_centi == 0 {
            return motion;
        }
        let lost = (mover.slow_pct * depth / rules.max_depth_centi).min(90);
        let keep = i64::from(100 - lost);
        motion.max_speed = scale(motion.max_speed, keep);
        motion.reverse_speed = scale(motion.reverse_speed, keep);
        motion
    }
}

fn scale(speed: Fx, percent: i64) -> Fx {
    Fx::from_raw((i64::from(speed.raw()) * percent / 100) as i32)
}

/// Fixed-point tiles to centi-tiles, rounding down.
fn centi(value: Fx) -> i64 {
    (i64::from(value.raw()) * 100) >> 16
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::state_hash;
    use crate::map::MapGrid;
    use crate::rules::Ruleset;
    use crate::save::{load_state, save_state};
    use crate::world::{Command, Layer};

    fn sandbox() -> World {
        World::sandbox(Ruleset::builtin(), MapGrid::open(40, 40), &[0, 1])
    }

    fn at(x: i32, y: i32) -> FxVec2 {
        FxVec2::new(
            Fx::from_raw(x * 65536 + 32768),
            Fx::from_raw(y * 65536 + 32768),
        )
    }

    fn he(world: &World) -> u8 {
        world
            .rules
            .damage_types
            .iter()
            .position(|id| id == "highExplosive")
            .unwrap() as u8
    }

    fn run(world: &mut World, unit: &str, from: (i32, i32), to: (i32, i32), ticks: u32) -> FxVec2 {
        let kind = world.rules.type_index(unit).unwrap();
        let id = world.spawn(0, kind, at(from.0, from.1));
        world.enqueue(Command::Move {
            units: vec![id],
            target: at(to.0, to.1),
        });
        for _ in 0..ticks {
            world.step();
        }
        world.entity(id).unwrap().pos
    }

    #[test]
    fn ac_60_01_a_shell_digs_a_stacking_capped_crater() {
        let mut world = sandbox();
        assert_eq!(world.crater_depth(Cell { x: 20, y: 20 }), 0);
        let he = he(&world);
        world.dig_crater(he, at(20, 20));
        let once = world.crater_depth(Cell { x: 20, y: 20 });
        assert!(once > 0, "the centre sinks");
        assert!(once <= 12, "one shell is shallow");
        assert_eq!(world.crater_depth(Cell { x: 30, y: 30 }), 0);
        for _ in 0..20 {
            world.dig_crater(he, at(20, 20));
        }
        let max = world.rules.craters.max_depth_centi;
        assert_eq!(world.crater_depth(Cell { x: 20, y: 20 }), max);
    }

    #[test]
    fn ac_60_02_deep_craters_close_the_wheels_grid_only() {
        let mut world = sandbox();
        let he = he(&world);
        let cell = Cell { x: 20, y: 20 };
        world.dig_crater(he, at(20, 20));
        assert!(
            world.grid(Layer::Wheels).is_passable(cell),
            "a dent is open"
        );
        world.dig_crater(he, at(20, 20));
        assert!(!world.grid(Layer::Wheels).is_passable(cell), "deep: closed");
        assert!(world.grid(Layer::Vehicle).is_passable(cell), "tracks cross");
        assert!(world.grid(Layer::Foot).is_passable(cell), "feet cross");
    }

    #[test]
    fn ac_60_03_a_truck_routes_around_a_deep_crater_and_a_tank_crosses() {
        let mut world = sandbox();
        let he = he(&world);
        for _ in 0..3 {
            world.dig_crater(he, at(20, 20));
        }
        assert!(!world.grid(Layer::Wheels).is_passable(Cell { x: 20, y: 20 }));
        let kind = world.rules.type_index("ua-supply-truck").unwrap();
        let id = world.spawn(0, kind, at(10, 20));
        world.enqueue(Command::Move {
            units: vec![id],
            target: at(30, 20),
        });
        for _ in 0..900 {
            world.step();
            let cell = cell_of(world.entity(id).unwrap().pos);
            assert_ne!(
                cell,
                Cell { x: 20, y: 20 },
                "the truck never enters the crater"
            );
        }
        let truck = world.entity(id).unwrap().pos;
        assert!(
            (truck.x - at(30, 20).x).raw().abs() < 65536,
            "the truck arrives"
        );
        let tank = run(&mut world, "ua-leopard-2a4", (10, 22), (30, 22), 900);
        assert!(
            (tank.x - at(30, 22).x).raw().abs() < 65536,
            "the tank arrives"
        );
    }

    #[test]
    fn ac_60_04_craters_slow_tracks_and_wheels_not_feet() {
        let mut world = sandbox();
        let he = he(&world);
        world.dig_crater(he, at(20, 20));
        let speeds = |world: &mut World, unit: &str| {
            let kind = world.rules.type_index(unit).unwrap();
            let id = world.spawn(0, kind, at(20, 20));
            let index = world.index_of(id).unwrap();
            (
                world.cratered_motion(index).max_speed,
                world.rules.ty(kind).motion.max_speed,
            )
        };
        let (tank, tank_top) = speeds(&mut world, "ua-leopard-2a4");
        let (truck, truck_top) = speeds(&mut world, "ua-supply-truck");
        assert!(tank < tank_top, "tracks slow in a crater");
        assert!(truck < truck_top, "wheels slow in a crater");
        let (foot, foot_top) = speeds(&mut world, "ua-rifleman");
        assert_eq!(foot, foot_top, "infantry are unaffected");
    }

    #[test]
    fn ac_60_05_craters_are_hashed_and_survive_a_save() {
        let mut world = World::skirmish_with(Ruleset::builtin(), "showcase", false).unwrap();
        let before = state_hash(&world);
        let he = he(&world);
        for _ in 0..3 {
            world.dig_crater(he, at(40, 20));
        }
        assert_ne!(state_hash(&world), before, "craters change the hash");
        let state = save_state(&world, 1, &[]).unwrap();
        let (loaded, _, _) = load_state(&state).unwrap();
        assert_eq!(state_hash(&loaded), state_hash(&world));
        assert_eq!(loaded.crater_cells(), world.crater_cells());
        assert!(
            !loaded
                .grid(Layer::Wheels)
                .is_passable(Cell { x: 40, y: 20 })
        );
    }

    #[test]
    fn ac_60_06_a_save_without_craters_still_loads() {
        let world = World::skirmish_with(Ruleset::builtin(), "showcase", false).unwrap();
        let state = save_state(&world, 1, &[]).unwrap();
        assert!(state.craters.is_empty());
        let json = serde_json::to_string(&state).unwrap();
        assert!(!json.contains("craters"), "an empty list is not written");
        let old: crate::save::SimState = serde_json::from_str(&json).unwrap();
        assert!(load_state(&old).is_ok());
    }
}
