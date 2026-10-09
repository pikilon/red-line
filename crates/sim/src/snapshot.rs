//! `Int32Array` snapshot encoding for the client.

use crate::world::World;

pub const SNAPSHOT_HEADER_LEN: usize = 2;
pub const UNIT_STRIDE: usize = 4;
pub const FLAG_MOVING: i32 = 1;

/// `[tick, unit_count, then per unit ascending id: id, x_raw, y_raw, flags]`
/// flags bit 0 = `FLAG_MOVING` when the order is Move.
pub fn encode_snapshot(world: &World) -> Vec<i32> {
    let _ = world;
    Vec::new()
}
