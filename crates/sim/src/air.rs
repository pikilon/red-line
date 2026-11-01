//! Air power, one-way units, sorties, launched drones and jamming (spec 43).
//!
//! Flyers (`LocoKind::Air`) fly straight over everything and never separate or
//! crush. A flyer is *airborne* while it is under way or away from its base; a
//! parked one is an ordinary ground target (§4.1). A `oneWay` unit detonates
//! its warhead where it arrives, or where it runs out of fuel, and dies with no
//! death of its own (§4.2). A `sortie` flyer spends a round per shot, flies home
//! when empty or idle and reloads there (§4.3). A weapon that `launches` a unit
//! spawns it with an attack order and the shooter as its master (§4.4). Hostile
//! jammers stop `radio` ground units, drop `radio` flyers and throw `gnss`
//! warheads off target (§4.5). Everything is integer and fixed point; the only
//! randomness is stateless and seeded from the tick and the entity id.

use crate::angle::{Angle, atan2};
use crate::entity::{EntityId, NEUTRAL, Order};
use crate::fixed::{Fx, FxVec2};
use crate::rng::SplitMix64;
use crate::rules::{AirClass, AntiAir, Link, TypeId, WeaponDef, fx_centi};
use crate::world::{CombatEvent, MAX_UNITS, TICK_RATE_HZ, World};

/// Distance from a base's footprint within which a flyer is docked (parked).
pub const DOCK_RANGE_CENTI: u32 = 250;
/// Distance from a base's footprint at which a returning flyer lands.
const LAND_CENTI: u32 = 100;
/// A one-way unit detonates when this close to its target (or one step, if more).
const CONTACT_CENTI: u32 = 60;
/// A ground one-way unit is kept off its target by separation, so it goes off
/// from further out.
const GROUND_CONTACT_CENTI: u32 = 100;
/// Spec 43 §4.3 (Zero Hour `OutOfAmmoDamagePerSecond`): percent of the maximum
/// hit points a flyer with no base to land at loses every second.
pub const STARVE_PERCENT_PER_SECOND: u32 = 5;
/// A flyer whose heading is further than this (angle units, 45 degrees) from
/// its goal flies at a quarter of its speed, so it always closes in.
const SHARP_TURN: i32 = 8192;

/// What a flyer does with its tick.
enum Plan {
    /// Stay where it is.
    Hold,
    /// The order is over: back to `Idle`.
    Finish(u32),
    /// Fly towards `goal`; `entity` is an entity whose footprint distance
    /// replaces the distance to `goal` in the `within` test.
    Go {
        goal: FxVec2,
        entity: Option<usize>,
        within: Fx,
        arrival: Arrival,
    },
}

/// What happens when a `Plan::Go` gets `within` its goal.
enum Arrival {
    /// The order ends and the flyer goes idle.
    Done(u32),
    /// The warhead goes off (when armed), against the ordered target if any.
    Detonate(Option<EntityId>),
    /// The flyer stops there and keeps its order (it fires from there).
    Stay,
}

impl World {
    /// Spec 43 §4.1: whether entity `index` is airborne: a flyer that is under
    /// way, or idle away from its base. A parked aircraft, a missile on its
    /// rail and everything on the ground are not.
    pub(crate) fn airborne(&self, index: usize) -> bool {
        let entity = &self.entities[index];
        if entity.site.is_some() || !self.rules.ty(entity.kind).is_air() {
            return false;
        }
        // An empty aircraft docked with an attack remembered is waiting to reload.
        let waiting = self.rules.ty(entity.kind).sortie.is_some()
            && entity.ammo == 0
            && matches!(
                entity.order,
                Order::Attack { .. } | Order::AttackGround { .. }
            );
        if matches!(entity.order, Order::Idle { .. }) || waiting {
            return self.dock_of(index).is_none();
        }
        true
    }

    /// Spec 43 §4.1: whether the entity `id` is airborne.
    pub fn is_airborne(&self, id: EntityId) -> bool {
        self.index_of(id).is_some_and(|index| self.airborne(index))
    }

