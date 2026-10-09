//! Flow fields: cost, integration and direction passes over a `MapGrid`.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, CellIndex, MapGrid};

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
        match self {
            Dir8::N => (0, -1),
            Dir8::NE => (1, -1),
            Dir8::E => (1, 0),
            Dir8::SE => (1, 1),
            Dir8::S => (0, 1),
            Dir8::SW => (-1, 1),
            Dir8::W => (-1, 0),
            Dir8::NW => (-1, -1),
        }
    }

    pub const fn is_diagonal(self) -> bool {
        let (dx, dy) = self.offset();
        dx != 0 && dy != 0
    }

    pub const fn cost(self) -> u32 {
        if self.is_diagonal() {
            COST_DIAGONAL
        } else {
            COST_ORTHOGONAL
        }
    }

    /// Orthogonal: components 0 / ±65536. Diagonal: components ±46341.
    pub fn unit_vector(self) -> FxVec2 {
        let (dx, dy) = self.offset();
        let magnitude = if self.is_diagonal() {
            DIAGONAL_COMPONENT
        } else {
            Fx::ONE.raw()
        };
        FxVec2::new(Fx::from_raw(dx * magnitude), Fx::from_raw(dy * magnitude))
    }
}

fn neighbour(cell: Cell, dir: Dir8) -> Cell {
    let (dx, dy) = dir.offset();
    Cell {
        x: cell.x + dx,
        y: cell.y + dy,
    }
}

/// True iff a unit may move from `from` one step in `dir`: the target cell is
/// passable and, for diagonals, both orthogonally adjacent cells are passable
/// (no corner cutting).
pub fn can_step(map: &MapGrid, from: Cell, dir: Dir8) -> bool {
    let (dx, dy) = dir.offset();
    let target = neighbour(from, dir);
    if !map.is_passable(target) {
        return false;
    }
    !dir.is_diagonal()
        || (map.is_passable(Cell {
            x: from.x + dx,
            y: from.y,
        }) && map.is_passable(Cell {
            x: from.x,
            y: from.y + dy,
        }))
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
        let mut integration = vec![UNREACHABLE; len];
        let mut directions = vec![None; len];
        if !map.is_passable(goal) {
            return FlowField {
                goal,
                width: map.width(),
                height: map.height(),
                integration,
                directions,
            };
        }

        // Integration pass: Dijkstra from the goal.
        let goal_index = map.index(goal);
        integration[goal_index as usize] = 0;
        let mut heap: BinaryHeap<Reverse<(u32, CellIndex)>> = BinaryHeap::new();
        heap.push(Reverse((0, goal_index)));
        while let Some(Reverse((cost, index))) = heap.pop() {
            if cost > integration[index as usize] {
                continue;
            }
            let cell = map.cell(index);
            for dir in Dir8::ALL {
                if !can_step(map, cell, dir) {
                    continue;
                }
                let next = map.index(neighbour(cell, dir));
                let next_cost = cost + dir.cost();
                if next_cost < integration[next as usize] {
                    integration[next as usize] = next_cost;
                    heap.push(Reverse((next_cost, next)));
                }
            }
        }

        // Direction pass: cheapest step, ties to the earliest `Dir8::ALL` entry.
        for index in 0..len {
            if index == goal_index as usize || integration[index] == UNREACHABLE {
                continue;
            }
            let cell = map.cell(index as CellIndex);
            let mut best: Option<(u32, Dir8)> = None;
            for dir in Dir8::ALL {
                if !can_step(map, cell, dir) {
                    continue;
                }
                let via = integration[map.index(neighbour(cell, dir)) as usize];
                if via == UNREACHABLE {
                    continue;
                }
                let total = via + dir.cost();
                if best.is_none_or(|(cost, _)| total < cost) {
                    best = Some((total, dir));
                }
            }
            directions[index] = best.map(|(_, dir)| dir);
        }

        FlowField {
            goal,
            width: map.width(),
            height: map.height(),
            integration,
            directions,
        }
    }

    pub fn goal(&self) -> Cell {
        self.goal
    }

    fn slot(&self, cell: Cell) -> Option<usize> {
        let in_bounds = cell.x >= 0
            && cell.y >= 0
            && cell.x < i32::from(self.width)
            && cell.y < i32::from(self.height);
        in_bounds.then(|| (cell.y as usize) * usize::from(self.width) + cell.x as usize)
    }

    /// `UNREACHABLE` if out of bounds, blocked or unreachable.
    pub fn integration(&self, cell: Cell) -> u32 {
        self.slot(cell)
            .map_or(UNREACHABLE, |slot| self.integration[slot])
    }

    /// `None` at the goal, blocked or unreachable cells.
    pub fn direction(&self, cell: Cell) -> Option<Dir8> {
        self.slot(cell).and_then(|slot| self.directions[slot])
    }
}
