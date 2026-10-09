//! Map grid and the built-in tech-slice layout.

use crate::fixed::FxVec2;

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
    pub fn open(_width: u16, _height: u16) -> MapGrid {
        todo!()
    }
    pub fn tech_slice() -> MapGrid {
        todo!()
    }
    pub fn width(&self) -> u16 {
        todo!()
    }
    pub fn height(&self) -> u16 {
        todo!()
    }
    pub fn in_bounds(&self, _cell: Cell) -> bool {
        todo!()
    }
    pub fn set_blocked(&mut self, _cell: Cell, _blocked: bool) {
        todo!()
    }
    pub fn is_passable(&self, _cell: Cell) -> bool {
        todo!()
    }
    pub fn index(&self, _cell: Cell) -> CellIndex {
        todo!()
    }
    pub fn cell(&self, _index: CellIndex) -> Cell {
        todo!()
    }
    pub fn tiles(&self) -> Vec<u8> {
        todo!()
    }
    pub fn nearest_passable(&self, _cell: Cell) -> Option<Cell> {
        todo!()
    }
}

pub fn cell_of(_pos: FxVec2) -> Cell {
    todo!()
}

pub fn cell_center(_cell: Cell) -> FxVec2 {
    todo!()
}
