//! Spec 04 §5.3: idle allies step out of a moving unit's way, as Zero Hour's
//! `Pathfinder::moveAllies` / `getMoveAwayFromPath` do.

use std::collections::BTreeSet;

use crate::entity::Order;
use crate::fixed::{Fx, FxVec2};
use crate::flow::FlowField;
use crate::locomotor;
use crate::map::{Cell, cell_center, cell_of};
use crate::rules::LocoKind;
use crate::world::World;

/// How far ahead of a moving unit idle allies are asked to step aside.
pub const YIELD_LOOKAHEAD: Fx = Fx::from_raw(3 * 65536);
/// How far ahead the cell a yielder steps to must stay clear of the path.
pub const YIELD_CLEARANCE_LOOKAHEAD: Fx = Fx::from_raw(6 * 65536);
/// Largest Chebyshev ring searched for the cell a yielder steps to.
pub const YIELD_SEARCH_RING: i32 = 4;

impl World {
    /// Phase 2a: every unit on a `Move` order looks `YIELD_LOOKAHEAD` along its
    /// path; each idle ally of the same owner whose body overlaps that path
    /// receives a short move to the nearest free cell clear of it.
    pub(crate) fn yield_to_movers(&mut self) {
        let positions: Vec<FxVec2> = self.entities.iter().map(|unit| unit.pos).collect();
        let buckets = self.bucket_by_cell(&positions);
        let radius = self.unit_radii();
        let mut claimed: BTreeSet<Cell> = BTreeSet::new();
        for m in 0..self.entities.len() {
            let mover = &self.entities[m];
            let Order::Move {
                order_id,
                target,
                goal,
            } = mover.order
            else {
                continue;
            };
            if mover.site.is_some() {
                continue;
            }
            let owner = mover.owner;
            let mover_foot = self.is_foot(m);
            let path = self.path_ahead(positions[m], target, goal, YIELD_LOOKAHEAD);
            let candidates: BTreeSet<usize> = path
                .iter()
                .flat_map(|&point| self.neighbours(&buckets, cell_of(point)))
                .collect();
            let mut clearance: Option<Vec<FxVec2>> = None;
            for b in candidates {
                let other = &self.entities[b];
                let asked = b != m
                    && other.owner == owner
                    && other.site.is_none()
                    && other.inside.is_none()
                    && other.last_target.is_none()
                    && matches!(other.order, Order::Idle { last_order_id } if last_order_id != order_id)
                    && !(mover_foot && self.is_foot(b));
                let reach = radius[m] + radius[b];
                if !asked || !path_hits(&path, positions[b], reach) {
                    continue;
                }
                let clear = clearance.get_or_insert_with(|| {
                    self.path_ahead(positions[m], target, goal, YIELD_CLEARANCE_LOOKAHEAD)
                });
                let others = self.bodies_around(b, &positions, &radius, &buckets);
                let Some(cell) = self.yield_cell(
                    positions[b],
                    positions[m],
                    clear,
                    reach,
                    goal,
                    &buckets,
                    &claimed,
                    &others,
                ) else {
                    continue;
                };
                claimed.insert(cell);
                self.order_yield(b, cell);
            }
        }
    }

    /// Spec 04 §5.4: true when the step of unit `index` (on a `Move` order
    /// `order_id`) from `from` to `to` would push into a unit that is moving on
    /// a newer `Move` order (one stepping out of its way, or any later order)
    /// and is not heading toward it. Such a unit waits instead of driving
    /// through, as Zero Hour's blocked units slow down behind the unit ahead.
    /// Order ids only grow, so the waits never form a cycle.
    pub(crate) fn blocked_by_newer_mover(
        &self,
        index: usize,
        order_id: u32,
        from: FxVec2,
        to: FxVec2,
    ) -> bool {
        let own = self.radius_of(index);
        self.entities.iter().enumerate().any(|(j, other)| {
            let Order::Move {
                order_id: newer,
                target,
                ..
            } = other.order
            else {
                return false;
            };
            if j == index || other.site.is_some() || newer <= order_id {
                return false;
            }
            let at = other.pos;
            let reach = own + self.radius_of(j);
            let after = (to - at).length();
            after < reach && after < (from - at).length() && dot(target - at, from - at) <= 0
        })
    }

    fn radius_of(&self, index: usize) -> Fx {
        match self.rules.ty(self.entities[index].kind).radius_centi {
            0 => Fx::from_raw(crate::world::SEPARATION_DISTANCE.raw() / 2),
            centi => crate::rules::fx_centi(centi),
        }
    }

    fn is_foot(&self, index: usize) -> bool {
        self.rules.ty(self.entities[index].kind).motion.kind == LocoKind::Foot
    }

    /// Points of the path a unit at `pos` follows toward `target`, cut after
    /// `budget` tiles: straight when the line is passable or inside the goal
    /// cell, otherwise flow-field steps between cell centres.
    fn path_ahead(&self, pos: FxVec2, target: FxVec2, goal: Cell, budget: Fx) -> Vec<FxVec2> {
        let mut points = vec![pos];
        let mut current = pos;
        let mut left = budget;
        let field = self.fields.get(&self.nav.index(goal));
        while left > Fx::ZERO {
            let cell = cell_of(current);
            let next = if cell == goal || self.nav.line_passable(current, target) {
                target
            } else {
                match field.and_then(|field| field.direction(cell)) {
                    Some(dir) => {
                        let (dx, dy) = dir.offset();
                        cell_center(Cell {
                            x: cell.x + dx,
                            y: cell.y + dy,
                        })
                    }
                    None => break,
                }
            };
            let step = (next - current).length();
            if step == Fx::ZERO {
                break;
            }
            if step >= left {
                points.push(current + (next - current).normalize().scale(left));
                break;
            }
            points.push(next);
            if next == target {
                break;
            }
            left = left - step;
            current = next;
        }
        points
    }

