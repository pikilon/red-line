//! `wasm_bindgen` facade over the simulation (API version 2).

use wasm_bindgen::prelude::wasm_bindgen;

use crate::fixed::{Fx, FxVec2};
use crate::hash::state_hash;
use crate::map::Cell;
use crate::rules::{Ruleset, TypeId};
use crate::snapshot::{encode_fog, encode_match_snapshot, encode_snapshot};
use crate::world::{Command, SimError, World};

/// Client-facing text for a setup error; the client matches on these strings.
fn error_text(error: SimError) -> String {
    match error {
        SimError::TooManyUnits { requested, max } => {
            format!("too many units: requested {requested}, max {max}")
        }
        SimError::UnknownMap { id } => format!("unknown map: {id}"),
    }
}

#[wasm_bindgen]
pub struct Sim {
    world: World,
}

#[wasm_bindgen]
impl Sim {
    /// Tech-slice scenario. The error text contains "too many units".
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, unit_count: u32) -> Result<Sim, String> {
        let world = World::tech_slice(u64::from(seed), unit_count).map_err(error_text)?;
        Ok(Sim { world })
    }

    /// Skirmish scenario (§5.6) on the builtin ruleset; the error text contains
    /// "unknown map".
    pub fn skirmish(seed: u32, map_id: &str) -> Result<Sim, String> {
        let world =
            World::skirmish(Ruleset::builtin(), map_id, u64::from(seed)).map_err(error_text)?;
        Ok(Sim { world })
    }

    pub fn map_width(&self) -> u32 {
        u32::from(self.world.map().width())
    }

    pub fn map_height(&self) -> u32 {
        u32::from(self.world.map().height())
    }

    pub fn map_tiles(&self) -> Vec<u8> {
        self.world.map().tiles()
    }

    pub fn tick(&self) -> u32 {
        self.world.tick()
    }

    /// Every entity, not only units (§5.7).
    pub fn unit_count(&self) -> u32 {
        self.world.units().len() as u32
    }

    pub fn player_count(&self) -> u32 {
        self.world.players().len() as u32
    }

    /// Accepts `DebugSpawn` and `DebugSetHp` from now on (§5.8).
    pub fn enable_debug_commands(&mut self) {
        self.world.enable_debug_commands();
    }

    /// Enqueues a move order; the target is given in raw fixed-point values.
    pub fn command_move(&mut self, unit_ids: &[u32], target_x_raw: i32, target_y_raw: i32) {
        self.world.enqueue(Command::Move {
            units: unit_ids.to_vec(),
            target: FxVec2::new(Fx::from_raw(target_x_raw), Fx::from_raw(target_y_raw)),
        });
    }

    /// As `command_move`, but the units are filtered by owner `player` (§5.8).
    pub fn command_move_as(
        &mut self,
        player: u8,
        unit_ids: &[u32],
        target_x_raw: i32,
        target_y_raw: i32,
    ) {
        self.world.enqueue_as(
            player,
            Command::Move {
                units: unit_ids.to_vec(),
                target: FxVec2::new(Fx::from_raw(target_x_raw), Fx::from_raw(target_y_raw)),
            },
        );
    }

    pub fn command_attack(&mut self, player: u8, unit_ids: &[u32], target: u32) {
        self.world.enqueue_as(
            player,
            Command::Attack {
                units: unit_ids.to_vec(),
                target,
            },
        );
    }

    pub fn command_harvest(&mut self, player: u8, unit_ids: &[u32], depot: u32) {
        self.world.enqueue_as(
            player,
            Command::Harvest {
                units: unit_ids.to_vec(),
                depot,
            },
        );
    }

    pub fn command_construct(
        &mut self,
        player: u8,
        dozer: u32,
        kind: TypeId,
        origin_x: i32,
        origin_y: i32,
    ) {
        self.world.enqueue_as(
            player,
            Command::Construct {
                dozer,
                kind,
                origin: Cell {
                    x: origin_x,
                    y: origin_y,
                },
            },
        );
    }

    pub fn command_resume(&mut self, player: u8, unit_ids: &[u32], building: u32) {
        self.world.enqueue_as(
            player,
            Command::Resume {
                units: unit_ids.to_vec(),
                building,
            },
        );
    }

    pub fn command_produce(&mut self, player: u8, building: u32, kind: TypeId) {
        self.world
            .enqueue_as(player, Command::Produce { building, kind });
    }

    pub fn command_cancel(&mut self, player: u8, building: u32) {
        self.world.enqueue_as(player, Command::Cancel { building });
    }

    pub fn command_rally(&mut self, player: u8, building: u32, x_raw: i32, y_raw: i32) {
        self.world.enqueue_as(
            player,
            Command::Rally {
                building,
                target: FxVec2::new(Fx::from_raw(x_raw), Fx::from_raw(y_raw)),
            },
        );
    }

    pub fn command_stop(&mut self, player: u8, unit_ids: &[u32]) {
        self.world.enqueue_as(
            player,
            Command::Stop {
                units: unit_ids.to_vec(),
            },
        );
    }

    pub fn debug_spawn(&mut self, player: u8, kind: TypeId, x_raw: i32, y_raw: i32) {
        self.world.enqueue_as(
            player,
            Command::DebugSpawn {
                kind,
                pos: FxVec2::new(Fx::from_raw(x_raw), Fx::from_raw(y_raw)),
            },
        );
    }

    /// Ignores `player`; the command is enqueued as player 0 (§5.16).
    pub fn debug_set_hp(&mut self, entity: u32, hp: u32) {
        self.world.enqueue_as(0, Command::DebugSetHp { entity, hp });
    }

    pub fn step(&mut self) {
        self.world.step();
    }

    pub fn step_n(&mut self, n: u32) {
        for _ in 0..n {
            self.world.step();
        }
    }

    pub fn snapshot(&self) -> Vec<i32> {
        encode_snapshot(&self.world)
    }

    /// Match snapshot as seen by `viewer`; any other value is the observer (§5.15).
    pub fn snapshot_for(&self, viewer: u8) -> Vec<i32> {
        encode_match_snapshot(&self.world, viewer)
    }

    /// Row-major fog grid as seen by `viewer`; any other value is the observer.
    pub fn fog_for(&self, viewer: u8) -> Vec<u8> {
        encode_fog(&self.world, viewer)
    }

    pub fn state_hash_hex(&self) -> String {
        format!("{:016x}", state_hash(&self.world))
    }
}
