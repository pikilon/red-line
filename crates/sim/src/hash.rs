//! FNV-1a 64 state hash (v2, spec §5.14).

use crate::entity::{Entity, HarvestPhase, Order, Site};
use crate::player::Player;
use crate::world::{Outcome, World};

pub const FNV_OFFSET: u64 = 0xcbf29ce484222325;
pub const FNV_PRIME: u64 = 0x100000001b3;

pub fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(FNV_OFFSET, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME)
    })
}

/// FNV-1a 64 over the canonical little-endian serialisation of the world state.
/// Derived data (nav grid, flow fields, visibility, power) and pending commands
/// are not hashed.
pub fn state_hash(world: &World) -> u64 {
    let mut out = Vec::with_capacity(64 + world.entities.len() * 48);
    put_u32(&mut out, world.tick);
    put_u32(&mut out, world.next_order_id);
    put_u32(&mut out, world.next_entity_id);
    let (tag, winner) = match world.outcome {
        Outcome::Ongoing => (0, 255),
        Outcome::Winner(player) => (1, player),
        Outcome::Draw => (2, 255),
    };
    out.extend_from_slice(&[tag, winner]);
    put_u32(&mut out, world.players.len() as u32);
    for player in &world.players {
        put_player(&mut out, player);
    }
    put_u32(&mut out, world.entities.len() as u32);
    for entity in &world.entities {
        put_entity(&mut out, entity);
    }
    put_u32(&mut out, world.projectiles.len() as u32);
    for projectile in &world.projectiles {
        out.push(projectile.owner);
        put_u16(&mut out, projectile.weapon);
        put_u32(&mut out, projectile.target);
        put_i32(&mut out, projectile.impact.x.raw());
        put_i32(&mut out, projectile.impact.y.raw());
        put_u32(&mut out, projectile.impact_tick);
    }
    fnv1a64(&out)
}

fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_i32(out: &mut Vec<u8>, value: i32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_player(out: &mut Vec<u8>, player: &Player) {
    out.extend_from_slice(&[player.id, player.faction]);
    put_u32(out, player.credits);
    out.push(u8::from(player.defeated));
    // Bit i % 8 of byte i / 8 is cell i.
    let mut packed = vec![0u8; player.explored.len().div_ceil(8)];
    for (cell, _) in player.explored.iter().enumerate().filter(|(_, e)| **e) {
        packed[cell / 8] |= 1 << (cell % 8);
    }
    out.extend_from_slice(&packed);
    put_u32(out, player.ghosts.len() as u32);
    for (&id, ghost) in &player.ghosts {
        put_u32(out, id);
        put_u16(out, ghost.kind);
        out.push(ghost.owner);
        put_i32(out, ghost.origin.x);
        put_i32(out, ghost.origin.y);
    }
}

fn put_entity(out: &mut Vec<u8>, entity: &Entity) {
    put_u32(out, entity.id);
    out.push(entity.owner);
    put_u16(out, entity.kind);
    put_i32(out, entity.pos.x.raw());
    put_i32(out, entity.pos.y.raw());
    put_u32(out, entity.hp);
    put_u32(out, entity.cooldown);
    put_u32(out, entity.cargo);
    put_u32(out, entity.last_target.unwrap_or(u32::MAX));
    put_order(out, &entity.order);
    put_site(out, entity.site.as_ref());
}

fn put_order(out: &mut Vec<u8>, order: &Order) {
    match *order {
        Order::Idle { last_order_id } => {
            out.push(0);
            put_u32(out, last_order_id);
        }
        Order::Move {
            order_id, target, ..
        } => {
            out.push(1);
            put_u32(out, order_id);
            put_i32(out, target.x.raw());
            put_i32(out, target.y.raw());
        }
        Order::Attack { order_id, target } => {
            out.push(2);
            put_u32(out, order_id);
            put_u32(out, target);
        }
        Order::Harvest {
            order_id,
            depot,
            center,
            phase,
            timer,
        } => {
            out.push(3);
            put_u32(out, order_id);
            put_u32(out, depot);
            put_u32(out, center.unwrap_or(u32::MAX));
            out.push(match phase {
                HarvestPhase::ToDepot => 0,
                HarvestPhase::Loading => 1,
                HarvestPhase::ToCenter => 2,
                HarvestPhase::Unloading => 3,
            });
            put_u32(out, timer);
        }
        Order::Build { order_id, building } => {
            out.push(4);
            put_u32(out, order_id);
            put_u32(out, building);
        }
    }
}

fn put_site(out: &mut Vec<u8>, site: Option<&Site>) {
    let Some(site) = site else {
        out.push(0);
        return;
    };
    out.push(1);
    put_i32(out, site.origin.x);
    put_i32(out, site.origin.y);
    put_u32(out, site.progress);
    out.push(u8::from(site.complete));
    match site.rally {
        None => out.push(0),
        Some(rally) => {
            out.push(1);
            put_i32(out, rally.x.raw());
            put_i32(out, rally.y.raw());
        }
    }
    out.push(site.queue.len() as u8);
    for item in &site.queue {
        put_u16(out, item.kind);
        put_u32(out, item.progress);
    }
}
