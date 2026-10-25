//! AC-03-05: Ruleset parsing in the simulation.
//!
//! Parses a generated-format ruleset (see `data/generated/ruleset.json`) into
//! strongly-typed definitions and validates every reference, so the rest of the
//! simulation can index by `TypeId`/`WeaponId` without re-checking. See
//! `specs/03-phase2-core-loop.md` §5.2.

use serde::Deserialize;

use crate::angle::{deg_per_second_to_step, deg_to_units};
use crate::fixed::Fx;

/// Index into `Ruleset::types` (`kind` used everywhere).
pub type TypeId = u16;
/// Index into `Ruleset::weapons`.
pub type WeaponId = u16;
/// Index into `Ruleset::factions`.
pub type FactionId = u8;

/// Version of the generated ruleset format (`data/generated/ruleset.json`).
pub const FORMAT_VERSION: u32 = 1;
/// Maximum allowed `maxQueue` (queue slots).
pub const QUEUE_SLOTS: usize = 9;

/// `fx_centi(c)` = `Fx::from_raw((c as i64 * 65536 / 100) as i32)`.
///
/// Converts a centtile count (1/100 of a tile) into fixed-point Q16.16, e.g.
/// `fx_centi(500) == 327680`, `fx_centi(150) == 98304`, `fx_centi(8) == 5242`.
pub fn fx_centi(c: u32) -> Fx {
    Fx::from_raw((c as i64 * 65536 / 100) as i32)
}

/// Locomotor family of a unit (spec 11 §4.3). `Immediate` (named in the spec as the
/// Instant kind; renamed because the sim lint bans that identifier) is the Phase 1–3 behaviour:
/// no turn delay and no speed model. Fixtures and every building use it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocoKind {
    #[default]
    Immediate,
    Foot,
    Tracks,
    Wheels,
}

/// Motion values precomputed once from the data at ruleset load (spec 11 §4.3).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Motion {
    pub kind: LocoKind,
    pub max_speed: Fx,
    pub turn_step: i32,
    pub turret_step: i32,
    pub pivot: i32,
    pub slow_turn: i32,
    pub min_turn_speed: Fx,
    pub accel: Fx,
    pub braking: Fx,
    pub reverse_angle: i32,
    pub reverse_max: Fx,
    pub reverse_speed: Fx,
    /// What this hull crushes when it drives over it (spec 28 §2): `0`
    /// nothing, `1` infantry (Zero Hour's `CrusherLevel`).
    pub crusher_level: u8,
    /// Damage a non-crushing vehicle deals to enemy infantry it shoves aside
    /// (spec 28 §3); `0` with no shove.
    pub shove_damage: u32,
    /// How far, sideways from the vehicle's path, a shoved soldier is thrown.
    pub shove_push: Fx,
}

/// A locomotor from `globals.locomotors` (spec 11 §4.1). `id` is its key.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocomotorDef {
    pub id: String,
    pub kind: LocoKind,
    pub pivot_angle_deg: u32,
    pub min_turn_speed_percent: u32,
    pub slow_turn_angle_deg: u32,
    pub accel_centi: u32,
    pub braking_centi: u32,
    pub reverse_angle_deg: u32,
    pub reverse_max_centi: u32,
    pub reverse_speed_percent: u32,
    pub crusher_level: u8,
    pub shove_damage: u32,
    pub shove_push_centi: u32,
}

fn no_locomotor() -> i32 {
    -1
}

/// `value × percent / 100` in fixed point.
fn percent_of(value: Fx, percent: u32) -> Fx {
    Fx::from_raw((i64::from(value.raw()) * i64::from(percent) / 100) as i32)
}

