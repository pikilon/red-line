//! Flow fields: cost, integration and direction passes over a `MapGrid`.

use crate::fixed::FxVec2;
use crate::map::{Cell, MapGrid};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Dir8 {
    N,
    NE,
    E,
    SE,
    S,
    SW,
    W,
    NW,
}

pub const COST_ORTHOGONAL: u32 = 10;
pub const COST_DIAGONAL: u32 = 14;
pub const UNREACHABLE: u32 = u32::MAX;
pub const DIAGONAL_COMPONENT: i32 = 46341;

impl Dir8 {
    pub const ALL: [Dir8; 8] = [
        Dir8::N,
        Dir8::NE,
        Dir8::E,
        Dir8::SE,
        Dir8::S,
        Dir8::SW,
        Dir8::W,
        Dir8::NW,
    ];

    pub const fn offset(self) -> (i32, i32) {
        (0, 0)
    }

    pub const fn is_diagonal(self) -> bool {
        false
    }

    pub const fn cost(self) -> u32 {
        COST_ORTHOGONAL
    }

    pub fn unit_vector(self) -> FxVec2 {
        FxVec2::ZERO
    }
}

#[derive(Clone, Debug)]
pub struct FlowField {
    goal: Cell,
    width: u16,
    height: u16,
    integration: Vec<u32>,
    directions: Vec<Option<Dir8>>,
}

impl FlowField {
    pub fn compute(map: &MapGrid, goal: Cell) -> FlowField {
        let len = usize::from(map.width()) * usize::from(map.height());
        FlowField {
            goal,
            width: map.width(),
            height: map.height(),
            integration: vec![UNREACHABLE; len],
            directions: vec![None; len],
        }
    }

    pub fn goal(&self) -> Cell {
        self.goal
    }

    pub fn integration(&self, _cell: Cell) -> u32 {
        let _ = (self.width, self.height, &self.integration);
        0
    }

    pub fn direction(&self, _cell: Cell) -> Option<Dir8> {
        let _ = &self.directions;
        Some(Dir8::N)
    }
}

pub fn can_step(_map: &MapGrid, _from: Cell, _dir: Dir8) -> bool {
    true
}
