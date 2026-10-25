//! Weapons, targeting, attack orders and projectiles (P2-12/P2-13, spec §5.11).
//!
//! The combat phase resets every `last_target`, then each entity with a weapon
//! (ascending id, skipping the dead, incomplete buildings and unpowered
//! defenses) decrements its cooldown, picks a target — the ordered one when it
//! is valid and in range, the nearest valid one otherwise — and fires. A weapon
//! with flight time (`speed_centi > 0` or `projectile_ticks`) launches a salvo
//! of projectiles; otherwise the spec 03 instant hit applies. Due projectiles
//! then resolve in creation order and are removed: a homing one hits its target
//! wherever it moved, a ballistic one hits the nearest valid enemy within
//! `DIRECT_HIT_CENTI` of its scattered impact, and a splash one damages every
//! player-owned entity inside its radius, friend or foe (owner request
//! 2026-10-25). Neutral depots are never hit.

use crate::angle::{Angle, atan2};
use crate::entity::{EntityId, GROUND_TARGET, NEUTRAL, Order, PlayerId, Projectile};
use crate::fixed::{Fx, FxVec2};
use crate::rng::SplitMix64;
use crate::rules::{Delivery, LocoKind, TypeId, WeaponDef, WeaponId, fx_centi};
use crate::world::{CombatEvent, DIRECT_HIT_CENTI, World};

/// Spec 23: farthest attacker (from the victim) that triggers retaliation.
pub(crate) const RETALIATION_DISTANCE_CENTI: u32 = 900;
/// Spec 23: idle friends of the victim within this distance join the reply.
const RETALIATION_FRIENDS_CENTI: u32 = 550;

/// `0` when `modifier_percent == 0`; otherwise `max(1, base * modifier_percent
/// / 100)` with a `u64` intermediate (saturating at `u32::MAX`).
pub fn damage_dealt(base: u32, modifier_percent: u32) -> u32 {
    if modifier_percent == 0 {
        return 0;
    }
    (u64::from(base) * u64::from(modifier_percent) / 100).clamp(1, u64::from(u32::MAX)) as u32
}

impl World {
    /// Spec §5.11 combat phase: `last_target` reset, one fire step per entity in
    /// ascending id order, then the due projectiles hit and leave.
    pub(crate) fn update_combat(&mut self) {
        for entity in &mut self.entities {
            entity.last_target = None;
        }
        for index in 0..self.entities.len() {
            self.fire(index);
        }
        self.impact_projectiles();
    }

    /// One entity's combat step: cooldown, target selection and fire.
    fn fire(&mut self, index: usize) {
        let (kind, hp) = {
            let entity = &self.entities[index];
            (entity.kind, entity.hp)
        };
        if hp == 0 || !self.can_fire(index) {
            return;
        }
        let Some((weapon_id, weapon)) = self.weapon_data(kind) else {
            return;
        };
        if let Order::AttackGround { target, .. } = self.entities[index].order {
            self.fire_ground(index, weapon_id, &weapon, target);
            return;
        }
        let legacy = self.rules.ty(kind).motion.kind == LocoKind::Immediate;
        let target_index = if legacy {
            None
        } else {
            self.sticky_target(index, &weapon)
        };
        let aligned = if legacy {
            true
        } else {
            let entity = &self.entities[index];
            let stowed = self.rules.ty(kind).stationary_fire && entity.speed > Fx::ZERO;
            self.aim_turret(index, &weapon, target_index.map(|i| self.entities[i].pos)) && !stowed
        };
        let cooldown = self.entities[index].cooldown;
        if cooldown > 0 {
            self.entities[index].cooldown = cooldown - 1;
            if cooldown > 1 {
                return;
            }
        }
        let target_index = if legacy {
            self.select_target(index, &weapon)
        } else {
            target_index
        };
        let Some(target_index) = target_index else {
            return;
        };
        if !aligned {
            return;
        }
        let distance = self.entity_distance(self.entities[index].pos, &self.entities[target_index]);
        let aim = self.entities[target_index].pos;
        self.shoot(index, weapon_id, &weapon, Some(target_index), aim, distance);
    }

