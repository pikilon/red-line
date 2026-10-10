//! Map grid and the built-in tech-slice layout.

use crate::fixed::{Fx, FxVec2};

pub type CellIndex = u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Cell {
    pub x: i32,
    pub y: i32,
}

pub const TECH_SLICE_SIZE: u16 = 128;
pub const SPAWN_MIN: Cell = Cell { x: 4, y: 4 };
pub const SPAWN_MAX: Cell = Cell { x: 56, y: 123 };

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapGrid {
    width: u16,
    height: u16,
    blocked: Vec<bool>,
}

impl MapGrid {
    /// A grid where every cell is passable.
    pub fn open(width: u16, height: u16) -> MapGrid {
        MapGrid {
            width,
            height,
            blocked: vec![false; usize::from(width) * usize::from(height)],
        }
    }

    /// The built-in 128 x 128 tech-slice layout.
    pub fn tech_slice() -> MapGrid {
        let mut map = MapGrid::open(TECH_SLICE_SIZE, TECH_SLICE_SIZE);
        let last = i32::from(TECH_SLICE_SIZE) - 1;
        for y in 0..=last {
            for x in 0..=last {
                let border = x == 0 || y == 0 || x == last || y == last;
                let wall = (60..=63).contains(&x) && !(60..=67).contains(&y);
                let block_a = (30..=37).contains(&x) && (30..=37).contains(&y);
                let block_b = (90..=97).contains(&x) && (80..=95).contains(&y);
                if border || wall || block_a || block_b {
                    map.set_blocked(Cell { x, y }, true);
                }
            }
        }
        map
    }

    pub fn width(&self) -> u16 {
        self.width
    }

    pub fn height(&self) -> u16 {
        self.height
    }

    pub fn in_bounds(&self, cell: Cell) -> bool {
        cell.x >= 0
            && cell.y >= 0
            && cell.x < i32::from(self.width)
            && cell.y < i32::from(self.height)
    }

    /// Panics when `cell` is out of bounds.
    pub fn set_blocked(&mut self, cell: Cell, blocked: bool) {
        assert!(self.in_bounds(cell), "cell {cell:?} is out of bounds");
        let index = self.index(cell) as usize;
        self.blocked[index] = blocked;
    }

    /// Out-of-bounds cells are not passable.
    pub fn is_passable(&self, cell: Cell) -> bool {
        self.in_bounds(cell) && !self.blocked[self.index(cell) as usize]
    }

    pub fn index(&self, cell: Cell) -> CellIndex {
        (cell.y as u32) * u32::from(self.width) + (cell.x as u32)
    }

    pub fn cell(&self, index: CellIndex) -> Cell {
        let width = u32::from(self.width);
        Cell {
            x: (index % width) as i32,
            y: (index / width) as i32,
        }
    }

    /// Row-major tiles: 0 passable, 1 blocked.
    pub fn tiles(&self) -> Vec<u8> {
        self.blocked.iter().map(|&b| u8::from(b)).collect()
    }

    /// Scans rings of Chebyshev distance 0, 1, 2, ... up to max(width, height),
    /// each in row-major order, and returns the first passable cell.
    pub fn nearest_passable(&self, cell: Cell) -> Option<Cell> {
        let max_r = i32::from(self.width.max(self.height));
        self.ring_search(cell, max_r, |_| true)
    }

    /// Spec 04 §5.1: visits the cells at Chebyshev distance `0..=max_r` from
    /// `cell`, each ring row-major (`y` ascending, then `x` ascending; only the
    /// two side cells of inner rows), and returns the first passable cell that
    /// `accept` admits.
    pub fn ring_search(
        &self,
        cell: Cell,
        max_r: i32,
        mut accept: impl FnMut(Cell) -> bool,
    ) -> Option<Cell> {
        for r in 0..=max_r {
            for y in (cell.y - r)..=(cell.y + r) {
                let full_row = (y - cell.y).abs() == r;
                let step = if full_row || r == 0 { 1 } else { 2 * r };
                let mut x = cell.x - r;
                while x <= cell.x + r {
                    let candidate = Cell { x, y };
                    if self.is_passable(candidate) && accept(candidate) {
                        return Some(candidate);
                    }
                    x += step;
                }
            }
        }
        None
    }
}

pub fn cell_of(pos: FxVec2) -> Cell {
    Cell {
        x: pos.x.floor_to_int(),
        y: pos.y.floor_to_int(),
    }
}

pub fn cell_center(cell: Cell) -> FxVec2 {
    FxVec2::new(
        Fx::from_raw((cell.x << 16) + 32768),
        Fx::from_raw((cell.y << 16) + 32768),
    )
}
