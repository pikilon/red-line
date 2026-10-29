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
    /// Corner heights in `HEIGHT_STEPS_PER_TILE`ths of a tile, row-major over
    /// `(width + 1) x (height + 1)`; empty for a flat map (spec 30 §3).
    heights: Vec<u8>,
    /// Spec 26 Phase 1 layers, one byte per cell in `index` order; empty when
    /// the map has no `terrain:` section. Stored for later phases (speed on
    /// roads and shallows, vehicle-only water); only deep water changes
    /// passability today.
    ground: Vec<u8>,
    roads: Vec<u8>,
    water: Vec<u8>,
    /// Bridge decks, one byte per cell (0 none); empty without bridges
    /// (spec 26 section 17).
    bridges: Vec<u8>,
    /// Spec 36: cells blocked only because they are deep water (empty without
    /// deep water); the amphibious grid opens them.
    water_blocked: Vec<bool>,
}

/// Low two bits of a water byte: 0 dry, 1 shallow, 2 deep (blocks ground movers).
pub const WATER_DEPTH_MASK: u8 = 3;
pub const WATER_SHALLOW: u8 = 1;
pub const WATER_DEEP: u8 = 2;
/// Bits 2-3 of a water byte: 0 none, 1 river, 2 lake, 3 sea.
pub const WATER_KIND_SHIFT: u8 = 2;

/// Height steps per tile: one byte per corner, 1/16 tile each, like Zero
/// Hour's `MAP_HEIGHT_SCALE = MAP_XY_FACTOR / 16` (spec 30 §2).
pub const HEIGHT_STEPS_PER_TILE: i32 = 16;
/// A cell whose four corners spread by at least this many steps is a cliff:
/// Zero Hour's `PATHFIND_CLIFF_SLOPE_LIMIT_F = 9.8` world units over 0.625 per
/// step, so a spread of 16 (10 units) is the first that counts (spec 30 §2).
pub const CLIFF_SPREAD: u8 = 16;

impl MapGrid {
    /// A grid where every cell is passable.
    pub fn open(width: u16, height: u16) -> MapGrid {
        MapGrid {
            width,
            height,
            blocked: vec![false; usize::from(width) * usize::from(height)],
            heights: Vec::new(),
            ground: Vec::new(),
            roads: Vec::new(),
            water: Vec::new(),
            bridges: Vec::new(),
            water_blocked: Vec::new(),
        }
    }

    /// Stores the ground, road and water layers (each empty or one byte per
    /// cell) and blocks every deep-water cell like a rock (spec 26 Phase 1).
    /// Panics on a layer of the wrong length.
    pub fn set_layers(&mut self, ground: Vec<u8>, roads: Vec<u8>, water: Vec<u8>) {
        let cells = usize::from(self.width) * usize::from(self.height);
        for layer in [&ground, &roads, &water] {
            assert!(
                layer.is_empty() || layer.len() == cells,
                "a terrain layer must cover every cell"
            );
        }
        self.water_blocked = Vec::new();
        for (i, byte) in water.iter().enumerate() {
            if byte & WATER_DEPTH_MASK == WATER_DEEP {
                if !self.blocked[i] {
                    self.water_blocked.resize(cells, false);
                    self.water_blocked[i] = true;
                }
                self.blocked[i] = true;
            }
        }
        self.ground = ground;
        self.roads = roads;
        self.water = water;
    }

    /// Stores the bridge deck layer (empty or one byte per cell) and opens
    /// every deck cell that deep water blocks: the deck is a road over the
    /// water (spec 26 section 17). Call after `set_layers` and `set_heights`;
    /// the data compiler guarantees the deck sits on no rock, cliff or
    /// footprint. Panics on a layer of the wrong length.
    pub fn set_bridges(&mut self, bridges: Vec<u8>) {
        let cells = usize::from(self.width) * usize::from(self.height);
        assert!(
            bridges.is_empty() || bridges.len() == cells,
            "the bridge layer must cover every cell"
        );
        for (i, byte) in bridges.iter().enumerate() {
            let deep = self
                .water
                .get(i)
                .is_some_and(|w| w & WATER_DEPTH_MASK == WATER_DEEP);
            if *byte != 0 && deep {
                self.blocked[i] = false;
            }
        }
        self.bridges = bridges;
    }