    /// Spec 20: one `AttackGround` step of a weapon — aims at the ordered
    /// point, and fires at it once it is inside `[min_range, range]` and the
    /// weapon is aligned. Any enemy standing at the point is hit by the shot.
    fn fire_ground(
        &mut self,
        index: usize,
        weapon_id: WeaponId,
        weapon: &WeaponDef,
        point: FxVec2,
    ) {
        let kind = self.entities[index].kind;
        let distance = (point - self.entities[index].pos).length();
        let in_range = distance >= fx_centi(weapon.min_range_centi)
            && distance <= fx_centi(weapon.range_centi);
        let aligned = if self.rules.ty(kind).motion.kind == LocoKind::Immediate {
            true
        } else {
            let stowed =
                self.rules.ty(kind).stationary_fire && self.entities[index].speed > Fx::ZERO;
            self.aim_turret(index, weapon, in_range.then_some(point)) && !stowed
        };
        let cooldown = self.entities[index].cooldown;
        if cooldown > 0 {
            self.entities[index].cooldown = cooldown - 1;
            if cooldown > 1 {
                return;
            }
        }
        if in_range && aligned {
            self.shoot(index, weapon_id, weapon, None, point, distance);
        }
    }

    /// Fires one shot (instant hit, or a salvo of projectiles) from entity
    /// `index` at `aim`; `target` is the ordered victim, `None` for a shot at
    /// the ground. Sets the cooldown and `last_target`.
    fn shoot(
        &mut self,
        index: usize,
        weapon_id: WeaponId,
        weapon: &WeaponDef,
        target: Option<usize>,
        aim: FxVec2,
        distance: Fx,
    ) {
        let target_id = target.map_or(GROUND_TARGET, |target| self.entities[target].id);
        let flight = self.flight_ticks(weapon, distance);
        let owner = self.entities[index].owner;
        let shooter = self.entities[index].id;
        if flight == 0 {
            // Instant branch of §5.11 step 4, with the target's position as the
            // impact point for splash.
            if weapon.splash_centi > 0 {
                self.apply_splash(shooter, weapon_id, weapon, aim);
            } else if let Some(hit) = target.or_else(|| self.direct_hit(owner, weapon, aim)) {
                self.apply_hit(shooter, hit, weapon_id, weapon);
            }
        } else {
            let origin = self.entities[index].pos;
            let tick = self.tick;
            for k in 0..weapon.salvo {
                let projectile = Projectile {
                    id: self.next_projectile_id,
                    owner,
                    shooter,
                    weapon: weapon_id,
                    target: target_id,
                    origin,
                    impact: aim + self.scatter(weapon, shooter, tick, k),
                    launch_tick: tick + k * weapon.salvo_interval_ticks,
                    impact_tick: tick + k * weapon.salvo_interval_ticks + flight,
                };
                self.next_projectile_id += 1;
                self.projectiles.push(projectile);
            }
        }
        self.entities[index].cooldown = weapon.cooldown_ticks;
        self.entities[index].last_target = Some(target_id);
    }

    /// Spec 11 §5.3 step 1: the locked target while it stays valid, otherwise a
    /// fresh pick; the result is stored in `aim` (Generals `TurretAI` keeps its
    /// victim). The target of the current `Attack` order wins over the lock: a
    /// new order must switch fire instead of shooting the old victim until it
    /// dies or leaves.
    fn sticky_target(&mut self, index: usize, weapon: &WeaponDef) -> Option<usize> {
        let ordered = match self.entities[index].order {
            Order::Attack { target, .. } => self
                .index_of(target)
                .filter(|&target_index| self.is_valid_target(index, target_index, weapon)),
            _ => None,
        };
        let locked = self.entities[index]
            .aim
            .and_then(|id| self.index_of(id))
            .filter(|&target_index| self.is_valid_target(index, target_index, weapon));
        let target = ordered
            .or(locked)
            .or_else(|| self.select_target(index, weapon));
        self.entities[index].aim = target.map(|target_index| self.entities[target_index].id);
        target
    }

