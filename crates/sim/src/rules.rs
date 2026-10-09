//! AC-03-05: Ruleset parsing in the simulation.
//!
//! Parses a generated-format ruleset (see `data/generated/ruleset.json`) into
//! strongly-typed definitions and validates every reference, so the rest of the
//! simulation can index by `TypeId`/`WeaponId` without re-checking. See
//! `specs/03-phase2-core-loop.md` §5.2 and the traceability table §8.

use serde::Deserialize;

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
pub const QUEUE_SLOTS: usize = 5;

/// `fx_centi(c)` = `Fx::from_raw((c as i64 * 65536 / 100) as i32)`.
///
/// Converts a centtile count (1/100 of a tile) into fixed-point Q16.16, e.g.
/// `fx_centi(500) == 327680`, `fx_centi(150) == 98304`, `fx_centi(8) == 5242`.
pub fn fx_centi(c: u32) -> Fx {
    Fx::from_raw((c as i64 * 65536 / 100) as i32)
}

/// Building/unit classification. Serialized lowercase (`"unit"`, `"building"`, `"depot"`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Unit,
    Building,
    Depot,
}

/// A weapon a `TypeDef` may fire through its `weapon` index.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponDef {
    pub id: String,
    pub damage_type: u8,
    pub damage: u32,
    pub range_centi: u32,
    pub min_range_centi: u32,
    pub cooldown_ticks: u32,
    pub splash_centi: u32,
    pub projectile_ticks: u32,
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
}

impl Ruleset {
    /// Parse `text` as a generated-format ruleset and validate it.
    ///
    /// On failure returns `Err(message)` naming the offending camelCase field,
    /// e.g. `"types[3].weapon out of range"`.
    pub fn from_json(text: &str) -> Result<Ruleset, String> {
        let ruleset: Ruleset = serde_json::from_str(text).map_err(|e| e.to_string())?;
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

        Ok(())
    }
}

/// `value` is `-1` (unspecified) or in `[0, limit)` where `limit` is an i32 bound.
fn is_in_range(value: i32, limit: i32) -> bool {
    value == -1 || (value >= 0 && value < limit)
}
