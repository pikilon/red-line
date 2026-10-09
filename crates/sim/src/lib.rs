//! Deterministic simulation core. No rendering, time, I/O or browser access.

use wasm_bindgen::prelude::wasm_bindgen;

pub mod fixed;
pub mod rng;

/// Version of the simulation API exposed to the client through WASM.
pub const API_VERSION: u32 = 0;

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
        assert_eq!(api_version(), 0);
    }
}
