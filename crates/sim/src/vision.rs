//! Per-player visibility, exploration and entity visibility (P2-07, spec §5.4,
//! §5.12).

use crate::entity::{EntityId, NEUTRAL, PlayerId};
use crate::map::{Cell, cell_of};
use crate::nav::footprint_cells;
use crate::rules::fx_centi;
use crate::world::World;

const HALF_TILE: i64 = 32768;

impl World {
    /// Vision phase: recomputes every player's `visible` grid from the entities
    /// it owns, then merges it into `explored`.
    pub(crate) fn update_visibility(&mut self) {
        let width = self.terrain.width();
        let height = self.terrain.height();
        for player in &mut self.players {
            player.visible.fill(false);
        }
        for entity in &self.entities {
            let sight_centi = self.rules.ty(entity.kind).sight_centi;
            if sight_centi == 0 {
                continue;
            }
            let Some(player) = self.players.get_mut(usize::from(entity.owner)) else {
                continue;
            };
            let sight = i64::from(fx_centi(sight_centi).raw());
            let radius2 = sight * sight;
            let cx = i64::from(entity.pos.x.raw());
            let cy = i64::from(entity.pos.y.raw());
            let min_x = ceil_div(cx - sight - HALF_TILE, 65536).max(0) as i32;
            let max_x = (cx + sight - HALF_TILE)
                .div_euclid(65536)
                .min(i64::from(width) - 1) as i32;
            let min_y = ceil_div(cy - sight - HALF_TILE, 65536).max(0) as i32;
            let max_y = (cy + sight - HALF_TILE)
                .div_euclid(65536)
                .min(i64::from(height) - 1) as i32;
            for y in min_y..=max_y {
                for x in min_x..=max_x {
                    let dx = i64::from(x) * 65536 + HALF_TILE - cx;
                    let dy = i64::from(y) * 65536 + HALF_TILE - cy;
                    if dx * dx + dy * dy <= radius2 {
                        let index = (y as u32) * u32::from(width) + (x as u32);
                        player.visible[index as usize] = true;
                    }
                }
            }
        }
        for player in &mut self.players {
            for (explored, &visible) in player.explored.iter_mut().zip(player.visible.iter()) {
                *explored |= visible;
            }
        }
    }

    /// Marks every cell of `player`'s map as explored. Unknown players are
    /// ignored.
    pub fn explore_all(&mut self, player: PlayerId) {
        if let Some(player) = self.players.get_mut(usize::from(player)) {
            player.explored.fill(true);
        }
    }

    /// Runs the vision phase now (same work as phase 6 of `step`).
    pub fn refresh_visibility(&mut self) {
        self.update_visibility();
    }

    /// 0 unexplored, 1 explored but not visible, 2 visible; `OBSERVER` (or any
    /// id without a player) -> 2. Out of bounds -> 0.
    pub fn fog(&self, player: PlayerId, cell: Cell) -> u8 {
        let Some(player) = self.players.get(usize::from(player)) else {
            return 2;
        };
        if !self.terrain.in_bounds(cell) {
            return 0;
        }
        let index = self.terrain.index(cell) as usize;
        if player.visible[index] {
            2
        } else if player.explored[index] {
            1
        } else {
            0
        }
    }

    /// Own entities and depots: true. `OBSERVER`: true. Units: their cell is
    /// visible. Buildings: any footprint cell visible. Unknown ids: false.
    pub fn is_entity_visible(&self, player: PlayerId, id: EntityId) -> bool {
        let Some(entity) = self.entity(id) else {
            return false;
        };
        let Some(player) = self.players.get(usize::from(player)) else {
            return true;
        };
        if entity.owner == player.id || entity.owner == NEUTRAL {
            return true;
        }
        match &entity.site {
            Some(site) => {
                let size = self.rules.ty(entity.kind).footprint;
                footprint_cells(site.origin, size)
                    .iter()
                    .any(|&cell| player.visible[self.terrain.index(cell) as usize])
            }
            None => {
                let cell = cell_of(entity.pos);
                self.terrain.in_bounds(cell) && player.visible[self.terrain.index(cell) as usize]
            }
        }
    }
}

/// `ceil(a / b)` for `b > 0` (integer, exact).
fn ceil_div(a: i64, b: i64) -> i64 {
    a.div_euclid(b) + i64::from(a.rem_euclid(b) != 0)
}
