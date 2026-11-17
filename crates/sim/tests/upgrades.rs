//! Spec 52: upgrades purchased at buildings (AC-52-01..AC-52-07).

use sim::ai::Ai;
use sim::fixed::FxVec2;
use sim::hash::state_hash;
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::save::{load_state, save_state};
use sim::world::{Command, World};

const START: u32 = 10_000;

fn kind(world: &World, id: &str) -> u16 {
    world.rules().type_index(id).unwrap()
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

/// Player 0 (Russia, faction 1) with two power plants, barracks and vehicle
/// factory; player 1 Ukraine.
fn base() -> (World, u32, u32) {
    let mut world = World::sandbox(Ruleset::builtin(), MapGrid::open(48, 32), &[1, 0]);
    world.set_credits(0, START);
    world.place_building(0, kind(&world, "ru-power-plant"), Cell { x: 0, y: 0 }, true);
    world.place_building(0, kind(&world, "ru-power-plant"), Cell { x: 4, y: 0 }, true);
    let barracks = world.place_building(0, kind(&world, "ru-barracks"), Cell { x: 8, y: 0 }, true);
    let factory = world.place_building(
        0,
        kind(&world, "ru-vehicle-factory"),
        Cell { x: 12, y: 0 },
        true,
    );
    (world, barracks, factory)
}

fn credits(world: &World) -> u32 {
    world.player(0).unwrap().credits
}

fn queue_len(world: &World, building: u32) -> usize {
    world
        .entity(building)
        .unwrap()
        .site
        .as_ref()
        .unwrap()
        .queue
        .len()
}

fn produce(world: &mut World, building: u32, kind: u16) {
    world.enqueue_as(0, Command::Produce { building, kind });
    world.step();
}

#[test]
fn ac_52_01_an_upgrade_is_paid_queued_and_then_owned() {
    let (mut world, barracks, _) = base();
    let armor = kind(&world, "ru-ratnik-armor");
    let cost = world.rules().ty(armor).cost;
    produce(&mut world, barracks, armor);
    assert_eq!(credits(&world), START - cost);
    assert_eq!(queue_len(&world, barracks), 1);
    let units = world.entities().len();
    for _ in 0..world.rules().ty(armor).build_ticks + 5 {
        world.step();
    }
    assert_eq!(queue_len(&world, barracks), 0);
    assert_eq!(world.player(0).unwrap().upgrades(), &[armor]);
    assert_eq!(world.entities().len(), units, "nothing spawns");
}

#[test]
fn ac_52_02_health_raises_existing_and_new_units() {
    let (mut world, _, _) = base();
    let rifleman = kind(&world, "ru-rifleman");
    let base_hp = world.rules().ty(rifleman).hp;
    let old = world.spawn(0, rifleman, at(1000, 1500));
    let hurt = world.spawn(0, rifleman, at(1200, 1500));
    world.set_hp(hurt, base_hp / 2);
    let tank = world.spawn(0, kind(&world, "ru-t-72b3"), at(1500, 1500));
    world.grant_upgrade(0, kind(&world, "ru-ratnik-armor"));
    let upgraded = base_hp * 125 / 100;
    let unit = world.entity(old).unwrap();
    assert_eq!((world.max_hp(unit), unit.hp), (upgraded, upgraded));
    assert_eq!(
        world.entity(hurt).unwrap().hp,
        base_hp / 2 + (upgraded - base_hp)
    );
    let tank = world.entity(tank).unwrap();
    assert_eq!(
        tank.hp,
        world.rules().ty(tank.kind).hp,
        "tanks are not infantry"
    );
    let new = world.spawn(0, rifleman, at(1000, 1800));
    assert_eq!(world.entity(new).unwrap().hp, upgraded);
    let enemy = world.spawn(1, kind(&world, "ua-rifleman"), at(3000, 1800));
    let enemy = world.entity(enemy).unwrap();
    assert_eq!(
        enemy.hp,
        world.rules().ty(enemy.kind).hp,
        "only the owner gains"
    );
}

/// Damage one `ua-rifleman` deals to a `ru-rifleman` in its first hit.
fn first_hit(upgraded: bool) -> u32 {
    let mut world = World::sandbox(Ruleset::builtin(), MapGrid::open(40, 24), &[0, 1]);
    if upgraded {
        world.grant_upgrade(0, kind(&world, "ua-western-optics"));
    }
    let shooter = world.spawn(0, kind(&world, "ua-rifleman"), at(1000, 1000));
    let target = world.spawn(1, kind(&world, "ru-rifleman"), at(1300, 1000));
    let full = world.entity(target).unwrap().hp;
    world.enqueue_as(
        0,
        Command::Attack {
            units: vec![shooter],
            target,
        },
    );
    for _ in 0..300 {
        world.step();
        let hp = world.entity(target).unwrap().hp;
        if hp < full {
            return full - hp;
        }
    }
    panic!("no hit");
}

#[test]
fn ac_52_03_damage_upgrade_hits_harder() {
    let (plain, upgraded) = (first_hit(false), first_hit(true));
    assert!(upgraded > plain, "{upgraded} > {plain}");
    assert!(upgraded <= plain * 120 / 100 + 1);
}

#[test]
fn ac_52_04_an_upgrade_is_bought_once() {
    let (mut world, barracks, _) = base();
    let armor = kind(&world, "ru-ratnik-armor");
    let cost = world.rules().ty(armor).cost;
    produce(&mut world, barracks, armor);
    produce(&mut world, barracks, armor);
    assert_eq!(
        (queue_len(&world, barracks), credits(&world)),
        (1, START - cost)
    );
    for _ in 0..world.rules().ty(armor).build_ticks + 5 {
        world.step();
    }
    produce(&mut world, barracks, armor);
    assert_eq!(
        (queue_len(&world, barracks), credits(&world)),
        (0, START - cost)
    );
}

#[test]
fn ac_52_05_cancel_and_destruction_refund_the_queue() {
    let (mut world, barracks, factory) = base();
    let armor = kind(&world, "ru-kontakt-5");
    let tank = kind(&world, "ru-t-72b3");
    produce(&mut world, factory, armor);
    world.enqueue_as(0, Command::Cancel { building: factory });
    world.step();
    assert_eq!(credits(&world), START);
    produce(&mut world, factory, armor);
    produce(&mut world, factory, tank);
    let ratnik = kind(&world, "ru-ratnik-armor");
    produce(&mut world, barracks, ratnik);
    let left = credits(&world);
    let refund = world.rules().ty(armor).cost + world.rules().ty(tank).cost;
    world.set_hp(factory, 0);
    world.step();
    assert!(world.entity(factory).is_none());
    assert_eq!(
        credits(&world),
        left + refund,
        "the factory queue comes back"
    );
    assert_eq!(queue_len(&world, barracks), 1, "other queues stay");
}

#[test]
fn ac_52_06_upgrades_survive_save_and_load() {
    let mut world = World::skirmish(Ruleset::builtin(), "first-line", 1).unwrap();
    let plain = state_hash(&world);
    let armor = kind(&world, "ua-western-optics");
    world.grant_upgrade(0, armor);
    assert_ne!(state_hash(&world), plain);
    let state = save_state(&world, 1, &[]).unwrap();
    let text = serde_json::to_string(&state).unwrap();
    assert!(text.contains("\"upgrades\":[\"ua-western-optics\"]"));
    let (loaded, _, _) = load_state(&state).unwrap();
    assert_eq!(loaded.player(0).unwrap().upgrades(), &[armor]);
    assert_eq!(state_hash(&loaded), state_hash(&world));
}

#[test]
fn ac_52_07_the_ai_buys_its_upgrades() {
    let (mut world, barracks, _) = base();
    let mut ai = Ai::new(&world, 0, "russia-balanced", 1).unwrap();
    let armor = kind(&world, "ru-ratnik-armor");
    let min_tick =
        world.rules().ai[world.rules().ai_index("russia-balanced").unwrap()].upgrades[0].min_tick;
    let mut queued = false;
    for _ in 0..min_tick + 200 {
        if world.tick() % 15 == 0 {
            for command in ai.think(&world) {
                world.enqueue_as(0, command);
            }
        }
        world.step();
        let site = world.entity(barracks).unwrap().site.as_ref().unwrap();
        if site.queue.iter().any(|item| item.kind == armor) {
            assert!(world.tick() > min_tick, "not before minTick");
            queued = true;
            break;
        }
    }
    assert!(queued, "the AI queued Ratnik armour");
}