    /// Bridge type index plus one when `cell` is a bridge deck, 0 otherwise.
    pub fn bridge_at(&self, cell: Cell) -> u8 {
        self.layer_at(&self.bridges, cell)
    }

    /// Blocks every in-map cell of the `w x h` footprint at `origin`.
    pub fn block_footprint(&mut self, origin: Cell, w: i32, h: i32) {
        for y in origin.y..origin.y + h {
            for x in origin.x..origin.x + w {
                let cell = Cell { x, y };
                if self.in_bounds(cell) {
                    self.set_blocked(cell, true);
                }
            }
        }
    }

    fn layer_at(&self, layer: &[u8], cell: Cell) -> u8 {
        if layer.is_empty() || !self.in_bounds(cell) {
            return 0;
        }
        layer[self.index(cell) as usize]
    }

    /// Ground material id of `cell` (index into the ruleset `layerNames.ground`);
    /// 0 (the default grass) without a `terrain:` section.
    pub fn ground_at(&self, cell: Cell) -> u8 {
        self.layer_at(&self.ground, cell)
    }

    /// Road type id of `cell`: 0 none, 1 asphalt, 2 dirt.
    pub fn road_at(&self, cell: Cell) -> u8 {
        self.layer_at(&self.roads, cell)
    }

    /// Water byte of `cell`: `depth | kind << WATER_KIND_SHIFT`, 0 when dry.
    pub fn water_at(&self, cell: Cell) -> u8 {
        self.layer_at(&self.water, cell)
    }

    /// 0 dry, `WATER_SHALLOW` or `WATER_DEEP`.
    pub fn water_depth_at(&self, cell: Cell) -> u8 {
        self.water_at(cell) & WATER_DEPTH_MASK
    }

    /// Gives the grid its corner heights and blocks every cliff cell (spec 30
    /// §3). Panics unless `heights` is empty or `(width + 1) * (height + 1)`
    /// long.
    pub fn set_heights(&mut self, heights: Vec<u8>) {
        if heights.is_empty() {
            self.heights = heights;
            return;
        }
        let stride = usize::from(self.width) + 1;
        assert_eq!(
            heights.len(),
            stride * (usize::from(self.height) + 1),
            "heights must cover every corner"
        );
        self.heights = heights;
        for y in 0..i32::from(self.height) {
            for x in 0..i32::from(self.width) {
                let cell = Cell { x, y };
                if self.is_cliff(cell) {
                    self.set_blocked(cell, true);
                }
            }
        }
    }

    /// Corner heights, row-major over `(width + 1) x (height + 1)`; empty when
    /// the map is flat.
    pub fn heights(&self) -> &[u8] {
        &self.heights
    }

    /// Height steps of corner `(x, y)`, clamped to the map edge; 0 on a flat map.
    pub fn corner_height(&self, x: i32, y: i32) -> u8 {
        if self.heights.is_empty() {
            return 0;
        }
        let x = x.clamp(0, i32::from(self.width)) as usize;
        let y = y.clamp(0, i32::from(self.height)) as usize;
        self.heights[y * (usize::from(self.width) + 1) + x]
    }

    /// Zero Hour's `setCellCliffFlagFromHeights`: the spread of the cell's four
    /// corners reaches `CLIFF_SPREAD`.
    pub fn is_cliff(&self, cell: Cell) -> bool {
        if self.heights.is_empty() || !self.in_bounds(cell) {
            return false;
        }
        let corners = [
            self.corner_height(cell.x, cell.y),
            self.corner_height(cell.x + 1, cell.y),
            self.corner_height(cell.x, cell.y + 1),
            self.corner_height(cell.x + 1, cell.y + 1),
        ];
        let max = corners.iter().copied().max().unwrap_or(0);
        let min = corners.iter().copied().min().unwrap_or(0);
        max - min >= CLIFF_SPREAD
    }

