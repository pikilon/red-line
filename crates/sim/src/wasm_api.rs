//! `wasm_bindgen` facade over the simulation (API version 4).

use wasm_bindgen::prelude::wasm_bindgen;

use crate::ai::{Ai, step_with_ai};
use crate::fixed::{Fx, FxVec2};
use crate::hash::state_hash;
use crate::map::Cell;
use crate::rules::{Ruleset, TypeId};
use crate::save::{Setup, SimState, from_setup, load_state, save_state};
use std::collections::BTreeMap;

use crate::entity::EntityId;
use crate::snapshot::{
    encode_combat, encode_features, encode_fog, encode_match_snapshot_with_shots, encode_snapshot,
    features_signature,
};
use crate::world::{CombatEvent, Command, SimError, World};

/// Client-facing text for a setup error; the client matches on these strings.
fn error_text(error: SimError) -> String {
    error.to_string()
}

#[wasm_bindgen]
pub struct Sim {
    world: World,
    /// Seed the world was built with; the AI rng seed (§5.7).
    seed: u64,
    /// Attached AIs, ascending player order (§5.7).
    ais: Vec<Ai>,
    /// Shots fired since the last match snapshot (shooter -> target), so a
    /// snapshot taken after several steps still reports them.
    shots: BTreeMap<EntityId, EntityId>,
    /// Combat events since the last `combat_for`, so several `step` calls
    /// before one snapshot still report them (spec 17 §4.7).
    pending_events: Vec<CombatEvent>,
    /// Signature of the feature table the last `features_for` call sent.
    features_sent: Option<u64>,
}

