//! Spec 50: veterancy (AC-50-01..AC-50-09).

mod common;

use common::saves::{load_example, run};
use sim::fixed::FxVec2;
use sim::hash::state_hash;
use sim::map::MapGrid;
use sim::rules::{Ruleset, fx_centi};
use sim::save::{SimState, load_state, save_state};
use sim::snapshot::{ENTITY_STRIDE, MATCH_HEADER_LEN, RANK_SHIFT, encode_match_snapshot};
use sim::world::{Command, World};

fn sandbox() -> World {
    World::sandbox(Ruleset::builtin(), MapGrid::open(40, 24), &[0, 1])
}

fn kind(world: &World, id: &str) -> u16 {
    world.rules().type_index(id).unwrap()
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

/// Spawns a `victim` type enemy at 1 hit point next to `killer`, orders the
/// attack and steps until the victim is gone.
fn kill_one(world: &mut World, killer: u32, victim: &str, rank: u8) {
    let enemy = world.spawn(1, kind(world, victim), at(1500, 1000));
    world.set_rank(enemy, rank);
    world.set_hp(enemy, 1);
    world.enqueue_as(
        0,
        Command::Attack {
            units: vec![killer],
            target: enemy,
        },
    );
    for _ in 0..300 {
        world.step();
        if world.entity(enemy).is_none() {
            return;
        }
    }
    panic!("the {victim} survived");
}

#[test]
fn ac_50_01_a_kill_pays_the_victims_value_and_enough_kills_promote() {
    let mut world = sandbox();
    let tank = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(1000, 1000));
    let base = world.rules().ty(kind(&world, "ua-leopard-2a4")).hp;
    kill_one(&mut world, tank, "ru-supply-truck", 0);
    assert_eq!(world.entity(tank).unwrap().xp, 60);
    assert_eq!(world.entity(tank).unwrap().rank, 0);
    for _ in 0..7 {
        kill_one(&mut world, tank, "ru-supply-truck", 0);
    }
    let unit = world.entity(tank).unwrap();
    assert_eq!((unit.xp, unit.rank), (480, 1), "480 makes a veteran");
    assert_eq!(world.max_hp(unit), base * 120 / 100);
    assert_eq!(unit.hp, base * 120 / 100, "a full unit stays full");
}

#[test]
fn ac_50_02_a_promoted_victim_is_worth_more_and_ranks_can_be_skipped() {
    let mut world = sandbox();
    let tank = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(1000, 600));
    kill_one(&mut world, tank, "ru-rifleman", 3);
    assert_eq!(world.entity(tank).unwrap().xp, 40, "a heroic rifleman");
    world.set_hp(tank, 0);
    world.step();
    let rifleman = world.spawn(0, kind(&world, "ua-rifleman"), at(1000, 1000));
    kill_one(&mut world, rifleman, "ru-pole-21", 0);
    let unit = world.entity(rifleman).unwrap();
    assert_eq!((unit.xp, unit.rank), (90, 2), "90 passes veteran and elite");
}

#[test]
fn ac_50_03_only_trainable_types_and_enemy_kills_count() {
    let mut world = sandbox();
    // An unarmed truck has no thresholds: it never holds a rank.
    let truck = world.spawn(0, kind(&world, "ua-supply-truck"), at(600, 600));
    world.set_rank(truck, 3);
    assert_eq!(world.entity(truck).unwrap().rank, 0);
    // A unit that dies with no enemy hit on it pays nobody.
    let tank = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(1000, 1000));
    let own = world.spawn(0, kind(&world, "ua-rifleman"), at(1200, 1000));
    world.set_hp(own, 0);
    world.step();
    assert_eq!(world.entity(tank).unwrap().xp, 0);
}

#[test]
fn ac_50_04_promotion_keeps_the_share_of_hit_points() {
    let mut world = sandbox();
    let tank = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(1000, 1000));
    let base = world.rules().ty(kind(&world, "ua-leopard-2a4")).hp;
    world.set_hp(tank, base / 2);
    world.set_rank(tank, 3);
    let unit = world.entity(tank).unwrap();
    assert_eq!(world.max_hp(unit), base * 150 / 100);
    assert_eq!(unit.hp, (base / 2 * 150).div_ceil(100));
    assert_eq!(unit.xp, 1920);
}

