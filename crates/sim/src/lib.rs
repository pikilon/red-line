//! Deterministic simulation core. No rendering, time, I/O or browser access.

use wasm_bindgen::prelude::wasm_bindgen;

pub mod ai;
pub mod angle;
pub mod combat;
pub mod crush;
pub mod economy;
pub mod entity;
pub mod fixed;
pub mod flow;
pub mod hash;
pub mod locomotor;
pub mod map;
pub mod nav;
pub mod player;
pub mod rng;
pub mod rules;
pub mod save;
pub mod snapshot;
pub mod vision;
pub mod wasm_api;
pub mod world;
pub mod yielding;

/// Version of the simulation API exposed to the client through WASM.
pub const API_VERSION: u32 = 4;

/// Returns the simulation API version.
#[wasm_bindgen]
pub fn api_version() -> u32 {
    API_VERSION
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_version_is_zero_in_the_skeleton() {
        assert_eq!(api_version(), 4);
    }
}