    /// Spec 11 §5.3 steps 2, 3 and 6: turns the turret (or the hull of a
    /// turretless weapon) towards the target, or recentres it when there is
    /// none. Returns whether the weapon is aligned with the target.
    fn aim_turret(&mut self, index: usize, weapon: &WeaponDef, target: Option<FxVec2>) -> bool {
        let motion = self.rules.ty(self.entities[index].kind).motion;
        let Some(aim_point) = target else {
            let recenter = self.rules.turret_recenter_ticks;
            let entity = &mut self.entities[index];
            entity.idle_aim_ticks = entity.idle_aim_ticks.saturating_add(1);
            if motion.turret_step > 0 {
                if entity.speed > Fx::ZERO {
                    // The turret looks where the hull is heading and swings
                    // ahead of it in a turn, at twice its aim rate.
                    let want = match entity.order {
                        Order::Move { target, .. } if !entity.reversing => {
                            let offset = target - entity.pos;
                            Angle(atan2(offset.x, offset.y).0.wrapping_sub(entity.heading.0))
                        }
                        _ => Angle(0),
                    };
                    entity.turret = entity
                        .turret
                        .turn_towards(want, motion.turret_step.saturating_mul(2));
                } else if entity.idle_aim_ticks > recenter {
                    let half = (motion.turret_step / 2).max(1);
                    entity.turret = entity.turret.turn_towards(Angle(0), half);
                }
            }
            return false;
        };
        let offset = aim_point - self.entities[index].pos;
        let bearing = atan2(offset.x, offset.y);
        let entity = &mut self.entities[index];
        entity.idle_aim_ticks = 0;
        if motion.turret_step > 0 {
            let want = Angle(bearing.0.wrapping_sub(entity.heading.0));
            entity.turret = entity.turret.turn_towards(want, motion.turret_step);
            return entity.turret.delta(want).abs() <= weapon.aim_tolerance;
        }
        if matches!(
            entity.order,
            Order::Idle { .. } | Order::Attack { .. } | Order::AttackGround { .. }
        ) {
            entity.heading = entity.heading.turn_towards(bearing, motion.turn_step);
        }
        entity.heading.delta(bearing).abs() <= weapon.aim_tolerance
    }

    /// Spec 17 §4.2: `max(1, ceil(d / speed))` at `speedCenti`, otherwise the
    /// legacy `projectileTicks` (0 means the instant hit of spec 03).
    fn flight_ticks(&self, weapon: &WeaponDef, distance: Fx) -> u32 {
        if weapon.speed_centi == 0 {
            return weapon.projectile_ticks;
        }
        let speed = i64::from(fx_centi(weapon.speed_centi).raw());
        let ticks = (i64::from(distance.raw()) + speed - 1) / speed;
        u32::try_from(ticks.max(1)).unwrap_or(u32::MAX)
    }

    /// Spec 17 §4.4: `(0, 0)` unless a ballistic weapon scatters, then a
    /// stateless uniform draw over the disc `[0, scatterCenti]`.
    fn scatter(&self, weapon: &WeaponDef, shooter: EntityId, tick: u32, k: u32) -> FxVec2 {
        if weapon.delivery != Delivery::Ballistic || weapon.scatter_centi == 0 {
            return FxVec2::ZERO;
        }
        let mut rng =
            SplitMix64::new((u64::from(tick) << 32) ^ (u64::from(shooter) << 8) ^ u64::from(k));
        let u = Fx::from_raw((rng.next_u32() % 65537) as i32);
        let r = fx_centi(weapon.scatter_centi).mul(u.sqrt());
        let angle = Angle((rng.next_u32() >> 16) as u16);
        angle.dir().scale(r)
    }

