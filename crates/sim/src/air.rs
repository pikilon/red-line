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
use crate::map::cell_of;
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
/// its goal flies slowly (a quarter of its speed for a rotorcraft, its minimum
/// speed for a fixed-wing flyer), so it always closes in.
const SHARP_TURN: i32 = 8192;
/// A quarter turn in angle units.
const QUARTER_TURN: i32 = 16384;
/// `65536 / (2 pi)`: turning radius = speed * this / turn step per tick.
const RADIUS_PER_STEP: i64 = 10430;
/// Angle units in a full turn.
const TURN_UNITS: i32 = 65536;

/// A fixed-wing flyer's pursuit of a goal (spec 43 §4.1).
#[derive(Clone, Copy)]
struct Chase {
    /// An entity whose footprint distance replaces the distance to the goal.
    entity: Option<usize>,
    /// Arrival distance.
    within: Fx,
}

impl Chase {
    /// Distance from `pos` to the goal.
    fn distance(&self, world: &World, pos: FxVec2, goal: FxVec2) -> Fx {
        match self.entity {
            Some(other) => world.entity_distance(pos, &world.entities[other]),
            None => (goal - pos).length(),
        }
    }
}

/// The heading and speed of a fixed-wing flyer at `pos` and `heading` pursuing
/// `goal`: turned towards it by at most the turn step, at its top speed or, in
/// a sharp turn (a tighter circle), at its minimum.
fn wing_steer(
    motion: &crate::rules::Motion,
    pos: FxVec2,
    heading: Angle,
    goal: FxVec2,
) -> (Angle, Fx) {
    let offset = goal - pos;
    let bearing = if offset == FxVec2::ZERO {
        heading
    } else {
        atan2(offset.x, offset.y)
    };
    let speed = if heading.delta(bearing).abs() > SHARP_TURN {
        motion.min_speed
    } else {
        motion.max_speed
    };
    (heading.turn_towards(bearing, motion.turn_step), speed)
}

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
    /// The flyer stops there and keeps its order (it fires from there). A
    /// fixed-wing flyer never stops: it flies on past the target and comes round.
    Stay,
    /// A fixed-wing flyer circles the goal until it gets another order.
    Orbit,
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
            // A drone no launcher fired and no building produces (a save placed
            // it) waits on the ground for an order instead of burning its fuel.
            let ty = self.rules.ty(entity.kind);
            if ty.one_way.is_some() && entity.master.is_none() && self.nearest_base(index).is_none()
            {
                return false;
            }
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
            self.charges_step(index);
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

    /// Spec 43 §4.4: whether the launcher at `index` has no charge to launch
    /// with. Only types with `charges` can be empty.
    pub(crate) fn out_of_charges(&self, index: usize) -> bool {
        let entity = &self.entities[index];
        self.rules.ty(entity.kind).charges.is_some() && entity.charges == 0
    }

    /// Spec 43 §4.4: whether an own `resupplies` unit or building is within
    /// `radius_centi` of the entity at `index`.
    pub(crate) fn resupplied(&self, index: usize, radius_centi: u32) -> bool {
        let entity = &self.entities[index];
        self.entities.iter().any(|source| {
            source.hp > 0
                && source.owner == entity.owner
                && source.id != entity.id
                && !source.contained()
                && source.site.as_ref().is_none_or(|site| site.complete)
                && self.rules.ty(source.kind).resupplies
                && self.entity_distance(entity.pos, source) <= fx_centi(radius_centi)
        })
    }

    /// Spec 43 §4.4: a launcher refills one charge every `refillTicks`, next to
    /// an own supply source (`refillRadiusCenti`) or by itself (a nest). An empty
    /// unit drops its attack order: it idles, and can still be ordered about.
    fn charges_step(&mut self, index: usize) {
        let entity = &self.entities[index];
        let Some(charges) = self.rules.ty(entity.kind).charges else {
            return;
        };
        if entity.hp == 0 || entity.contained() || entity.site.as_ref().is_some_and(|s| !s.complete)
        {
            return;
        }
        if entity.charges == 0
            && entity.site.is_none()
            && let Order::Attack { order_id, .. } | Order::AttackGround { order_id, .. } =
                entity.order
        {
            self.entities[index].order = Order::Idle {
                last_order_id: order_id,
            };
        }
        let entity = &self.entities[index];
        let supplied = entity.charges < charges.max
            && (charges.refill_radius_centi == 0
                || self.resupplied(index, charges.refill_radius_centi));
        let entity = &mut self.entities[index];
        if !supplied {
            entity.charge_clock = 0;
            return;
        }
        entity.charge_clock += 1;
        if entity.charge_clock >= charges.refill_ticks {
            entity.charges = (entity.charges + 1).min(charges.max);
            entity.charge_clock = 0;
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
        // Spec 43 §4.4: the drone is the launcher's ammunition.
        let launcher = &mut self.entities[shooter];
        launcher.charges = launcher.charges.saturating_sub(1);
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
        if self.rules.ty(self.entities[index].kind).is_fixed_wing() {
            self.fly_wing(index);
            return;
        }
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
            } if ty.is_fixed_wing() => Plan::Go {
                goal: target,
                entity: None,
                // A sortie flyer ends the order near the point and goes home; any
                // other circles the point until it is ordered elsewhere.
                within: loiter_radius(&ty.motion),
                arrival: if ty.sortie.is_some() {
                    Arrival::Done(order_id)
                } else {
                    Arrival::Orbit
                },
            },
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
                Arrival::Orbit => {}
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

    /// One tick of a fixed-wing flyer (spec 43 §4.1). It is never still while
    /// airborne: it turns at a limited rate, flies at no less than its minimum
    /// speed, circles when it has nothing to do and shoots on the move.
    fn fly_wing(&mut self, index: usize) {
        match self.plan_flight(index) {
            Plan::Hold => self.wing_loiter(index),
            Plan::Finish(order_id) => {
                self.entities[index].order = Order::Idle {
                    last_order_id: order_id,
                };
                self.wing_loiter(index);
            }
            Plan::Go {
                goal,
                entity,
                within,
                arrival,
            } => {
                let pos = self.entities[index].pos;
                let distance = match entity {
                    Some(other) => self.entity_distance(pos, &self.entities[other]),
                    None => (goal - pos).length(),
                };
                match arrival {
                    Arrival::Done(order_id) if distance <= within => {
                        self.entities[index].order = Order::Idle {
                            last_order_id: order_id,
                        };
                        self.wing_loiter(index);
                    }
                    Arrival::Detonate(target)
                        if distance <= within && self.armed_warhead(index) =>
                    {
                        self.detonate(index, target);
                    }
                    Arrival::Orbit => self.wing_orbit(index, goal),
                    // An armed pass has no arrival: the weapon fires through the
                    // nose cone and the flyer flies on.
                    Arrival::Stay => self.wing_chase(
                        index,
                        goal,
                        Chase {
                            entity,
                            within: fx_centi(CONTACT_CENTI),
                        },
                    ),
                    _ => self.wing_chase(index, goal, Chase { entity, within }),
                }
            }
        }
    }

    /// A fixed-wing flyer with nothing to fly to: parked flyers stay still,
    /// airborne ones circle where they are.
    fn wing_loiter(&mut self, index: usize) {
        if !self.airborne(index) {
            self.entities[index].speed = Fx::ZERO;
            return;
        }
        let motion = self.rules.ty(self.entities[index].kind).motion;
        let heading = Angle(
            self.entities[index]
                .heading
                .0
                .wrapping_add(motion.turn_step as u16),
        );
        self.wing_advance(index, heading, motion.min_speed);
    }

    /// A fixed-wing flyer circling `center` on a circle derived from its
    /// minimum speed and turn rate; far away it flies in at top speed.
    fn wing_orbit(&mut self, index: usize, center: FxVec2) {
        let motion = self.rules.ty(self.entities[index].kind).motion;
        let radius = loiter_radius(&motion);
        let unit = &self.entities[index];
        let rel = unit.pos - center;
        let distance = rel.length();
        let outward = if distance == Fx::ZERO {
            unit.heading
        } else {
            atan2(rel.x, rel.y)
        };
        // Tangent when on the circle, towards the centre from further out and
        // away from it from further in.
        let error = i64::from(distance.raw()) - i64::from(radius.raw());
        let lean = (error * i64::from(QUARTER_TURN) / i64::from(radius.raw().max(1)))
            .clamp(-i64::from(QUARTER_TURN), i64::from(QUARTER_TURN)) as i32;
        let desired = Angle((i32::from(outward.0) + QUARTER_TURN + lean) as u16);
        let heading = unit.heading.turn_towards(desired, motion.turn_step);
        let speed = if distance > radius + radius + radius {
            motion.max_speed
        } else {
            motion.min_speed
        };
        self.wing_advance(index, heading, speed);
    }

    /// A fixed-wing flyer flying at `goal` (the footprint of `entity` when it is
    /// one), arriving inside `within`. It steers at the goal at its turn rate
    /// and slows to its minimum speed in a sharp turn (a tighter circle). A goal inside the turning circle cannot be
    /// reached by turning, so it flies straight on, overshoots, and comes round
    /// once pursuit would get there: it never circles a target forever.
    fn wing_chase(&mut self, index: usize, goal: FxVec2, wing: Chase) {
        let unit = &self.entities[index];
        let motion = self.rules.ty(unit.kind).motion;
        let (turned, speed) = wing_steer(&motion, unit.pos, unit.heading, goal);
        // Pursuit is exactly what the flyer would do next tick, so a "yes"
        // stays a "yes" while it turns and the answer cannot flip-flop.
        let ahead = unit.pos + unit.heading.dir().scale(speed + speed);
        let inside_map = ahead.x.raw() >= 0
            && ahead.y.raw() >= 0
            && ahead.x.raw() < i32::from(self.nav.width()) * 65536
            && ahead.y.raw() < i32::from(self.nav.height()) * 65536;
        let heading =
            if !inside_map || self.pursuit_arrives(&motion, unit.pos, unit.heading, goal, wing) {
                turned
            } else {
                unit.heading
            };
        self.wing_advance(index, heading, speed);
    }

    /// Whether pure pursuit of `goal` from `pos` and `heading`, at the turn
    /// rate, gets inside `wing.within` of it within one full circle.
    fn pursuit_arrives(
        &self,
        motion: &crate::rules::Motion,
        mut pos: FxVec2,
        mut heading: Angle,
        goal: FxVec2,
        wing: Chase,
    ) -> bool {
        // Further out than two of its widest turning circles every goal is
        // reachable, so only a near goal needs the look ahead.
        let widest = turn_radius(motion.max_speed, motion.turn_step);
        if wing.distance(self, pos, goal) > widest + widest + wing.within {
            return true;
        }
        let steps = (TURN_UNITS / motion.turn_step.max(1) + 4).min(72);
        for _ in 0..steps {
            let (turned, speed) = wing_steer(motion, pos, heading, goal);
            heading = turned;
            pos = pos + heading.dir().scale(speed);
            if wing.distance(self, pos, goal) <= wing.within {
                return true;
            }
        }
        false
    }

    /// Sets a fixed-wing flyer's heading and speed and moves it one step.
    fn wing_advance(&mut self, index: usize, heading: Angle, speed: Fx) {
        let max_x = i32::from(self.nav.width()) * 65536 - 1;
        let max_y = i32::from(self.nav.height()) * 65536 - 1;
        let unit = &mut self.entities[index];
        unit.heading = heading;
        unit.speed = speed;
        let next = unit.pos + heading.dir().scale(speed);
        unit.pos = FxVec2::new(
            Fx::from_raw(next.x.raw().clamp(0, max_x)),
            Fx::from_raw(next.y.raw().clamp(0, max_y)),
        );
    }

    /// Spec 43 §4.1: whether a weapon of entity `index` may fire at `point`:
    /// a fixed-wing flyer only through its nose cone, everything else always.
    pub(crate) fn flyer_aligned(&self, index: usize, point: FxVec2) -> bool {
        let entity = &self.entities[index];
        let ty = self.rules.ty(entity.kind);
        if !ty.is_fixed_wing() {
            return true;
        }
        let offset = point - entity.pos;
        if offset == FxVec2::ZERO {
            return true;
        }
        entity.heading.delta(atan2(offset.x, offset.y)).abs() <= ty.motion.nose_cone
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

    /// Spec 44: an airborne class `low` flyer inside the footprint of a
    /// standing feature taller than its altitude crashes into it: a one-way
    /// unit detonates its warhead there, any other falls, harmless.
    pub(crate) fn crash_into_building(&mut self, index: usize) {
        let entity = &self.entities[index];
        let motion = &self.rules.ty(entity.kind).motion;
        if entity.hp == 0 || motion.air_class != AirClass::Low || !self.airborne(index) {
            return;
        }
        let altitude = motion.altitude_centi;
        let Some(feature) = self.feature_at(cell_of(entity.pos)) else {
            return;
        };
        let row = &self.features[feature as usize];
        if row.collapse > 0 || self.rules.feature_types[row.kind as usize].height_centi <= altitude
        {
            return;
        }
        if self.rules.ty(self.entities[index].kind).one_way.is_some() {
            self.detonate(index, None);
        } else {
            self.fall_harmless(index);
        }
    }

    /// Whether entity `index` is a flyer.
    pub(crate) fn is_flyer(&self, index: usize) -> bool {
        self.rules.ty(self.entities[index].kind).is_air()
    }
}

/// Turning radius of a flyer at `speed` with `turn_step` angle units a tick:
/// `speed / angular rate` in fixed point.
pub fn turn_radius(speed: Fx, turn_step: i32) -> Fx {
    let raw = i64::from(speed.raw()) * RADIUS_PER_STEP / i64::from(turn_step.max(1));
    Fx::from_raw(raw.min(i64::from(i32::MAX)) as i32)
}

/// Radius of the circle a fixed-wing flyer holds: its turning circle at the
/// minimum speed with a quarter to spare, so the turn rate can always follow it.
pub fn loiter_radius(motion: &crate::rules::Motion) -> Fx {
    let radius = turn_radius(motion.min_speed, motion.turn_step);
    Fx::from_raw(radius.raw() + radius.raw() / 4)
}

/// A seeded point in the disc of `radius_centi` around the origin.
fn disc_offset(id: EntityId, tick: u32, radius_centi: u32) -> FxVec2 {
    let mut rng = SplitMix64::new((u64::from(tick) << 32) ^ (u64::from(id) << 8) ^ 0x6a);
    let u = Fx::from_raw((rng.next_u32() % 65537) as i32);
    let r = fx_centi(radius_centi).mul(u.sqrt());
    let angle = Angle((rng.next_u32() >> 16) as u16);
    angle.dir().scale(r)
}