/// Damage of the first shot of a `rank` Leopard on an enemy HQ-sized target,
/// and the cooldown it leaves.
fn first_shot(rank: u8) -> (u32, u32) {
    let mut world = sandbox();
    let tank = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(1000, 1000));
    world.set_rank(tank, rank);
    let enemy = world.spawn(1, kind(&world, "ru-t-72b3"), at(1400, 1000));
    let full = world.entity(enemy).unwrap().hp;
    world.enqueue_as(
        0,
        Command::Attack {
            units: vec![tank],
            target: enemy,
        },
    );
    let mut cooldown = 0;
    for _ in 0..200 {
        world.step();
        let shooter = world.entity(tank).unwrap();
        if cooldown == 0 && shooter.last_target == Some(enemy) {
            cooldown = shooter.cooldown;
        }
        let hp = world.entity(enemy).unwrap().hp;
        if hp < full {
            return (full - hp, cooldown);
        }
    }
    panic!("no hit");
}

#[test]
fn ac_50_05_rank_raises_damage_and_rate_of_fire() {
    let (damage, cooldown) = first_shot(0);
    let (heroic_damage, heroic_cooldown) = first_shot(3);
    assert_eq!(heroic_damage, damage * 130 / 100);
    assert_eq!(heroic_cooldown, cooldown * 100 / 160);
}

#[test]
fn ac_50_06_elite_and_heroic_units_heal_themselves() {
    let mut world = sandbox();
    let leopard = kind(&world, "ua-leopard-2a4");
    let veteran = world.spawn(0, leopard, at(600, 600));
    let elite = world.spawn(0, leopard, at(1000, 600));
    world.set_rank(veteran, 1);
    world.set_rank(elite, 2);
    world.set_hp(veteran, 300);
    world.set_hp(elite, 300);
    for _ in 0..150 {
        world.step();
    }
    assert_eq!(world.entity(veteran).unwrap().hp, 300);
    let max = world.max_hp(world.entity(elite).unwrap());
    // 1 % of the maximum every 15 ticks, 10 times.
    assert_eq!(world.entity(elite).unwrap().hp, 300 + 10 * (max / 100));
    for _ in 0..3000 {
        world.step();
    }
    assert_eq!(world.entity(elite).unwrap().hp, max, "it stops at full");
}

#[test]
fn ac_50_07_rank_is_hashed_saved_and_restored() {
    let mut world = World::skirmish(Ruleset::builtin(), "first-line", 1).unwrap();
    let tank = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(1000, 1000));
    let plain = state_hash(&world);
    world.set_rank(tank, 2);
    assert_ne!(state_hash(&world), plain);
    let text = serde_json::to_string(&save_state(&world, 1, &[]).unwrap()).unwrap();
    let state: SimState = serde_json::from_str(&text).unwrap();
    let (loaded, _, _) = load_state(&state).unwrap();
    let unit = loaded.entity(tank).unwrap();
    assert_eq!((unit.xp, unit.rank), (960, 2));
    assert_eq!(state_hash(&loaded), state_hash(&world));
}

#[test]
fn ac_50_08_the_snapshot_carries_the_rank_in_the_flags() {
    let mut world = sandbox();
    let tank = world.spawn(0, kind(&world, "ua-leopard-2a4"), at(1000, 1000));
    world.set_rank(tank, 3);
    world.step();
    let snapshot = encode_match_snapshot(&world, 0);
    let row = (0..snapshot[7] as usize)
        .map(|i| MATCH_HEADER_LEN + i * ENTITY_STRIDE)
        .find(|&base| snapshot[base] == tank as i32)
        .unwrap();
    assert_eq!((snapshot[row + 6] >> RANK_SHIFT) & 3, 3);
}

#[test]
fn ac_50_09_a_launchers_drone_kills_go_to_the_launcher() {
    let mut world = sandbox();
    let team = world.spawn(0, kind(&world, "ua-fpv-team"), at(1000, 1000));
    let enemy = world.spawn(1, kind(&world, "ru-brdm-scout"), at(1600, 1000));
    world.set_hp(enemy, 1);
    for _ in 0..600 {
        world.step();
        if world.entity(enemy).is_none() {
            break;
        }
    }
    assert!(world.entity(enemy).is_none(), "the drone killed the scout");
    assert_eq!(world.entity(team).unwrap().xp, 30);
}

#[test]
fn ac_50_10_the_example_save_promotes_its_rookie() {
    let (mut world, _, mut ais) = load_example("veterancy");
    let ranks: Vec<u8> = world.entities().iter().map(|e| e.rank).collect();
    assert_eq!(&ranks[..5], &[0, 1, 2, 3, 3]);
    let mut promoted_at = [0u32; 2];
    for tick in 1..=1800 {
        run(&mut world, &mut ais, 1);
        let rank = world.entity(0).unwrap().rank;
        for (index, at) in promoted_at.iter_mut().enumerate() {
            if *at == 0 && usize::from(rank) > index {
                *at = tick;
            }
        }
    }

    assert!(promoted_at[0] > 0, "the rookie becomes a veteran");
    assert!(promoted_at[1] > promoted_at[0], "and then elite");
}
