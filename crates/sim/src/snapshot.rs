//! `Int32Array` snapshot encoding for the client.

use crate::world::{Order, World};

pub const SNAPSHOT_HEADER_LEN: usize = 2;
pub const UNIT_STRIDE: usize = 4;
pub const FLAG_MOVING: i32 = 1;

/// `[tick, unit_count, then per unit ascending id: id, x_raw, y_raw, flags]`
/// flags bit 0 = `FLAG_MOVING` when the order is Move.
pub fn encode_snapshot(world: &World) -> Vec<i32> {
    let mut out = Vec::with_capacity(SNAPSHOT_HEADER_LEN + world.units().len() * UNIT_STRIDE);
    out.push(world.tick() as i32);
    out.push(world.units().len() as i32);
    for unit in world.units() {
        let flags = match unit.order {
            Order::Move { .. } => FLAG_MOVING,
            Order::Idle { .. } => 0,
        };
        out.extend_from_slice(&[unit.id as i32, unit.pos.x.raw(), unit.pos.y.raw(), flags]);
    }
    out
}
