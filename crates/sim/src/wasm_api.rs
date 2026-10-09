//! `wasm_bindgen` facade over the simulation (API version 1).

use wasm_bindgen::prelude::wasm_bindgen;

use crate::world::World;

#[wasm_bindgen]
pub struct Sim {
    world: World,
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new(_seed: u32, _unit_count: u32) -> Result<Sim, String> {
        Ok(Sim {
            world: World::new(crate::map::MapGrid::open(1, 1)),
        })
    }
    pub fn map_width(&self) -> u32 {
        0
    }
    pub fn map_height(&self) -> u32 {
        0
    }
    pub fn map_tiles(&self) -> Vec<u8> {
        Vec::new()
    }
    pub fn tick(&self) -> u32 {
        self.world.tick()
    }
    pub fn unit_count(&self) -> u32 {
        0
    }
    pub fn command_move(&mut self, _unit_ids: &[u32], _target_x_raw: i32, _target_y_raw: i32) {}
    pub fn step(&mut self) {}
    pub fn step_n(&mut self, _n: u32) {}
    pub fn snapshot(&self) -> Vec<i32> {
        Vec::new()
    }
    pub fn state_hash_hex(&self) -> String {
        String::new()
    }
}