#[wasm_bindgen]
impl Sim {
    /// Tech-slice scenario. The error text contains "too many units".
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, unit_count: u32) -> Result<Sim, String> {
        let world = World::tech_slice(u64::from(seed), unit_count).map_err(error_text)?;
        Ok(Sim {
            world,
            seed: u64::from(seed),
            ais: Vec::new(),
            shots: BTreeMap::new(),
            pending_events: Vec::new(),
            features_sent: None,
        })
    }

    /// Skirmish scenario (§5.6) on the builtin ruleset; the error text contains
    /// "unknown map".
    pub fn skirmish(seed: u32, map_id: &str) -> Result<Sim, String> {
        let world =
            World::skirmish(Ruleset::builtin(), map_id, u64::from(seed)).map_err(error_text)?;
        Ok(Sim {
            world,
            seed: u64::from(seed),
            ais: Vec::new(),
            shots: BTreeMap::new(),
            pending_events: Vec::new(),
            features_sent: None,
        })
    }

    /// Setup-form world (spec 19 §3.5) from the JSON of a `Setup`.
    pub fn from_setup(json: &str) -> Result<Sim, String> {
        let setup: Setup = serde_json::from_str(json).map_err(|e| format!("invalid setup: {e}"))?;
        let (world, seed, ais) = from_setup(&setup)?;
        Ok(Sim::wrap(world, seed, ais))
    }

    /// World-form state (spec 19 §3.2) from the JSON of a `SimState`.
    pub fn load_state(json: &str) -> Result<Sim, String> {
        let state: SimState =
            serde_json::from_str(json).map_err(|e| format!("invalid save: {e}"))?;
        let (world, seed, ais) = load_state(&state)?;
        Ok(Sim::wrap(world, seed, ais))
    }

    /// JSON of the world state and its AIs (spec 19 §3.7).
    pub fn save_state(&self) -> Result<String, String> {
        let state = save_state(&self.world, self.seed, &self.ais)?;
        serde_json::to_string(&state).map_err(|e| e.to_string())
    }

    /// Attaches an AI with the given personality to `player` (seed = the Sim
    /// seed). Errors with `Ai::new`'s message. A player may have at most one
    /// AI; attaching again replaces it (§5.7).
    pub fn attach_ai(&mut self, player: u8, personality: &str) -> Result<(), String> {
        let ai = Ai::new(&self.world, player, personality, self.seed)?;
        self.ais.retain(|existing| existing.player() != player);
        self.ais.push(ai);
        self.ais.sort_by_key(Ai::player);
        Ok(())
    }

    /// Pauses or resumes the AI of `player`, enqueuing `Ai::set_active`'s
    /// commands as `player`. Returns false (and does nothing) when `player`
    /// has no AI (spec 08 §3.3).
    pub fn set_ai_active(&mut self, player: u8, active: bool) -> bool {
        let Some(ai) = self.ais.iter_mut().find(|ai| ai.player() == player) else {
            return false;
        };
        for command in ai.set_active(active) {
            self.world.enqueue_as(player, command);
        }
        true
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

    pub fn command_attack_ground(&mut self, player: u8, unit_ids: &[u32], x_raw: i32, y_raw: i32) {
        self.world.enqueue_as(
            player,
            Command::AttackGround {
                units: unit_ids.to_vec(),
                target: FxVec2::new(Fx::from_raw(x_raw), Fx::from_raw(y_raw)),
            },
        );
    }

    /// Spec 31 block 2: `unit_ids` walk to feature `feature` and garrison it.
    pub fn command_garrison(&mut self, player: u8, unit_ids: &[u32], feature: u32) {
        self.world.enqueue_as(
            player,
            Command::Garrison {
                units: unit_ids.to_vec(),
                feature,
            },
        );
    }

    /// Spec 31 block 2: evacuate the garrisoned feature `feature`.
    pub fn command_unload(&mut self, player: u8, feature: u32) {
        self.world.enqueue_as(player, Command::Unload { feature });
    }

    /// Spec 32: `unit_ids` walk to the own vehicle `carrier` and board it.
    pub fn command_board(&mut self, player: u8, unit_ids: &[u32], carrier: u32) {
        self.world.enqueue_as(
            player,
            Command::Board {
                units: unit_ids.to_vec(),
                carrier,
            },
        );
    }

    /// Spec 32: the riders of `carrier` leave it, one at a time.
    pub fn command_disembark(&mut self, player: u8, carrier: u32) {
        self.world
            .enqueue_as(player, Command::Disembark { carrier });
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
        step_with_ai(&mut self.world, &mut self.ais);
        self.record_shots();
        self.record_events();
    }

    pub fn step_n(&mut self, n: u32) {
        for _ in 0..n {
            step_with_ai(&mut self.world, &mut self.ais);
            self.record_shots();
            self.record_events();
        }
    }

    pub fn snapshot(&self) -> Vec<i32> {
        encode_snapshot(&self.world)
    }

    /// Match snapshot as seen by `viewer`; any other value is the observer (§5.15).
    /// Shots fired since the previous call are reported with `FLAG_FIRED`
    /// even when they happened in an earlier step.
    pub fn snapshot_for(&mut self, viewer: u8) -> Vec<i32> {
        let out = encode_match_snapshot_with_shots(&self.world, viewer, &self.shots);
        self.shots.clear();
        out
    }

    /// Row-major fog grid as seen by `viewer`; any other value is the observer.
    pub fn fog_for(&self, viewer: u8) -> Vec<u8> {
        encode_fog(&self.world, viewer)
    }

    /// Combat snapshot as seen by `viewer`; any other value is the observer.
    /// The events of every step since the previous call are reported once,
    /// then cleared (spec 17 §4.7).
    pub fn combat_for(&mut self, viewer: u8) -> Vec<i32> {
        let out = encode_combat(&self.world, viewer, &self.pending_events);
        self.pending_events.clear();
        out
    }

    /// Feature table (spec 31): empty when it has not changed since the last
    /// call, otherwise `[count, then per feature: index, kind, state, flags,
    /// hit points in permille]`. The first call always sends the table.
    pub fn features_for(&mut self) -> Vec<i32> {
        let signature = features_signature(&self.world);
        if self.features_sent == Some(signature) {
            return Vec::new();
        }
        self.features_sent = Some(signature);
        encode_features(&self.world)
    }

    pub fn state_hash_hex(&self) -> String {
        format!("{:016x}", state_hash(&self.world))
    }
}

impl Sim {
    /// Wraps an existing world in a `Sim` for the native tests; not part of the
    /// WASM API.
    #[doc(hidden)]
    pub fn from_world(world: World) -> Sim {
        Sim {
            world,
            seed: 0,
            ais: Vec::new(),
            shots: BTreeMap::new(),
            pending_events: Vec::new(),
            features_sent: None,
        }
    }

    fn wrap(world: World, seed: u64, ais: Vec<Ai>) -> Sim {
        Sim {
            world,
            seed,
            ais,
            shots: BTreeMap::new(),
            pending_events: Vec::new(),
            features_sent: None,
        }
    }

    fn record_shots(&mut self) {
        for entity in self.world.entities() {
            if let Some(target) = entity.last_target {
                self.shots.insert(entity.id, target);
            }
        }
    }

    fn record_events(&mut self) {
        self.pending_events.extend_from_slice(self.world.events());
    }
}
