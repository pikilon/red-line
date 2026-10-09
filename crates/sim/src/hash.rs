//! FNV-1a 64 state hash.

use crate::world::{Order, World};

pub const FNV_OFFSET: u64 = 0xcbf29ce484222325;
pub const FNV_PRIME: u64 = 0x100000001b3;

pub fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(FNV_OFFSET, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME)
    })
}

/// FNV-1a 64 over the canonical little-endian serialisation of the world state.
pub fn state_hash(world: &World) -> u64 {
    let mut bytes = Vec::with_capacity(12 + world.units().len() * 25);
    bytes.extend_from_slice(&world.tick().to_le_bytes());
    bytes.extend_from_slice(&world.next_order_id().to_le_bytes());
    bytes.extend_from_slice(&(world.units().len() as u32).to_le_bytes());
    for unit in world.units() {
        bytes.extend_from_slice(&unit.id.to_le_bytes());
        bytes.extend_from_slice(&unit.pos.x.raw().to_le_bytes());
        bytes.extend_from_slice(&unit.pos.y.raw().to_le_bytes());
        match unit.order {
            Order::Idle { last_order_id } => {
                bytes.push(0);
                bytes.extend_from_slice(&last_order_id.to_le_bytes());
            }
            Order::Move {
                order_id, target, ..
            } => {
                bytes.push(1);
                bytes.extend_from_slice(&order_id.to_le_bytes());
                bytes.extend_from_slice(&target.x.raw().to_le_bytes());
                bytes.extend_from_slice(&target.y.raw().to_le_bytes());
            }
            // Phase 2 orders are hashed by state hash v2 (P2-05).
            _ => {}
        }
    }
    fnv1a64(&bytes)
}