/// The motion profile of one type (spec 11 §4.3). Without a locomotor a type keeps
/// the Phase 1–3 behaviour; only `turret_step` comes from `turretTurnRateDeg`.
fn motion_of(ty: &TypeDef, locomotor: Option<&LocomotorDef>) -> Motion {
    let max_speed = fx_centi(ty.speed_centi);
    let mut motion = Motion {
        max_speed,
        turret_step: deg_per_second_to_step(ty.turret_turn_rate_deg),
        ..Motion::default()
    };
    if let Some(l) = locomotor {
        motion.kind = l.kind;
        motion.turn_step = deg_per_second_to_step(ty.turn_rate_deg);
        motion.pivot = deg_to_units(l.pivot_angle_deg);
        motion.slow_turn = deg_to_units(l.slow_turn_angle_deg);
        motion.min_turn_speed = percent_of(max_speed, l.min_turn_speed_percent);
        motion.accel = fx_centi(l.accel_centi);
        motion.braking = fx_centi(l.braking_centi);
        motion.reverse_angle = deg_to_units(l.reverse_angle_deg);
        motion.reverse_max = fx_centi(l.reverse_max_centi);
        motion.reverse_speed = percent_of(max_speed, l.reverse_speed_percent);
        motion.crusher_level = l.crusher_level;
        motion.shove_damage = l.shove_damage;
        motion.shove_push = fx_centi(l.shove_push_centi);
    }
    motion
}

/// Building/unit classification. Serialized lowercase (`"unit"`, `"building"`, `"depot"`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Unit,
    Building,
    Depot,
}

/// How a weapon's projectiles deliver their damage (spec 17 §4.1). The generated
/// ruleset encodes it as `0` homing / `1` ballistic.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "u8")]
pub enum Delivery {
    Homing = 0,
    Ballistic = 1,
}

impl TryFrom<u8> for Delivery {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Delivery::Homing),
            1 => Ok(Delivery::Ballistic),
            other => Err(format!("unknown delivery {other}")),
        }
    }
}

/// A weapon a `TypeDef` may fire through its `weapon` index.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(from = "WeaponDefWire")]
pub struct WeaponDef {
    pub id: String,
    pub damage_type: u8,
    pub damage: u32,
    pub range_centi: u32,
    pub min_range_centi: u32,
    pub cooldown_ticks: u32,
    pub splash_centi: u32,
    pub projectile_ticks: u32,
    pub speed_centi: u32,
    pub delivery: Delivery,
    pub scatter_centi: u32,
    pub salvo: u32,
    pub salvo_interval_ticks: u32,
    /// Aim tolerance in angle units (spec 11 §4.2, `deg_to_units`).
    pub aim_tolerance: i32,
}

/// Wire form of `WeaponDef`; it resolves the splash-dependent `delivery` default
/// that serde's per-field `default` cannot see (spec 17 §3.1, §4.1).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeaponDefWire {
    id: String,
    damage_type: u8,
    damage: u32,
    range_centi: u32,
    min_range_centi: u32,
    cooldown_ticks: u32,
    splash_centi: u32,
    projectile_ticks: u32,
    #[serde(default)]
    speed_centi: u32,
    delivery: Option<Delivery>,
    #[serde(default)]
    scatter_centi: u32,
    #[serde(default = "default_salvo")]
    salvo: u32,
    #[serde(default)]
    salvo_interval_ticks: u32,
    #[serde(default)]
    aim_tolerance_deg: u32,
}

fn default_salvo() -> u32 {
    1
}

impl From<WeaponDefWire> for WeaponDef {
    fn from(w: WeaponDefWire) -> Self {
        let delivery = w.delivery.unwrap_or(if w.splash_centi == 0 {
            Delivery::Homing
        } else {
            Delivery::Ballistic
        });
        WeaponDef {
            id: w.id,
            damage_type: w.damage_type,
            damage: w.damage,
            range_centi: w.range_centi,
            min_range_centi: w.min_range_centi,
            cooldown_ticks: w.cooldown_ticks,
            splash_centi: w.splash_centi,
            projectile_ticks: w.projectile_ticks,
            speed_centi: w.speed_centi,
            delivery,
            scatter_centi: w.scatter_centi,
            salvo: w.salvo,
            salvo_interval_ticks: w.salvo_interval_ticks,
            aim_tolerance: deg_to_units(w.aim_tolerance_deg),
        }
    }
}