    /// Spec 43 §4.1: whether `weapon` can engage entity `target` at all, by
    /// height: airborne targets need `antiAir` of their class, everything else
    /// (a parked aircraft included) needs `antiGround`.
    pub(crate) fn can_engage(&self, weapon: &WeaponDef, target: usize) -> bool {
        let ty = self.rules.ty(self.entities[target].kind);
        if ty.is_air() && self.airborne(target) {
            match weapon.anti_air {
                AntiAir::None => false,
                AntiAir::Low => ty.motion.air_class == AirClass::Low,
                AntiAir::All => true,
            }
        } else {
            weapon.anti_ground
        }
    }

    /// Spec 43 §4.1 `lowObservable`: an enemy weapon engages it only inside a
    /// third of its range.
    pub(crate) fn reach_against(&self, range: Fx, target: usize) -> Fx {
        if self.rules.ty(self.entities[target].kind).low_observable {
            Fx::from_raw(range.raw() / 3)
        } else {
            range
        }
    }

    /// The nearest own complete building that produces `entity`'s type, as
    /// `(building index, footprint distance)`; ties go to the lowest index.
    pub(crate) fn nearest_base(&self, index: usize) -> Option<(usize, Fx)> {
        let entity = &self.entities[index];
        let mut best: Option<(usize, Fx)> = None;
        for (base, building) in self.entities.iter().enumerate() {
            let complete = building.site.as_ref().is_some_and(|site| site.complete);
            if building.owner != entity.owner
                || building.hp == 0
                || !complete
                || !self.rules.ty(building.kind).produces.contains(&entity.kind)
            {
                continue;
            }
            let distance = self.entity_distance(entity.pos, building);
            if best.is_none_or(|(_, d)| distance < d) {
                best = Some((base, distance));
            }
        }
        best
    }

    /// The base entity `index` is docked at (within `DOCK_RANGE_CENTI`).
    fn dock_of(&self, index: usize) -> Option<usize> {
        self.nearest_base(index)
            .filter(|&(_, distance)| distance <= fx_centi(DOCK_RANGE_CENTI))
            .map(|(base, _)| base)
    }

    /// Spec 43 §4.5: whether a hostile jammer reaches entity `index`. Only
    /// `radio` and `gnss` units are ever jammed.
    pub(crate) fn jammed(&self, index: usize) -> bool {
        let entity = &self.entities[index];
        if !matches!(self.rules.ty(entity.kind).link, Link::Radio | Link::Gnss) {
            return false;
        }
        self.entities.iter().any(|jammer| {
            let complete = jammer.site.as_ref().is_none_or(|site| site.complete);
            jammer.hp > 0
                && complete
                && jammer.owner != entity.owner
                && jammer.owner != NEUTRAL
                && self.rules.ty(jammer.kind).jammer.is_some_and(|def| {
                    (jammer.pos - entity.pos).length() <= fx_centi(def.radius_centi)
                })
        })
    }

    /// Spec 43 §4.5: whether the entity `id` is inside a hostile jammer's radius.
    pub fn is_jammed(&self, id: EntityId) -> bool {
        self.index_of(id).is_some_and(|index| self.jammed(index))
    }

    /// Spec 43 §4.5: a ground `radio` unit inside a hostile jammer's radius
    /// cannot move or fire.
    pub(crate) fn jam_stopped(&self, index: usize) -> bool {
        let ty = self.rules.ty(self.entities[index].kind);
        !ty.is_air() && ty.link == Link::Radio && self.jammed(index)
    }

    /// Spec 43 §4.2: whether the warhead of a one-way unit is armed.
    pub(crate) fn armed_warhead(&self, index: usize) -> bool {
        let entity = &self.entities[index];
        let ty = self.rules.ty(entity.kind);
        let Some(one_way) = ty.one_way else {
            return false;
        };
        let arm_ticks = (one_way.arm_tiles * 100).div_ceil(ty.speed_centi.max(1));
        entity.fuel >= arm_ticks
    }