    /// Units near the yielder (cells within `YIELD_SEARCH_RING + 1`) that it
    /// must not drive through, as position and the distance its centre must
    /// keep (both radii): every unit except the yielder and idle units of its
    /// owner, which are asked to step aside in turn when it moves.
    fn bodies_around(
        &self,
        yielder: usize,
        positions: &[FxVec2],
        radius: &[Fx],
        buckets: &[Vec<usize>],
    ) -> Vec<(FxVec2, Fx)> {
        let home = cell_of(positions[yielder]);
        let owner = self.entities[yielder].owner;
        let span = YIELD_SEARCH_RING + 1;
        let mut bodies = Vec::new();
        for y in home.y - span..=home.y + span {
            for x in home.x - span..=home.x + span {
                let cell = Cell { x, y };
                if !self.nav.in_bounds(cell) {
                    continue;
                }
                for &i in &buckets[self.nav.index(cell) as usize] {
                    let other = &self.entities[i];
                    let idle_ally =
                        other.owner == owner && matches!(other.order, Order::Idle { .. });
                    if i != yielder && other.site.is_none() && !idle_ally {
                        bodies.push((positions[i], radius[yielder] + radius[i]));
                    }
                }
            }
        }
        bodies
    }

    /// The nearest free cell (Chebyshev rings 1..=`YIELD_SEARCH_RING` around
    /// the yielder, closest centre first, ties by row then column) that is
    /// passable, straight-line reachable, holds no unit, is not the mover's
    /// goal nor claimed this tick, is not on the mover's side of the yielder,
    /// whose centre keeps `reach` off `path`, and whose straight drive from
    /// `pos` keeps clear of every body in `others`.
    #[allow(clippy::too_many_arguments)]
    fn yield_cell(
        &self,
        pos: FxVec2,
        mover: FxVec2,
        path: &[FxVec2],
        reach: Fx,
        goal: Cell,
        buckets: &[Vec<usize>],
        claimed: &BTreeSet<Cell>,
        others: &[(FxVec2, Fx)],
    ) -> Option<Cell> {
        let home = cell_of(pos);
        for ring in 1..=YIELD_SEARCH_RING {
            let mut best: Option<(i64, i32, i32, Cell)> = None;
            for dy in -ring..=ring {
                for dx in -ring..=ring {
                    if dx.abs().max(dy.abs()) != ring {
                        continue;
                    }
                    let cell = Cell {
                        x: home.x + dx,
                        y: home.y + dy,
                    };
                    if !self.nav.in_bounds(cell)
                        || !self.nav.is_passable(cell)
                        || cell == goal
                        || claimed.contains(&cell)
                        || !buckets[self.nav.index(cell) as usize].is_empty()
                    {
                        continue;
                    }
                    let center = cell_center(cell);
                    let drive = [pos, center];
                    if path_hits(path, center, reach)
                        || dot(center - pos, mover - pos) > 0
                        || !self.nav.line_passable(pos, center)
                        || others.iter().any(|&(at, gap)| path_hits(&drive, at, gap))
                    {
                        continue;
                    }
                    let key = (distance_sq(pos, center), cell.y, cell.x, cell);
                    if best.is_none_or(|current| key < current) {
                        best = Some(key);
                    }
                }
            }
            if let Some((.., cell)) = best {
                return Some(cell);
            }
        }
        None
    }

    /// Gives unit `index` a move to the centre of `cell` under a fresh order id.
    fn order_yield(&mut self, index: usize, cell: Cell) {
        let map = &self.nav;
        self.fields
            .entry(map.index(cell))
            .or_insert_with(|| FlowField::compute(map, cell));
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        let target = cell_center(cell);
        let motion = self.rules.ty(self.entities[index].kind).motion;
        let unit = &mut self.entities[index];
        unit.order = Order::Move {
            order_id,
            target,
            goal: cell,
        };
        unit.reversing = locomotor::wants_reverse(&motion, unit.pos, unit.heading, target);
    }
}

/// Exact dot product of two vectors on raw values.
fn dot(a: FxVec2, b: FxVec2) -> i128 {
    i128::from(a.x.raw()) * i128::from(b.x.raw()) + i128::from(a.y.raw()) * i128::from(b.y.raw())
}

fn distance_sq(a: FxVec2, b: FxVec2) -> i64 {
    let dx = i64::from(a.x.raw() - b.x.raw());
    let dy = i64::from(a.y.raw() - b.y.raw());
    dx * dx + dy * dy
}

/// True when `point` lies closer than `reach` to any segment of `path`
/// (exact integer arithmetic on raw values).
fn path_hits(path: &[FxVec2], point: FxVec2, reach: Fx) -> bool {
    let reach = i128::from(reach.raw());
    let limit = reach * reach;
    path.windows(2).any(|segment| {
        let (a, b) = (segment[0], segment[1]);
        let (ax, ay) = (i128::from(a.x.raw()), i128::from(a.y.raw()));
        let dx = i128::from(b.x.raw()) - ax;
        let dy = i128::from(b.y.raw()) - ay;
        let wx = i128::from(point.x.raw()) - ax;
        let wy = i128::from(point.y.raw()) - ay;
        let along = wx * dx + wy * dy;
        let length_sq = dx * dx + dy * dy;
        let ww = wx * wx + wy * wy;
        let distance_sq = if along <= 0 || length_sq == 0 {
            ww
        } else if along >= length_sq {
            let ex = wx - dx;
            let ey = wy - dy;
            ex * ex + ey * ey
        } else {
            ww - along * along / length_sq
        };
        distance_sq < limit
    })
}
