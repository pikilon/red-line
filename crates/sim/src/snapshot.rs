//! `Int32Array` snapshot encoding for the client.

use crate::entity::{Entity, EntityId, Ghost, Order, PlayerId};
use crate::map::Cell;
use crate::nav::footprint_center;
use crate::rules::QUEUE_SLOTS;
use crate::world::{Outcome, World};

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
        let flags = if matches!(unit.order, Order::Move { .. }) {
            FLAG_MOVING
        } else {
            0
        };
        out.extend_from_slice(&[unit.id as i32, unit.pos.x.raw(), unit.pos.y.raw(), flags]);
    }
    out
}

/// Header of the Phase 2 match snapshot (§5.15): `tick, viewer, credits,
/// power_produced, power_consumed, outcome tag, winner (-1 if none),
/// entity_count`.
pub const MATCH_HEADER_LEN: usize = 8;
/// One entity record: `id, owner, kind, pos.x, pos.y, hp, flags, progress,
/// target`.
pub const ENTITY_STRIDE: usize = 9;
/// One production queue record: `building_id, head permille, queue_len` plus
/// `QUEUE_SLOTS` kinds.
pub const QUEUE_STRIDE: usize = 12;

pub const FLAG_UNDER_CONSTRUCTION: i32 = 2;
pub const FLAG_GHOST: i32 = 4;
pub const FLAG_FIRED: i32 = 8;
/// `requires_power` and the owner has a power deficit.
pub const FLAG_POWERED_OFF: i32 = 16;

/// Phase 2 match snapshot (§5.15): header, then every entity visible to
/// `viewer` plus, for a player viewer, its ghosts, then the viewer's
/// production queues. A viewer that is not a player id is the observer.
pub fn encode_match_snapshot(world: &World, viewer: PlayerId) -> Vec<i32> {
    let player = world.player(viewer);
    let mut out = Vec::new();
    out.push(world.tick() as i32);
    out.push(i32::from(viewer));
    match player {
        Some(player) => {
            let (produced, consumed) = player.power();
            out.push(player.credits as i32);
            out.push(produced as i32);
            out.push(consumed as i32);
        }
        // The observer owns nothing: no credits and no power.
        None => out.extend_from_slice(&[0, 0, 0]),
    }
    let (tag, winner) = match world.outcome() {
        Outcome::Ongoing => (0, -1),
        Outcome::Winner(id) => (1, i32::from(id)),
        Outcome::Draw => (2, -1),
    };
    out.push(tag);
    out.push(winner);

    let mut rows: Vec<(EntityId, [i32; ENTITY_STRIDE])> = Vec::new();
    for entity in world.entities() {
        if world.is_entity_visible(viewer, entity.id) {
            rows.push((entity.id, entity_row(world, entity)));
        }
    }
    if let Some(player) = player {
        for (&id, ghost) in player.ghosts() {
            // A ghost whose entity exists and is visible is already listed.
            let listed = world
                .entity(id)
                .is_some_and(|_| world.is_entity_visible(viewer, id));
            if !listed {
                rows.push((id, ghost_row(world, id, ghost)));
            }
        }
    }
    rows.sort_by_key(|&(id, _)| id);

    out.push(rows.len() as i32);
    for (_, row) in rows {
        out.extend_from_slice(&row);
    }

    let mut queues: Vec<i32> = Vec::new();
    let mut queue_count = 0;
    if let Some(player) = player {
        for entity in world.entities() {
            if entity.owner != player.id {
                continue;
            }
            let Some(site) = &entity.site else {
                continue;
            };
            let Some(head) = site.queue.first() else {
                continue;
            };
            queue_count += 1;
            queues.push(entity.id as i32);
            queues.push(progress_permille(
                head.progress,
                world.rules().ty(head.kind).build_ticks,
            ));
            queues.push(site.queue.len() as i32);
            for slot in 0..QUEUE_SLOTS {
                let kind = site.queue.get(slot).map_or(-1, |item| i32::from(item.kind));
                queues.push(kind);
            }
        }
    }
    out.push(queue_count);
    out.extend_from_slice(&queues);
    out
}

/// Row-major `World::fog` values (§5.15).
pub fn encode_fog(world: &World, viewer: PlayerId) -> Vec<u8> {
    let map = world.terrain();
    let mut out = Vec::with_capacity(usize::from(map.width()) * usize::from(map.height()));
    for y in 0..map.height() {
        for x in 0..map.width() {
            out.push(world.fog(
                viewer,
                Cell {
                    x: i32::from(x),
                    y: i32::from(y),
                },
            ));
        }
    }
    out
}

/// `id, owner, kind, pos.x raw, pos.y raw, hp, flags, progress, target`.
fn entity_row(world: &World, entity: &Entity) -> [i32; ENTITY_STRIDE] {
    [
        entity.id as i32,
        i32::from(entity.owner),
        i32::from(entity.kind),
        entity.pos.x.raw(),
        entity.pos.y.raw(),
        entity.hp as i32,
        entity_flags(world, entity),
        entity_progress(world, entity),
        entity.last_target.map_or(-1, |target| target as i32),
    ]
}

/// Ghost: the footprint centre from the ghost, `hp -1`, `FLAG_GHOST`,
/// `progress 0` and no target.
fn ghost_row(world: &World, id: EntityId, ghost: &Ghost) -> [i32; ENTITY_STRIDE] {
    let size = world.rules().ty(ghost.kind).footprint;
    let center = footprint_center(ghost.origin, size);
    [
        id as i32,
        i32::from(ghost.owner),
        i32::from(ghost.kind),
        center.x.raw(),
        center.y.raw(),
        -1,
        FLAG_GHOST,
        0,
        -1,
    ]
}

fn entity_flags(world: &World, entity: &Entity) -> i32 {
    let mut flags = 0;
    if entity.site.is_none() && !matches!(entity.order, Order::Idle { .. }) {
        flags |= FLAG_MOVING;
    }
    if entity.site.as_ref().is_some_and(|site| !site.complete) {
        flags |= FLAG_UNDER_CONSTRUCTION;
    }
    if entity.last_target.is_some() {
        flags |= FLAG_FIRED;
    }
    if world.rules().ty(entity.kind).requires_power && power_deficit(world, entity.owner) {
        flags |= FLAG_POWERED_OFF;
    }
    flags
}

/// Incomplete buildings show how far they are; every other entity is either
/// finished (1000) or has no progress (0).
fn entity_progress(world: &World, entity: &Entity) -> i32 {
    let Some(site) = &entity.site else {
        return 0;
    };
    if site.complete {
        return 1000;
    }
    progress_permille(site.progress, world.rules().ty(entity.kind).build_ticks)
}

/// `progress * 1000 / (build_ticks * 100)`, 0 when the type has no build time.
fn progress_permille(progress: u32, build_ticks: u32) -> i32 {
    let total = u64::from(build_ticks) * 100;
    (u64::from(progress) * 1000).checked_div(total).unwrap_or(0) as i32
}

/// A `requires_power` building is off while its owner consumes more power than
/// it produces (§5.11, `FLAG_POWERED_OFF`).
fn power_deficit(world: &World, owner: PlayerId) -> bool {
    world.player(owner).is_some_and(|player| {
        let (produced, consumed) = player.power();
        produced < consumed
    })
}