/// A buildable/controllable thing, indexed in `Ruleset::types` by `TypeId`.
/// The `render` field is unknown to the sim and ignored on parse.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeDef {
    pub id: String,
    pub faction: i32,
    pub category: Category,
    pub armor: u8,
    pub hp: u32,
    pub sight_centi: u32,
    pub cost: u32,
    pub build_ticks: u32,
    pub speed_centi: u32,
    pub weapon: i32,
    pub requires: Vec<TypeId>,
    pub produces: Vec<TypeId>,
    pub builds: Vec<TypeId>,
    pub footprint: [u16; 2],
    pub power: i32,
    pub requires_power: bool,
    pub drop_off: bool,
    pub capacity: u32,
    pub load_ticks: u32,
    pub unload_ticks: u32,
    pub free_unit: i32,
    /// Index into `Ruleset::locomotors`; `-1` for Immediate types.
    #[serde(default = "no_locomotor")]
    pub locomotor: i32,
    /// Collision radius of a unit in centi-tiles; `0` uses the default
    /// (`SEPARATION_DISTANCE / 2`). Two units keep `ra + rb` apart.
    #[serde(default)]
    pub radius_centi: u32,
    #[serde(default)]
    pub turn_rate_deg: u32,
    #[serde(default)]
    pub turret_turn_rate_deg: u32,
    /// Launcher types fire only while standing still (they stow when moving).
    #[serde(default)]
    pub stationary_fire: bool,
    /// Precomputed at load (`Ruleset::from_json`), never read from the wire.
    #[serde(skip)]
    pub motion: Motion,
}

/// A faction's HQ and starting dozer type.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct FactionDef {
    pub id: String,
    pub hq: TypeId,
    pub dozer: TypeId,
}

/// A map depot's origin tile and stored amount.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct DepotDef {
    pub origin: [i32; 2],
    pub amount: u32,
}

/// A starting position for a map. `render` is ignored by the sim.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDef {
    pub faction: FactionId,
    pub hq: [i32; 2],
    pub dozer_centi: [u32; 2],
}

/// A playable map.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct MapDef {
    pub id: String,
    pub width: u16,
    pub height: u16,
    pub blocked: Vec<[i32; 4]>,
    pub depots: Vec<DepotDef>,
    pub starts: Vec<StartDef>,
}

/// A named unit mix of an AI personality (spec 05 §5.1).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskForceDef {
    pub id: String,
    pub units: Vec<(TypeId, u32)>,
}

/// A weighted trigger that selects a task force (spec 05 §5.1).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TriggerDef {
    pub task_force: u16,
    pub weight: u32,
    pub min_tick: u32,
}

/// An AI personality (spec 05 §5.1).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiDef {
    pub id: String,
    pub faction: FactionId,
    pub harvesters: u32,
    pub defense_radius_centi: u32,
    pub build_order: Vec<TypeId>,
    pub task_forces: Vec<TaskForceDef>,
    pub triggers: Vec<TriggerDef>,
}

/// The full ruleset: weapons, types, factions and maps.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ruleset {
    pub format_version: u32,
    pub damage_types: Vec<String>,
    pub armor_classes: Vec<String>,
    pub damage_modifiers: Vec<Vec<u32>>,
    pub starting_credits: u32,
    pub low_power_min_speed_percent: u32,
    pub low_power_max_speed_percent: u32,
    pub max_queue: u32,
    pub dock_range_centi: u32,
    pub weapons: Vec<WeaponDef>,
    pub types: Vec<TypeDef>,
    pub factions: Vec<FactionDef>,
    pub maps: Vec<MapDef>,
    #[serde(default)]
    pub ai: Vec<AiDef>,
    #[serde(default)]
    pub locomotors: Vec<LocomotorDef>,
    #[serde(default)]
    pub turret_recenter_ticks: u32,
}