    /// The air phase, run before movement: control links, fuel, launched
    /// drones looking for a new target, and sortie bookkeeping.
    pub(crate) fn air_pass(&mut self) {
        for index in 0..self.entities.len() {
            if self.entities[index].hp == 0 || self.entities[index].site.is_some() {
                continue;
            }
            let kind = self.entities[index].kind;
            let (link, is_air, one_way, sortie) = {
                let ty = self.rules.ty(kind);
                (ty.link, ty.is_air(), ty.one_way, ty.sortie)
            };
            // §4.4: a drone somebody steers falls, harmless, when its master dies.
            if let Some(master) = self.entities[index].master
                && matches!(link, Link::Radio | Link::Fibre)
                && self.entity(master).is_none_or(|master| master.hp == 0)
            {
                self.fall_harmless(index);
                continue;
            }
            // §4.5: a jammed `radio` flyer falls, harmless.
            if is_air && link == Link::Radio && self.jammed(index) {
                self.fall_harmless(index);
                continue;
            }
            if let Some(one_way) = one_way {
                let under_way = if is_air {
                    self.airborne(index)
                } else {
                    !matches!(self.entities[index].order, Order::Idle { .. })
                };
                if under_way {
                    self.entities[index].fuel = self.entities[index].fuel.saturating_add(1);
                    // §4.2: out of fuel, it falls and detonates where it is.
                    if one_way.fuel_ticks > 0 && self.entities[index].fuel >= one_way.fuel_ticks {
                        self.detonate(index, None);
                        continue;
                    }
                }
                if self.entities[index].master.is_some()
                    && matches!(self.entities[index].order, Order::Idle { .. })
                {
                    self.retarget_launched(index);
                }
            }
            if sortie.is_some() {
                self.sortie_step(index);
            }
        }
    }

    /// A unit that dies with no explosion and no killer.
    fn fall_harmless(&mut self, index: usize) {
        self.entities[index].hp = 0;
        self.entities[index].last_hit = None;
    }

    /// Spec 43 §4.3 for entity `index`: reload and repair at a base, fly
    /// home when idle away from it, starve when there is no base at all.
    fn sortie_step(&mut self, index: usize) {
        let kind = self.entities[index].kind;
        let (sortie, max_hp) = {
            let ty = self.rules.ty(kind);
            let Some(sortie) = ty.sortie else {
                return;
            };
            (sortie, ty.hp)
        };
        let order = self.entities[index].order;
        let empty = self.entities[index].ammo == 0;
        let remembered =
            empty && matches!(order, Order::Attack { .. } | Order::AttackGround { .. });
        let wants_base =
            matches!(order, Order::Idle { .. } | Order::ReturnToBase { .. }) || remembered;
        if !wants_base {
            return;
        }
        if self.dock_of(index).is_some() {
            let entity = &mut self.entities[index];
            if entity.ammo < sortie.clip || entity.hp < max_hp {
                entity.reload += 1;
                // Repaired evenly: the missing hit points over the ticks left.
                let left = sortie.reload_ticks.saturating_sub(entity.reload - 1).max(1);
                let heal = max_hp.saturating_sub(entity.hp).div_ceil(left);
                entity.hp = entity.hp.saturating_add(heal).min(max_hp);
                if entity.reload >= sortie.reload_ticks {
                    entity.ammo = sortie.clip;
                    entity.hp = max_hp;
                    entity.reload = 0;
                }
            }
            return;
        }
        self.entities[index].reload = 0;
        if self.nearest_base(index).is_some() {
            if matches!(order, Order::Idle { .. }) {
                let order_id = self.next_order_id;
                self.next_order_id += 1;
                self.entities[index].order = Order::ReturnToBase { order_id };
            }
        } else if self.tick.is_multiple_of(TICK_RATE_HZ) {
            // No base: it stays up and burns, 5 % of its hit points a second.
            let loss = (max_hp * STARVE_PERCENT_PER_SECOND / 100).max(1);
            let entity = &mut self.entities[index];
            entity.hp = entity.hp.saturating_sub(loss);
            entity.last_hit = None;
        }
    }

