//! Footprint geometry and navigation-grid helpers (P2-06, spec §5.5).
//!
//! A footprint is a `width x height` block of tiles anchored at a building's
//! tile `origin`. These helpers compute the footprint centre, distance to it and
//! the cells / approach and exit points used when routing moving orders.

use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, MapGrid};

/// Cells of the footprint in row-major order (rows first, then columns), from
/// `origin`.
pub fn footprint_cells(origin: Cell, size: [u16; 2]) -> Vec<Cell> {
    let mut cells = Vec::with_capacity(usize::from(size[0]) * usize::from(size[1]));
    for dy in 0..i32::from(size[1]) {
        for dx in 0..i32::from(size[0]) {
            cells.push(Cell {
                x: origin.x + dx,
                y: origin.y + dy,
            });
        }
    }
    cells
}

/// Centre of the footprint rectangle: `(ox * 65536 + w * 32768, oy * 65536 + h *
/// 32768)` raw.
pub fn footprint_center(origin: Cell, size: [u16; 2]) -> FxVec2 {
    FxVec2::new(
        Fx::from_raw(origin.x * 65536 + i32::from(size[0]) * 32768),
        Fx::from_raw(origin.y * 65536 + i32::from(size[1]) * 32768),
    )
}

/// Distance from `pos` to the footprint rectangle `[ox, ox + w] x [oy, oy + h]`
/// (tiles): the clamped nearest point, then `(pos - nearest).length()`. Zero
/// when `pos` lies inside the rectangle.
pub fn footprint_distance(pos: FxVec2, origin: Cell, size: [u16; 2]) -> Fx {
    let min_x = origin.x * 65536;
    let max_x = (origin.x + i32::from(size[0])) * 65536;
    let min_y = origin.y * 65536;
    let max_y = (origin.y + i32::from(size[1])) * 65536;
    let nearest = FxVec2::new(
        Fx::from_raw(pos.x.raw().clamp(min_x, max_x)),
        Fx::from_raw(pos.y.raw().clamp(min_y, max_y)),
    );
    (pos - nearest).length()
}

/// Nearest passable cell to the footprint's approach point (front-center):
/// `nav.nearest_passable(Cell { x: ox + w / 2, y: oy + h / 2 })`.
pub fn approach_cell(nav: &MapGrid, origin: Cell, size: [u16; 2]) -> Option<Cell> {
    nav.nearest_passable(Cell {
        x: origin.x + i32::from(size[0]) / 2,
        y: origin.y + i32::from(size[1]) / 2,
    })
}

/// Nearest passable cell to the footprint's exit point (rear-center):
/// `nav.nearest_passable(Cell { x: ox + w / 2, y: oy + h })`.
pub fn exit_cell(nav: &MapGrid, origin: Cell, size: [u16; 2]) -> Option<Cell> {
    nav.nearest_passable(Cell {
        x: origin.x + i32::from(size[0]) / 2,
        y: origin.y + i32::from(size[1]),
    })
}