    /// Ground height at `pos`, in tiles: the plane of the cell triangle `pos`
    /// lies in, split along the `(x, y)`-`(x + 1, y + 1)` diagonal like Zero
    /// Hour's `getHeightMapHeight` (and the client mesh). Integer only.
    pub fn ground_height(&self, pos: FxVec2) -> Fx {
        if self.heights.is_empty() {
            return Fx::ZERO;
        }
        let max_x = i32::from(self.width) << 16;
        let max_y = i32::from(self.height) << 16;
        let px = pos.x.raw().clamp(0, max_x);
        let py = pos.y.raw().clamp(0, max_y);
        let cx = (px >> 16).min(i32::from(self.width) - 1);
        let cy = (py >> 16).min(i32::from(self.height) - 1);
        let fx = i64::from(px - (cx << 16));
        let fy = i64::from(py - (cy << 16));
        let h = |dx: i32, dy: i32| i64::from(self.corner_height(cx + dx, cy + dy));
        let (h00, h10, h01, h11) = (h(0, 0), h(1, 0), h(0, 1), h(1, 1));
        // Steps x 65536, then / 16 steps per tile = tiles in Q16.16.
        let steps = if fx >= fy {
            (h00 << 16) + (h10 - h00) * fx + (h11 - h10) * fy
        } else {
            (h00 << 16) + (h11 - h01) * fx + (h01 - h00) * fy
        };
        Fx::from_raw((steps / i64::from(HEIGHT_STEPS_PER_TILE)) as i32)
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

    /// Spec 36: whether some cell is blocked only by deep water.
    pub fn has_deep_water(&self) -> bool {
        self.water_blocked.iter().any(|&b| b)
    }

    /// Spec 36: this grid with every cell that only deep water blocked open,
    /// the terrain an amphibious vehicle drives on.
    pub fn with_open_water(&self) -> MapGrid {
        let mut grid = self.clone();
        for (i, &water) in self.water_blocked.iter().enumerate() {
            if water {
                grid.blocked[i] = false;
            }
        }
        grid
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

    /// Whether every cell the segment `from`–`to` crosses is passable (spec 11
    /// §5.2): an integer grid walk; where it crosses a cell corner exactly,
    /// both side cells must be passable too.
    pub fn line_passable(&self, from: FxVec2, to: FxVec2) -> bool {
        line_all(from, to, |cell| self.is_passable(cell))
    }
}

/// The grid walk of `line_passable` with any cell test: whether `clear` holds
/// for every cell the segment `from`-`to` crosses (and, where it crosses a
/// corner exactly, for both side cells).
pub fn line_all(from: FxVec2, to: FxVec2, clear: impl Fn(Cell) -> bool) -> bool {
    {
        let mut cell = cell_of(from);
        let end = cell_of(to);
        if !clear(cell) {
            return false;
        }
        let dx = i64::from(to.x.raw()) - i64::from(from.x.raw());
        let dy = i64::from(to.y.raw()) - i64::from(from.y.raw());
        let (step_x, step_y) = (dx.signum() as i32, dy.signum() as i32);
        while cell != end {
            // Distance along each axis from `from` to the next boundary; the
            // boundary reached first is the smaller distance over |d|.
            let next_x = i64::from(cell.x + i32::from(step_x > 0)) << 16;
            let next_y = i64::from(cell.y + i32::from(step_y > 0)) << 16;
            let to_x = (next_x - i64::from(from.x.raw())).abs() * dy.abs();
            let to_y = (next_y - i64::from(from.y.raw())).abs() * dx.abs();
            let ordering = if step_x == 0 {
                core::cmp::Ordering::Greater
            } else if step_y == 0 {
                core::cmp::Ordering::Less
            } else {
                to_x.cmp(&to_y)
            };
            cell = match ordering {
                core::cmp::Ordering::Less => Cell {
                    x: cell.x + step_x,
                    y: cell.y,
                },
                core::cmp::Ordering::Greater => Cell {
                    x: cell.x,
                    y: cell.y + step_y,
                },
                core::cmp::Ordering::Equal => {
                    let side_x = Cell {
                        x: cell.x + step_x,
                        y: cell.y,
                    };
                    let side_y = Cell {
                        x: cell.x,
                        y: cell.y + step_y,
                    };
                    if !clear(side_x) || !clear(side_y) {
                        return false;
                    }
                    Cell {
                        x: cell.x + step_x,
                        y: cell.y + step_y,
                    }
                }
            };
            if !clear(cell) {
                return false;
            }
        }
        true
    }
}

impl MapGrid {
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