    /// A launched drone without a target picks the nearest visible enemy
    /// inside its sight that its warhead can engage.
    fn retarget_launched(&mut self, index: usize) {
        let entity = &self.entities[index];
        let ty = self.rules.ty(entity.kind);
        let Some(one_way) = ty.one_way else {
            return;
        };
        let warhead = &self.rules.weapons[usize::from(one_way.warhead)];
        let sight = fx_centi(ty.sight_centi);
        let mut best: Option<(Fx, usize)> = None;
        for (other, target) in self.entities.iter().enumerate() {
            if target.hp == 0
                || target.contained()
                || target.owner == entity.owner
                || target.owner == NEUTRAL
                || !self.can_engage(warhead, other)
                || self
                    .rules
                    .modifier(warhead.damage_type, self.rules.ty(target.kind).armor)
                    == 0
                || !self.is_entity_visible(entity.owner, target.id)
            {
                continue;
            }
            let distance = self.entity_distance(entity.pos, target);
            if distance <= sight && best.is_none_or(|(d, _)| distance < d) {
                best = Some((distance, other));
            }
        }
        if let Some((_, target)) = best {
            let order_id = self.next_order_id;
            self.next_order_id += 1;
            let target = self.entities[target].id;
            self.entities[index].order = Order::Attack { order_id, target };
        }
    }

    /// Spec 43 §4.2: the one-way unit `index` goes off where it is. It dies
    /// with no death explosion of its own; the warhead does the damage. A
    /// jammed `gnss` unit lands up to `gnssScatterCenti` off; a warhead with
    /// scatter is inaccurate by itself. `target` is the ordered victim of a
    /// warhead without splash.
    pub(crate) fn detonate(&mut self, index: usize, target: Option<EntityId>) {
        let (id, kind, owner, pos) = {
            let entity = &self.entities[index];
            (entity.id, entity.kind, entity.owner, entity.pos)
        };
        let ty = self.rules.ty(kind);
        let Some(one_way) = ty.one_way else {
            return;
        };
        let (link, gnss_scatter) = (ty.link, ty.gnss_scatter_centi);
        let weapon_id = one_way.warhead;
        let warhead = self.rules.weapons[usize::from(weapon_id)].clone();
        let tick = self.tick;
        let mut impact = pos + self.scatter(&warhead, id, tick, 0);
        if link == Link::Gnss && gnss_scatter > 0 && self.jammed(index) {
            impact = impact + disc_offset(id, tick, gnss_scatter);
        }
        // Dead first: the unit is not its own victim and draws no retaliation.
        self.entities[index].hp = 0;
        self.entities[index].last_hit = Some((id, weapon_id));
        self.hit_features(impact, &warhead);
        let hit = if warhead.splash_centi > 0 {
            self.apply_splash(id, weapon_id, &warhead, impact);
            None
        } else {
            let ordered = target
                .and_then(|target| self.index_of(target))
                .filter(|&t| {
                    self.entities[t].hp > 0
                        && self.can_engage(&warhead, t)
                        && self.entity_distance(impact, &self.entities[t])
                            <= fx_centi(CONTACT_CENTI) + fx_centi(CONTACT_CENTI)
                });
            ordered
                .or_else(|| self.direct_hit(id, &warhead, impact))
                .map(|t| {
                    let hit = self.entities[t].id;
                    self.apply_hit(id, t, weapon_id, &warhead);
                    hit
                })
        };
        self.events.push(CombatEvent::Detonate {
            projectile: u32::MAX,
            owner,
            weapon: weapon_id,
            pos: impact,
            hit,
        });
    }