    /// Incomplete buildings never fire, and a `requires_power` building does not
    /// fire while its owner has a power deficit (§5.11 step 2).
    fn can_fire(&self, index: usize) -> bool {
        let entity = &self.entities[index];
        if entity.site.as_ref().is_some_and(|site| !site.complete) {
            return false;
        }
        if !self.rules.ty(entity.kind).requires_power {
            return true;
        }
        self.player(entity.owner).is_none_or(|player| {
            let (produced, consumed) = player.power();
            produced >= consumed
        })
    }

    /// Weapon of `kind` as `(id, definition)`; `None` for unarmed types.
    fn weapon_data(&self, kind: TypeId) -> Option<(WeaponId, WeaponDef)> {
        let index = usize::try_from(self.rules.ty(kind).weapon).ok()?;
        let weapon = self.rules.weapons.get(index)?.clone();
        Some((WeaponId::try_from(index).ok()?, weapon))
    }

    /// Weapon definition of a weapon id; `None` out of range.
    fn weapon_def(&self, weapon: WeaponId) -> Option<WeaponDef> {
        self.rules.weapons.get(usize::from(weapon)).cloned()
    }

    /// Spec 17 §4.3: cancel unlaunched projectiles of a dead shooter, track a
    /// living target for homing, then resolve every due projectile in creation
    /// order and remove it.
    fn impact_projectiles(&mut self) {
        let tick = self.tick;

        // Step 3.1: a not-yet-launched projectile whose shooter is gone or dead
        // is removed with no event; the rest of the salvo is not fired.
        let mut kept = Vec::with_capacity(self.projectiles.len());
        for projectile in std::mem::take(&mut self.projectiles) {
            let cancelled = projectile.launch_tick > tick
                && self
                    .entity(projectile.shooter)
                    .is_none_or(|shooter| shooter.hp == 0);
            if !cancelled {
                kept.push(projectile);
            }
        }
        self.projectiles = kept;

        // Step 3.2: a launched homing projectile tracks a living target.
        for index in 0..self.projectiles.len() {
            let projectile = self.projectiles[index];
            if projectile.launch_tick > tick {
                continue;
            }
            let Some(weapon) = self.weapon_def(projectile.weapon) else {
                continue;
            };
            if weapon.delivery != Delivery::Homing {
                continue;
            }
            if let Some(target) = self.entity(projectile.target)
                && target.hp > 0
            {
                self.projectiles[index].impact = target.pos;
            }
        }

        // Step 3.3: due projectiles hit, in creation order, and are removed.
        let mut flying = Vec::with_capacity(self.projectiles.len());
        for projectile in std::mem::take(&mut self.projectiles) {
            if projectile.impact_tick == tick {
                self.resolve_projectile(&projectile);
            } else {
                flying.push(projectile);
            }
        }
        self.projectiles = flying;
    }

    /// Spec 17 §4.3: splash around `impact` for either delivery; otherwise a
    /// homing projectile hits its target and a ballistic one hits the nearest
    /// valid entity within `DIRECT_HIT_CENTI` of `impact`. Every resolution
    /// emits a `Detonate` event carrying the damaged entity, if any.
    fn resolve_projectile(&mut self, projectile: &Projectile) {
        let Some(weapon) = self.weapon_def(projectile.weapon) else {
            return;
        };
        let hit = if weapon.splash_centi > 0 {
            self.apply_splash(
                projectile.shooter,
                projectile.weapon,
                &weapon,
                projectile.impact,
            );
            None
        } else {
            match weapon.delivery {
                Delivery::Homing if projectile.target != GROUND_TARGET => {
                    let hit = self
                        .entity(projectile.target)
                        .filter(|entity| entity.hp > 0)
                        .map(|entity| entity.id);
                    if let Some(index) = hit.and_then(|id| self.index_of(id)) {
                        self.apply_hit(projectile.shooter, index, projectile.weapon, &weapon);
                    }
                    hit
                }
                // A shot at the ground (spec 20) lands like a ballistic one.
                Delivery::Homing | Delivery::Ballistic => {
                    let index = self.direct_hit(projectile.owner, &weapon, projectile.impact);
                    index.map(|index| {
                        let id = self.entities[index].id;
                        self.apply_hit(projectile.shooter, index, projectile.weapon, &weapon);
                        id
                    })
                }
            }
        };
        self.events.push(CombatEvent::Detonate {
            projectile: projectile.id,
            owner: projectile.owner,
            weapon: projectile.weapon,
            pos: projectile.impact,
            hit,
        });
    }

