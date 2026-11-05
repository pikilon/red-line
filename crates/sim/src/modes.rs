//! Spec 49: Zero Hour unit behaviour orders, attack-move and guard.

use crate::entity::{EntityId, NEUTRAL, Order, PlayerId};
use crate::fixed::{Fx, FxVec2};
use crate::map::{Cell, cell_of};
use crate::rules::fx_centi;
use crate::world::World;

/// A guarding unit closer than this to its post counts as standing on it.
const GUARD_POST_SLACK: Fx = Fx::from_raw(65536 / 8);

impl World {
    /// Spec 49 §3.1: the listed units move as for `Move` (same goals and
    /// spread); the armed ground units among them attack-move instead.
    pub(crate) fn apply_attack_move(
        &mut self,
        player: PlayerId,
        units: &[EntityId],
        target: FxVec2,
    ) {
        let first = self.next_order_id;
        self.apply_move(player, units, target);
        self.convert_moves(player, units, first, |order_id, target, goal| {
            Order::AttackMove {
                order_id,
                target,
                goal,
                engaging: None,
            }
        });
    }

    /// Spec 49 §3.2: the listed units move to the point as for `Move`; each
    /// armed ground unit guards the spot it was sent to (its post).
    pub(crate) fn apply_guard(&mut self, player: PlayerId, units: &[EntityId], target: FxVec2) {
        let first = self.next_order_id;
        self.apply_move(player, units, target);
        self.convert_moves(player, units, first, |order_id, post, _| Order::Guard {
            order_id,
            post,
            target: None,
            chase: 0,
        });
    }

    /// Turns the `Move` orders given since order id `first` to the armed
    /// ground units of `player` in `units` into `make(order_id, target, goal)`.
    fn convert_moves(
        &mut self,
        player: PlayerId,
        units: &[EntityId],
        first: u32,
        make: impl Fn(u32, FxVec2, Cell) -> Order,
    ) {
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            let entity = &self.entities[index];
            let ty = self.rules.ty(entity.kind);
            if entity.owner != player || !ty.is_armed() || ty.is_air() {
                continue;
            }
            if let Order::Move {
                order_id,
                target,
                goal,
            } = entity.order
                && order_id >= first
            {
                self.entities[index].order = make(order_id, target, goal);
                self.entities[index].reversing = false;
            }
        }
    }

    /// Spec 49 §3.1 step: keep fighting the engaged enemy while it is alive
    /// and within acquisition range, else pick the nearest visible enemy in
    /// range, else move on toward the destination.
    pub(crate) fn step_attack_move(&mut self, index: usize) {
        let Order::AttackMove {
            order_id,
            target,
            goal,
            engaging,
        } = self.entities[index].order
        else {
            return;
        };
        let pos = self.entities[index].pos;
        let reach = self.acquire_range(index);
        let engaging = engaging
            .filter(|&enemy| self.can_fight(index, enemy, pos, reach))
            .or_else(|| self.acquire(index, pos, reach, true));
        self.entities[index].order = Order::AttackMove {
            order_id,
            target,
            goal,
            engaging,
        };
        if let Some(enemy) = engaging {
            self.step_attack(index, order_id, enemy);
            return;
        }
        let layer = self.layer_of(index);
        self.field(layer, goal);
        self.step_move(index, order_id, target, goal);
    }

    /// Spec 49 §3.2 step: chase the guard target while it stays inside the
    /// outer radius of the post and chase time is left (refilled while it is
    /// inside the inner radius); otherwise pick the nearest visible enemy
    /// inside the inner radius; otherwise walk back to the post.
    pub(crate) fn step_guard(&mut self, index: usize) {
        let Order::Guard {
            order_id,
            post,
            target,
            chase,
        } = self.entities[index].order
        else {
            return;
        };
        let guard = self.rules.guard;
        let sight = self.acquire_range(index);
        let inner = percent_of(sight, guard.inner_percent);
        let outer = percent_of(sight, guard.outer_percent);
        let mut chase = chase;
        let mut target =
            target.filter(|&enemy| chase > 0 && self.can_fight(index, enemy, post, outer));
        if let Some(enemy) = target {
            let near = self
                .entity(enemy)
                .is_some_and(|entity| self.entity_distance(post, entity) <= inner);
            chase = if near { guard.chase_ticks } else { chase - 1 };
        } else {
            // Zero Hour's guard scan has no fog filter (`AIGuard.cpp` `lookForInnerTarget`).
            target = self.acquire(index, post, inner, false);
            chase = if target.is_some() {
                guard.chase_ticks
            } else {
                0
            };
        }
        self.entities[index].order = Order::Guard {
            order_id,
            post,
            target,
            chase,
        };
        if let Some(enemy) = target {
            self.step_attack(index, order_id, enemy);
            return;
        }
        let pos = self.entities[index].pos;
        if cell_of(pos) != cell_of(post) {
            self.step_toward_goal(index, cell_of(post));
        } else if (post - pos).length() > GUARD_POST_SLACK {
            self.step_to_point(index, post);
        }
    }

    /// Spec 49 §3: how far a unit looks for enemies on its own, its sight or
    /// its weapon range when that is longer (artillery).
    fn acquire_range(&self, index: usize) -> Fx {
        let kind = self.entities[index].kind;
        let sight = self.rules.ty(kind).sight_centi;
        let range = self
            .rules
            .weapon_of(kind)
            .map_or(0, |weapon| weapon.range_centi);
        fx_centi(sight.max(range))
    }

    /// The nearest enemy that unit `index` can fight within `radius` of
    /// `center` (and, with `seen`, that its owner sees); ties go to the
    /// lowest id.
    fn acquire(&self, index: usize, center: FxVec2, radius: Fx, seen: bool) -> Option<EntityId> {
        let owner = self.entities[index].owner;
        let mut best: Option<(Fx, EntityId)> = None;
        for target in &self.entities {
            if !self.can_fight(index, target.id, center, radius)
                || (seen && !self.is_entity_visible(owner, target.id))
            {
                continue;
            }
            let distance = self.entity_distance(center, target);
            if best.is_none_or(|(nearest, _)| distance < nearest) {
                best = Some((distance, target.id));
            }
        }
        best.map(|(_, id)| id)
    }

    /// Whether unit `index` can hurt `enemy`, an alive, uncontained enemy
    /// entity within `radius` of `center`.
    fn can_fight(&self, index: usize, enemy: EntityId, center: FxVec2, radius: Fx) -> bool {
        let unit = &self.entities[index];
        let Some(target_index) = self.index_of(enemy) else {
            return false;
        };
        let target = &self.entities[target_index];
        if target.hp == 0
            || target.contained()
            || target.owner == unit.owner
            || target.owner == NEUTRAL
        {
            return false;
        }
        let Some(weapon) = self.rules.weapon_of(unit.kind) else {
            return false;
        };
        self.rules
            .modifier(weapon.damage_type, self.rules.ty(target.kind).armor)
            > 0
            && self.can_engage(weapon, target_index)
            && self.entity_distance(center, target) <= radius
    }
}

/// `value * percent / 100`, in raw fixed point.
fn percent_of(value: Fx, percent: u32) -> Fx {
    Fx::from_raw((i64::from(value.raw()) * i64::from(percent) / 100) as i32)
}