    /// Spec 43 §4.4: firing a `launches` weapon spawns the unit `kind` next to
    /// the shooter, owned by the same player, with an attack order on the
    /// target (a ground point when `target` is `None`) and the shooter as its
    /// master.
    pub(crate) fn launch_drone(
        &mut self,
        shooter: usize,
        kind: TypeId,
        target: Option<usize>,
        aim: FxVec2,
    ) {
        if self.entities.len() as u32 >= MAX_UNITS {
            return;
        }
        let (owner, pos, master) = {
            let entity = &self.entities[shooter];
            (entity.owner, entity.pos, entity.id)
        };
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        let order = match target {
            Some(target) => Order::Attack {
                order_id,
                target: self.entities[target].id,
            },
            None => Order::AttackGround {
                order_id,
                target: aim,
            },
        };
        let hp = self.rules.ty(kind).hp;
        let id = self.push_entity(owner, kind, pos, hp, None);
        if let Some(drone) = self.index_of(id) {
            let offset = aim - pos;
            let drone = &mut self.entities[drone];
            drone.order = order;
            drone.master = Some(master);
            drone.heading = atan2(offset.x, offset.y);
        }
    }

    /// One tick of flight for the flyer at `index` (spec 43 §4.1).
    pub(crate) fn fly(&mut self, index: usize) {
        match self.plan_flight(index) {
            Plan::Hold => self.entities[index].speed = Fx::ZERO,
            Plan::Finish(order_id) => {
                let entity = &mut self.entities[index];
                entity.speed = Fx::ZERO;
                entity.order = Order::Idle {
                    last_order_id: order_id,
                };
            }
            Plan::Go {
                goal,
                entity,
                within,
                arrival,
            } => self.fly_towards(index, goal, entity, within, arrival),
        }
    }

    /// What the flyer at `index` does this tick, from its order.
    fn plan_flight(&self, index: usize) -> Plan {
        let entity = &self.entities[index];
        let ty = self.rules.ty(entity.kind);
        let speed = ty.motion.max_speed;
        let contact = fx_centi(CONTACT_CENTI).max(speed);
        // An empty clip heads home and keeps the order for the next sortie.
        if ty.sortie.is_some()
            && entity.ammo == 0
            && matches!(
                entity.order,
                Order::Attack { .. } | Order::AttackGround { .. }
            )
        {
            return self.plan_home(index, None);
        }
        match entity.order {
            Order::Move {
                order_id, target, ..
            } => Plan::Go {
                goal: target,
                entity: None,
                within: speed,
                arrival: Arrival::Done(order_id),
            },
            Order::ReturnToBase { order_id } => self.plan_home(index, Some(order_id)),
            Order::Attack { order_id, target } => {
                let Some(victim) = self.index_of(target).filter(|&t| self.entities[t].hp > 0)
                else {
                    return Plan::Finish(order_id);
                };
                let goal = self.entities[victim].pos;
                if ty.one_way.is_some() {
                    return Plan::Go {
                        goal,
                        entity: Some(victim),
                        within: contact,
                        arrival: Arrival::Detonate(Some(target)),
                    };
                }
                let Some(weapon) = self.rules.weapon_of(entity.kind) else {
                    return Plan::Hold;
                };
                Plan::Go {
                    goal,
                    entity: Some(victim),
                    within: self.reach_against(fx_centi(weapon.range_centi), victim),
                    arrival: Arrival::Stay,
                }
            }
            Order::AttackGround { target, .. } => {
                if ty.one_way.is_some() {
                    return Plan::Go {
                        goal: target,
                        entity: None,
                        within: contact,
                        arrival: Arrival::Detonate(None),
                    };
                }
                let Some(weapon) = self.rules.weapon_of(entity.kind) else {
                    return Plan::Hold;
                };
                Plan::Go {
                    goal: target,
                    entity: None,
                    within: fx_centi(weapon.range_centi),
                    arrival: Arrival::Stay,
                }
            }
            _ => Plan::Hold,
        }
    }

    /// Flight home: to the nearest own base, landing within `LAND_CENTI` of
    /// it. `order_id` is the `ReturnToBase` order that ends on landing; `None`
    /// is a remembered attack that just holds there.
    fn plan_home(&self, index: usize, order_id: Option<u32>) -> Plan {
        let Some((base, distance)) = self.nearest_base(index) else {
            return order_id.map_or(Plan::Hold, Plan::Finish);
        };
        if distance <= fx_centi(LAND_CENTI) {
            return order_id.map_or(Plan::Hold, Plan::Finish);
        }
        Plan::Go {
            goal: self.entities[base].pos,
            entity: Some(base),
            within: fx_centi(LAND_CENTI),
            arrival: order_id.map_or(Arrival::Stay, Arrival::Done),
        }
    }

