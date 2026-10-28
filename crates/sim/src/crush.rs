//! Vehicles driving over infantry (spec 28): tracked hulls crush enemy
//! soldiers, wheeled ones shove them aside and hurt them.

use crate::entity::Entity;
use crate::features::{distance_to_rect, extent};
use crate::fixed::{Fx, FxVec2};
use crate::map::cell_of;
use crate::rules::FeatureBlocks;
use crate::rules::{LocoKind, Motion, Ruleset};
use crate::world::{Layer, World};

/// Extra reach of a hull against map features (a quarter tile): a tank
/// stopped against a tree, whose cell it cannot enter, still crushes it.
const FEATURE_REACH: Fx = Fx::from_raw(16384);

/// Velocity of a hull this tick (spec 11 §5.2): along the heading, backwards
/// while reversing.
fn velocity(unit: &Entity) -> FxVec2 {
    let forward = unit.heading.dir().scale(unit.speed);
    if unit.reversing {
        FxVec2::ZERO - forward
    } else {
        forward
    }
}

/// The motion profile of a live, moving vehicle that can run soldiers over.
fn runner<'a>(rules: &'a Ruleset, unit: &Entity) -> Option<&'a Motion> {
    if unit.site.is_some() || unit.hp == 0 || unit.speed <= Fx::ZERO {
        return None;
    }
    let motion = &rules.ty(unit.kind).motion;
    let vehicle = matches!(motion.kind, LocoKind::Tracks | LocoKind::Wheels);
    (vehicle && (motion.crusher_level > 0 || motion.shove_damage > 0)).then_some(motion)
}

/// A soldier on foot (Zero Hour `CrushableLevel = 0`).
fn crushable(rules: &Ruleset, unit: &Entity) -> bool {
    unit.site.is_none()
        && unit.inside.is_none()
        && unit.hp > 0
        && rules.ty(unit.kind).motion.kind == LocoKind::Foot
}

/// `a.x * b.x + a.y * b.y` in raw fixed point, widened so it cannot overflow.
fn dot(a: FxVec2, b: FxVec2) -> i64 {
    i64::from(a.x.raw()) * i64::from(b.x.raw()) + i64::from(a.y.raw()) * i64::from(b.y.raw())
}

impl World {
    /// `true` when `a` would crush `b` on contact, so the two must not be
    /// pushed apart (Zero Hour `checkForOverlapCollision`: the crushee is
    /// passive to the overlap). Used by the separation phase.
    pub(crate) fn crushes(&self, a: usize, b: usize) -> bool {
        let (crusher, victim) = (&self.entities[a], &self.entities[b]);
        crusher.owner != victim.owner
            && runner(&self.rules, crusher).is_some_and(|m| m.crusher_level > 0)
            && crushable(&self.rules, victim)
    }

    /// Phase 2b (after movement, before separation): every moving vehicle
    /// runs over the enemy soldiers in its way. A crusher kills a soldier
    /// whose centre is inside its footprint while it drives toward him
    /// (Zero Hour `SquishCollide::onCollide`); a non-crusher with a shove
    /// throws a touching soldier aside and deals `shove_damage`.
    pub(crate) fn run_over(&mut self) {
        let radius = self.unit_radii();
        for a in 0..self.entities.len() {
            let Some(motion) = runner(&self.rules, &self.entities[a]).copied() else {
                continue;
            };
            let velocity = velocity(&self.entities[a]);
            for b in 0..self.entities.len() {
                let (vehicle, soldier) = (&self.entities[a], &self.entities[b]);
                if vehicle.owner == soldier.owner || !crushable(&self.rules, soldier) {
                    continue;
                }
                let offset = soldier.pos - vehicle.pos;
                if dot(offset, velocity) <= 0 {
                    continue;
                }
                let d = offset.length();
                if motion.crusher_level > 0 {
                    if d < radius[a] {
                        self.entities[b].hp = 0;
                        self.entities[b].last_hit = None;
                    }
                } else if d < radius[a] + radius[b] {
                    self.shove(b, velocity, offset, radius[a] + radius[b], &motion);
                }
            }
        }
    }

    /// Spec 31 block 1: every moving vehicle flattens the features in its way.
    /// A crusher whose level reaches the feature's `crushLevel` destroys it; a
    /// wheeled vehicle with a shove damages the ones that do not block. The
    /// feature must be within the hull radius and ahead of the vehicle (a cone
    /// of 45 degrees around its velocity), or under it.
    pub(crate) fn crush_features(&mut self) {
        let radius = self.unit_radii();
        let mut hits: Vec<(usize, u32)> = Vec::new();
        for (a, hull) in radius.iter().enumerate() {
            let Some(motion) = runner(&self.rules, &self.entities[a]).copied() else {
                continue;
            };
            let (pos, velocity) = (self.entities[a].pos, velocity(&self.entities[a]));
            let speed2 = i128::from(dot(velocity, velocity));
            for (index, row) in self.features.iter().enumerate() {
                let def = &self.rules.feature_types[row.kind as usize];
                if !row.alive || def.hp == 0 || def.crush_level == 0 || row.collapse > 0 {
                    continue;
                }
                let flatten = motion.crusher_level >= def.crush_level;
                if !flatten && !(motion.shove_damage > 0 && def.blocks == FeatureBlocks::None) {
                    continue;
                }
                let rect = extent(def, row);
                let distance = distance_to_rect(pos, rect);
                if distance >= *hull + FEATURE_REACH {
                    continue;
                }
                if distance > Fx::ZERO {
                    let center = FxVec2::new(
                        Fx::from_raw((rect.0 + rect.2 + 1) * (Fx::from_int(1).raw() / 2)),
                        Fx::from_raw((rect.1 + rect.3 + 1) * (Fx::from_int(1).raw() / 2)),
                    );
                    let offset = center - pos;
                    let ahead = i128::from(dot(offset, velocity));
                    if ahead <= 0 || 2 * ahead * ahead <= i128::from(dot(offset, offset)) * speed2 {
                        continue;
                    }
                }
                hits.push((index, if flatten { row.hp } else { motion.shove_damage }));
            }
        }
        for (index, amount) in hits {
            self.damage_feature(index, amount);
        }
    }

    /// Throws soldier `b` sideways out of the path (`velocity`) of the vehicle
    /// at `-offset` from him, clear of its `reach`, and damages him.
    fn shove(&mut self, b: usize, velocity: FxVec2, offset: FxVec2, reach: Fx, motion: &Motion) {
        let soldier = &mut self.entities[b];
        soldier.hp = soldier.hp.saturating_sub(motion.shove_damage);
        let side = FxVec2::new(Fx::ZERO - velocity.y, velocity.x).normalize();
        // Away from the vehicle's centre line; dead centre goes left or right by id.
        let lateral = dot(offset, side);
        let side = if lateral > 0 || (lateral == 0 && soldier.id.is_multiple_of(2)) {
            side
        } else {
            FxVec2::ZERO - side
        };
        // Distance from the centre line (`side` is a unit vector), then out
        // to `reach` plus the push.
        let off_line = Fx::from_raw((lateral.abs() >> Fx::FRAC_BITS) as i32);
        let aside = (reach - off_line).max(Fx::ZERO) + motion.shove_push;
        let target = soldier.pos + side.scale(aside);
        if self.grid(Layer::Foot).is_passable(cell_of(target)) {
            self.entities[b].pos = target;
        }
    }
}
