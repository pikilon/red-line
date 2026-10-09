//! FNV-1a 64 state hash.

use crate::world::World;

pub const FNV_OFFSET: u64 = 0xcbf29ce484222325;
pub const FNV_PRIME: u64 = 0x100000001b3;

pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let _ = bytes;
    0
}

pub fn state_hash(world: &World) -> u64 {
    let _ = world;
    0
}
