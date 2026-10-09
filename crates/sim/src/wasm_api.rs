//! `wasm_bindgen` facade over the simulation (API version 1).

use wasm_bindgen::prelude::wasm_bindgen;

use crate::fixed::{Fx, FxVec2};
use crate::hash::state_hash;
use crate::snapshot::encode_snapshot;
use crate::world::{Command, SimError, World};

#[wasm_bindgen]
pub struct Sim {
    world: World,
}

#[wasm_bindgen]
impl Sim {
    /// Tech-slice scenario. The error text contains "too many units".
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, unit_count: u32) -> Result<Sim, String> {
        let world = World::tech_slice(u64::from(seed), unit_count).map_err(|e| match e {
            SimError::TooManyUnits { requested, max } => {
                format!("too many units: requested {requested}, max {max}")
            }
            SimError::UnknownMap { id } => format!("unknown map: {id}"),
        })?;
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

    pub fn unit_count(&self) -> u32 {
        self.world.units().len() as u32
    }

    /// Enqueues a move order; the target is given in raw fixed-point values.
    pub fn command_move(&mut self, unit_ids: &[u32], target_x_raw: i32, target_y_raw: i32) {
        self.world.enqueue(Command::Move {
            units: unit_ids.to_vec(),
            target: FxVec2::new(Fx::from_raw(target_x_raw), Fx::from_raw(target_y_raw)),
        });
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

    pub fn state_hash_hex(&self) -> String {
        format!("{:016x}", state_hash(&self.world))
    }
}