    /// Spec 17 §4.3 direct hit: the entity with `hp > 0`, an owner neither the
    /// shooter's nor `NEUTRAL`, a non-zero modifier and the smallest entity
    /// distance from `impact`, within `DIRECT_HIT_CENTI`. Ties go to the lowest
    /// id (the ascending index).
    fn direct_hit(&self, owner: PlayerId, weapon: &WeaponDef, impact: FxVec2) -> Option<usize> {
        let radius = fx_centi(DIRECT_HIT_CENTI);
        let mut best: Option<(Fx, usize)> = None;
        for index in 0..self.entities.len() {
            let entity = &self.entities[index];
            if entity.hp == 0
                || entity.owner == owner
                || entity.owner == NEUTRAL
                || self
                    .rules
                    .modifier(weapon.damage_type, self.rules.ty(entity.kind).armor)
                    == 0
            {
                continue;
            }
            let distance = self.entity_distance(impact, entity);
            if distance > radius {
                continue;
            }
            if best.is_none_or(|(best_distance, _)| distance < best_distance) {
                best = Some((distance, index));
            }
        }
        best.map(|(_, index)| index)
    }

    /// The ordered target when it exists, is valid and in range; otherwise the
    /// valid, visible target in range at the smallest entity distance, ties to
    /// the lowest id.
    fn select_target(&self, index: usize, weapon: &WeaponDef) -> Option<usize> {
        if let Order::Attack { target, .. } = self.entities[index].order
            && let Some(target_index) = self.index_of(target)
            && self.is_valid_target(index, target_index, weapon)
        {
            return Some(target_index);
        }
        let mut best: Option<(Fx, usize)> = None;
        for target_index in 0..self.entities.len() {
            if !self.is_valid_auto_target(index, target_index, weapon) {
                continue;
            }
            let distance =
                self.entity_distance(self.entities[index].pos, &self.entities[target_index]);
            if best.is_none_or(|(best_distance, _)| distance < best_distance) {
                best = Some((distance, target_index));
            }
        }
        best.map(|(_, target_index)| target_index)
    }

    /// §5.11 combat validity: exists, `hp > 0`, an owner other than the
    /// attacker's and `NEUTRAL`, a non-zero damage modifier and a distance
    /// inside `[min_range, range]`. Fog is not part of it (Zero Hour's weapon
    /// layer deliberately lets ordered attacks fire at shrouded targets); it
    /// only gates the automatic pick, `is_valid_auto_target`.
    fn is_valid_target(&self, index: usize, target_index: usize, weapon: &WeaponDef) -> bool {
        let attacker = &self.entities[index];
        let target = &self.entities[target_index];
        if target.hp == 0
            || target.owner == attacker.owner
            || target.owner == NEUTRAL
            || self
                .rules
                .modifier(weapon.damage_type, self.rules.ty(target.kind).armor)
                == 0
        {
            return false;
        }
        let distance = self.entity_distance(attacker.pos, target);
        distance >= fx_centi(weapon.min_range_centi) && distance <= fx_centi(weapon.range_centi)
    }

    /// An automatic pick also needs the target visible to the attacker's
    /// owner; an explicit order does not.
    fn is_valid_auto_target(&self, index: usize, target_index: usize, weapon: &WeaponDef) -> bool {
        self.is_valid_target(index, target_index, weapon)
            && self.is_entity_visible(self.entities[index].owner, self.entities[target_index].id)
    }