    /// Moves flyer `index` one tick towards `goal` (heading turns at the
    /// type's rate, the flyer moves along it) and handles the arrival.
    fn fly_towards(
        &mut self,
        index: usize,
        goal: FxVec2,
        entity: Option<usize>,
        within: Fx,
        arrival: Arrival,
    ) {
        let motion = self.rules.ty(self.entities[index].kind).motion;
        let pos = self.entities[index].pos;
        let offset = goal - pos;
        let to_goal = offset.length();
        let distance = match entity {
            Some(other) => self.entity_distance(pos, &self.entities[other]),
            None => to_goal,
        };
        let bearing = atan2(offset.x, offset.y);
        if distance <= within {
            match arrival {
                Arrival::Done(order_id) => {
                    let unit = &mut self.entities[index];
                    if entity.is_none() && to_goal <= motion.max_speed {
                        unit.pos = goal;
                    }
                    unit.speed = Fx::ZERO;
                    unit.order = Order::Idle {
                        last_order_id: order_id,
                    };
                    return;
                }
                Arrival::Stay => {
                    let unit = &mut self.entities[index];
                    unit.speed = Fx::ZERO;
                    if entity.is_some_and(|other| other != index) && to_goal > Fx::ZERO {
                        unit.heading = unit.heading.turn_towards(bearing, motion.turn_step);
                    }
                    return;
                }
                Arrival::Detonate(target) => {
                    if self.armed_warhead(index) {
                        self.detonate(index, target);
                        return;
                    }
                }
            }
        }
        // Terminal approach: within two steps it flies straight at the goal.
        let unit = &mut self.entities[index];
        let two_steps = motion.max_speed + motion.max_speed;
        unit.heading = if to_goal <= two_steps {
            bearing
        } else {
            unit.heading.turn_towards(bearing, motion.turn_step)
        };
        let step = if unit.heading.delta(bearing).abs() > SHARP_TURN {
            Fx::from_raw(motion.max_speed.raw() / 4)
        } else {
            motion.max_speed
        };
        let next = unit.pos + unit.heading.dir().scale(step);
        unit.speed = step;
        let max_x = i32::from(self.nav.width()) * 65536 - 1;
        let max_y = i32::from(self.nav.height()) * 65536 - 1;
        let unit = &mut self.entities[index];
        unit.pos = FxVec2::new(
            Fx::from_raw(next.x.raw().clamp(0, max_x)),
            Fx::from_raw(next.y.raw().clamp(0, max_y)),
        );
    }

    /// Spec 43 §4.2 for a ground one-way unit (and the point it drives to):
    /// detonates when armed and within contact of `target`.
    pub(crate) fn ground_contact(&mut self, index: usize, target: Option<EntityId>, point: FxVec2) {
        let pos = self.entities[index].pos;
        let speed = self.rules.ty(self.entities[index].kind).motion.max_speed;
        let contact = fx_centi(GROUND_CONTACT_CENTI).max(speed);
        let distance = match target.and_then(|id| self.entity(id)) {
            Some(entity) => self.entity_distance(pos, entity),
            None => (point - pos).length(),
        };
        if distance <= contact && self.armed_warhead(index) {
            self.detonate(index, target);
        }
    }

    /// Whether entity `index` is a flyer.
    pub(crate) fn is_flyer(&self, index: usize) -> bool {
        self.rules.ty(self.entities[index].kind).is_air()
    }
}

/// A seeded point in the disc of `radius_centi` around the origin.
fn disc_offset(id: EntityId, tick: u32, radius_centi: u32) -> FxVec2 {
    let mut rng = SplitMix64::new((u64::from(tick) << 32) ^ (u64::from(id) << 8) ^ 0x6a);
    let u = Fx::from_raw((rng.next_u32() % 65537) as i32);
    let r = fx_centi(radius_centi).mul(u.sqrt());
    let angle = Angle((rng.next_u32() >> 16) as u16);
    angle.dir().scale(r)
}