impl Ruleset {
    /// Parse `text` as a generated-format ruleset and validate it.
    ///
    /// On failure returns `Err(message)` naming the offending camelCase field,
    /// e.g. `"types[3].weapon out of range"`.
    pub fn from_json(text: &str) -> Result<Ruleset, String> {
        let mut ruleset: Ruleset = serde_json::from_str(text).map_err(|e| e.to_string())?;
        ruleset.compute_motion();
        ruleset.validate()?;
        Ok(ruleset)
    }

    /// The builtin ruleset (`data/generated/ruleset.json`), validated. Panics if invalid.
    pub fn builtin() -> Ruleset {
        let text = include_str!("../../../data/generated/ruleset.json");
        Ruleset::from_json(text).expect("builtin ruleset must be valid")
    }

    /// First type whose `id` matches, or `None`.
    pub fn type_index(&self, id: &str) -> Option<TypeId> {
        self.types
            .iter()
            .position(|t| t.id == id)
            .map(|i| i as TypeId)
    }

    /// Map by `id`, or `None`.
    pub fn map(&self, id: &str) -> Option<&MapDef> {
        self.maps.iter().find(|m| m.id == id)
    }

    /// First AI personality whose `id` matches, or `None`.
    pub fn ai_index(&self, id: &str) -> Option<usize> {
        self.ai.iter().position(|ai| ai.id == id)
    }

    /// Type at `kind`; panics out of range.
    pub fn ty(&self, kind: TypeId) -> &TypeDef {
        &self.types[usize::from(kind)]
    }

    /// Weapon a type fires through, or `None` when the type has no weapon.
    pub fn weapon_of(&self, kind: TypeId) -> Option<&WeaponDef> {
        let weapon = self.ty(kind).weapon;
        if weapon < 0 {
            return None;
        }
        self.weapons.get(weapon as usize)
    }

    /// Damage dealt by `damage_type` against `armor`; `0` when out of range.
    pub fn modifier(&self, damage_type: u8, armor: u8) -> u32 {
        self.damage_modifiers
            .get(usize::from(damage_type))
            .and_then(|row| row.get(usize::from(armor)))
            .copied()
            .unwrap_or(0)
    }

    /// First type with category `Depot`; panics if none.
    pub fn depot_type(&self) -> TypeId {
        let idx = self
            .types
            .iter()
            .position(|t| t.category == Category::Depot)
            .expect("ruleset must define a Depot type");
        idx as TypeId
    }

    /// Precompute every type's `Motion` from its locomotor (spec 11 §4.3).
    fn compute_motion(&mut self) {
        for i in 0..self.types.len() {
            let locomotor = usize::try_from(self.types[i].locomotor)
                .ok()
                .and_then(|l| self.locomotors.get(l));
            self.types[i].motion = motion_of(&self.types[i], locomotor);
        }
    }