    /// Instant or projectile hit: the target loses the modified damage
    /// (saturating) and records `(shooter, weapon)` as its last hit.
    fn apply_hit(
        &mut self,
        shooter: EntityId,
        target_index: usize,
        weapon_id: WeaponId,
        weapon: &WeaponDef,
    ) {
        let target = &self.entities[target_index];
        if target.hp == 0 {
            return;
        }
        let modifier = self
            .rules
            .modifier(weapon.damage_type, self.rules.ty(target.kind).armor);
        let damage = damage_dealt(weapon.damage, modifier);
        if damage == 0 {
            return;
        }
        self.entities[target_index].hp = self.entities[target_index].hp.saturating_sub(damage);
        self.entities[target_index].last_hit = Some((shooter, weapon_id));
        self.retaliate(target_index, shooter);
    }

    /// Spec 23: the damaged unit and its idle, armed, mobile friends nearby
    /// attack an enemy shooter that is not too far away, seen or not (a shot
    /// gives the shooter away).
    fn retaliate(&mut self, victim_index: usize, shooter: EntityId) {
        let Some(shooter_index) = self.index_of(shooter) else {
            return;
        };
        let (owner, victim_pos) = {
            let victim = &self.entities[victim_index];
            (victim.owner, victim.pos)
        };
        let aggressor = &self.entities[shooter_index];
        if aggressor.hp == 0
            || aggressor.owner == owner
            || aggressor.owner == NEUTRAL
            || owner == NEUTRAL
            || self.entity_distance(victim_pos, aggressor) > fx_centi(RETALIATION_DISTANCE_CENTI)
        {
            return;
        }
        let armor = self.rules.ty(aggressor.kind).armor;
        let radius = fx_centi(RETALIATION_FRIENDS_CENTI);
        let responders: Vec<usize> = (0..self.entities.len())
            .filter(|&i| {
                let unit = &self.entities[i];
                let ty = self.rules.ty(unit.kind);
                unit.owner == owner
                    && unit.hp > 0
                    && unit.site.is_none()
                    && ty.speed_centi > 0
                    && matches!(unit.order, Order::Idle { .. })
                    && self
                        .rules
                        .weapon_of(unit.kind)
                        .is_some_and(|weapon| self.rules.modifier(weapon.damage_type, armor) > 0)
                    && (unit.pos - victim_pos).length() <= radius
            })
            .collect();
        if responders.is_empty() {
            return;
        }
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        for i in responders {
            self.entities[i].order = Order::Attack {
                order_id,
                target: shooter,
            };
        }
    }

    /// §5.11 step 4 splash: every entity with `hp > 0`, except the shooter and
    /// neutral depots, that lies within `splash_centi` of the impact point
    /// loses the modified damage. Blasts hit friends and the shooter's own
    /// units too (owner request 2026-10-25), as in Zero Hour. Each damaged
    /// entity records `(shooter, weapon)` as its last hit.
    fn apply_splash(
        &mut self,
        shooter: EntityId,
        weapon_id: WeaponId,
        weapon: &WeaponDef,
        impact: FxVec2,
    ) {
        let radius = fx_centi(weapon.splash_centi);
        for index in 0..self.entities.len() {
            let entity = &self.entities[index];
            // Zero Hour's default splash mask skips the shooter (and its
            // producer) but hits allies, enemies and neutrals; Red Line keeps
            // NEUTRAL out because here it only marks supply depots (owner
            // request 2026-10-25).
            if entity.hp == 0
                || entity.id == shooter
                || entity.owner == NEUTRAL
                || self.entity_distance(impact, entity) > radius
            {
                continue;
            }
            let modifier = self
                .rules
                .modifier(weapon.damage_type, self.rules.ty(entity.kind).armor);
            let damage = damage_dealt(weapon.damage, modifier);
            if damage == 0 {
                continue;
            }
            self.entities[index].hp = self.entities[index].hp.saturating_sub(damage);
            self.entities[index].last_hit = Some((shooter, weapon_id));
            self.retaliate(index, shooter);
        }
    }
}