    /// Validate references after parsing (see §5.2). Names the offending field.
    fn validate(&self) -> Result<(), String> {
        if self.format_version != FORMAT_VERSION {
            return Err(format!(
                "formatVersion {} is not {}",
                self.format_version, FORMAT_VERSION
            ));
        }

        let n_damage_types = self.damage_types.len();
        let n_armor_classes = self.armor_classes.len();
        if self.damage_modifiers.len() != n_damage_types {
            return Err(format!(
                "damageModifiers has {} rows, expected {}",
                self.damage_modifiers.len(),
                n_damage_types
            ));
        }
        for (r, row) in self.damage_modifiers.iter().enumerate() {
            if row.len() != n_armor_classes {
                return Err(format!(
                    "damageModifiers[{}].len() is {}, expected {}",
                    r,
                    row.len(),
                    n_armor_classes
                ));
            }
        }

        if !(1..=QUEUE_SLOTS as u32).contains(&self.max_queue) {
            return Err(format!(
                "maxQueue {} is out of range 1..={}",
                self.max_queue, QUEUE_SLOTS
            ));
        }

        let n_weapons = self.weapons.len();
        for (i, w) in self.weapons.iter().enumerate() {
            if usize::from(w.damage_type) >= n_damage_types {
                return Err(format!(
                    "weapons[{}].damageType {} is out of range 0..={}",
                    i,
                    w.damage_type,
                    n_damage_types.saturating_sub(1)
                ));
            }
        }

        let n_types = self.types.len();
        for (i, t) in self.types.iter().enumerate() {
            if usize::from(t.armor) >= n_armor_classes {
                return Err(format!(
                    "types[{}].armor {} is out of range 0..={}",
                    i,
                    t.armor,
                    n_armor_classes.saturating_sub(1)
                ));
            }
            if !is_in_range(t.weapon, n_weapons as i32) {
                return Err(format!("types[{}].weapon {} is out of range", i, t.weapon));
            }
            for (key, list) in [
                ("requires", &t.requires),
                ("produces", &t.produces),
                ("builds", &t.builds),
            ] {
                for (j, entry) in list.iter().enumerate() {
                    if usize::from(*entry) >= n_types {
                        return Err(format!(
                            "types[{}].{}[{}] {} is out of range 0..={}",
                            i,
                            key,
                            j,
                            *entry,
                            n_types.saturating_sub(1)
                        ));
                    }
                }
            }
            if !is_in_range(t.free_unit, n_types as i32) {
                return Err(format!(
                    "types[{}].freeUnit {} is out of range",
                    i, t.free_unit
                ));
            }
            if !is_in_range(t.faction, self.factions.len() as i32) {
                return Err(format!(
                    "types[{}].faction {} is out of range",
                    i, t.faction
                ));
            }
        }

        for (i, f) in self.factions.iter().enumerate() {
            if usize::from(f.hq) >= n_types {
                return Err(format!(
                    "factions[{}].hq {} is out of range 0..={}",
                    i,
                    f.hq,
                    n_types.saturating_sub(1)
                ));
            }
            if usize::from(f.dozer) >= n_types {
                return Err(format!(
                    "factions[{}].dozer {} is out of range 0..={}",
                    i,
                    f.dozer,
                    n_types.saturating_sub(1)
                ));
            }
        }

        for (mi, m) in self.maps.iter().enumerate() {
            for (si, s) in m.starts.iter().enumerate() {
                if usize::from(s.faction) >= self.factions.len() {
                    return Err(format!(
                        "maps[{}].starts[{}].faction {} is out of range",
                        mi, si, s.faction
                    ));
                }
            }
        }

        for (i, ai) in self.ai.iter().enumerate() {
            if usize::from(ai.faction) >= self.factions.len() {
                return Err(format!("ai[{}].faction out of range", i));
            }
            for (j, kind) in ai.build_order.iter().enumerate() {
                if usize::from(*kind) >= n_types
                    || self.types[usize::from(*kind)].category != Category::Building
                {
                    return Err(format!("ai[{}].buildOrder[{}] out of range", i, j));
                }
            }
            for (j, force) in ai.task_forces.iter().enumerate() {
                for &(kind, count) in &force.units {
                    if usize::from(kind) >= n_types
                        || self.types[usize::from(kind)].category != Category::Unit
                        || count == 0
                    {
                        return Err(format!("ai[{}].taskForces[{}].units out of range", i, j));
                    }
                }
            }
            for (j, trigger) in ai.triggers.iter().enumerate() {
                if usize::from(trigger.task_force) >= ai.task_forces.len() {
                    return Err(format!("ai[{}].triggers[{}].taskForce out of range", i, j));
                }
                if trigger.weight == 0 {
                    return Err(format!("ai[{}].triggers[{}].weight out of range", i, j));
                }
            }
        }

        Ok(())
    }
}

/// `value` is `-1` (unspecified) or in `[0, limit)` where `limit` is an i32 bound.
fn is_in_range(value: i32, limit: i32) -> bool {
    value == -1 || (value >= 0 && value < limit)
}
