//! Spec 43: air power, one-way units, sorties, launched drones and jamming.
//!
//! Every test runs on the builtin ruleset (`data/factions/*.yaml`) in a small
//! open sandbox: player 0 is Ukraine, player 1 is Russia.

mod common;

use common::saves::load_example;
use sim::entity::EntityId;
use sim::fixed::{Fx, FxVec2};
use sim::hash::state_hash;
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::save::{SimState, load_state, save_state};
use sim::world::{CombatEvent, Command, Order, World};

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn sandbox() -> World {
    World::sandbox(Ruleset::builtin(), MapGrid::open(80, 40), &[0, 1])
}

fn kind(world: &World, id: &str) -> u16 {
    world
        .rules()
        .type_index(id)
        .unwrap_or_else(|| panic!("type {id}"))
}

fn steps(world: &mut World, count: u32) {
    for _ in 0..count {
        world.step();
    }
}

fn hp(world: &World, id: EntityId) -> u32 {
    world.entity(id).map_or(0, |e| e.hp)
}

fn max_hp(world: &World, id: &str) -> u32 {
    world.rules().ty(kind(world, id)).hp
}

/// Spawns `id` for `owner` at `pos` (centi-tiles).
fn put(world: &mut World, owner: u8, id: &str, x: u32, y: u32) -> EntityId {
    let kind = kind(world, id);
    world.spawn(owner, kind, at(x, y))
}

fn build(world: &mut World, owner: u8, id: &str, x: i32, y: i32) -> EntityId {
    let kind = kind(world, id);
    world.place_building(owner, kind, Cell { x, y }, true)
}

fn order(world: &mut World, player: u8, command: Command) {
    world.enqueue_as(player, command);
}

fn fly_to(world: &mut World, player: u8, unit: EntityId, x: u32, y: u32) {
    order(
        world,
        player,
        Command::Move {
            units: vec![unit],
            target: at(x, y),
        },
    );
}

// ---------------------------------------------------------------------------
// §4.1 anti-air levels, airborne versus parked, low observable
// ---------------------------------------------------------------------------

/// Hit points of `target` (a Russian flyer ordered far away east, so it is
/// airborne) after `ticks` with one Ukrainian `shooter` 3 tiles behind it.
fn flyer_after(shooter: &str, target: &str, ticks: u32) -> u32 {
    let mut world = sandbox();
    // An airfield far away keeps a sortie flyer from starving.
    build(&mut world, 1, "ru-airfield", 70, 30);
    put(&mut world, 0, shooter, 1000, 2000);
    let flyer = put(&mut world, 1, target, 1300, 2000);
    fly_to(&mut world, 1, flyer, 7500, 2000);
    steps(&mut world, ticks);
    hp(&world, flyer)
}

#[test]
fn small_arms_reach_low_flyers_and_not_high_ones() {
    let low = max_hp(&sandbox(), "ru-orlan");
    assert!(flyer_after("ua-rifleman", "ru-orlan", 20) < low, "low: hit");
    let high = max_hp(&sandbox(), "ru-su-34");
    assert_eq!(
        flyer_after("ua-rifleman", "ru-su-34", 20),
        high,
        "high: safe"
    );
}

#[test]
fn autocannons_reach_low_flyers_and_not_high_ones() {
    let low = max_hp(&sandbox(), "ru-orlan");
    assert!(flyer_after("ua-bradley", "ru-orlan", 20) < low);
    let high = max_hp(&sandbox(), "ru-su-34");
    assert_eq!(flyer_after("ua-bradley", "ru-su-34", 20), high);
}

#[test]
fn anti_tank_and_artillery_never_reach_an_airborne_flyer() {
    let high = max_hp(&sandbox(), "ru-su-34");
    assert_eq!(flyer_after("ua-leopard-2a4", "ru-su-34", 20), high);
    let low = max_hp(&sandbox(), "ru-orlan");
    assert_eq!(flyer_after("ua-leopard-2a4", "ru-orlan", 20), low);
    assert_eq!(flyer_after("ua-stugna-team", "ru-orlan", 20), low);
}

#[test]
fn all_level_anti_air_reaches_both_classes() {
    assert!(flyer_after("ua-gepard", "ru-orlan", 12) < max_hp(&sandbox(), "ru-orlan"));
    assert!(flyer_after("ua-gepard", "ru-su-34", 12) < max_hp(&sandbox(), "ru-su-34"));
}

#[test]
fn anti_air_weapons_do_not_shoot_the_ground() {
    let mut world = sandbox();
    put(&mut world, 0, "ua-gepard", 1000, 2000);
    let rifleman = put(&mut world, 1, "ru-rifleman", 1300, 2000);
    let tank = put(&mut world, 1, "ru-t-72b3", 1300, 2400);
    steps(&mut world, 30);
    assert_eq!(hp(&world, tank), max_hp(&world, "ru-t-72b3"));
    // The rifleman fires back, but the Gepard never touched it.
    assert_eq!(hp(&world, rifleman), max_hp(&world, "ru-rifleman"));
}

#[test]
fn a_parked_aircraft_is_an_ordinary_ground_target() {
    let run = |ordered: bool| {
        let mut world = sandbox();
        build(&mut world, 1, "ru-airfield", 40, 20);
        let jet = put(&mut world, 1, "ru-su-34", 4300, 1850);
        put(&mut world, 0, "ua-leopard-2a4", 4300, 1250);
        if ordered {
            fly_to(&mut world, 1, jet, 7500, 1850);
        }
        steps(&mut world, 6);
        (world.is_airborne(jet), hp(&world, jet))
    };
    let (airborne, parked_hp) = run(false);
    assert!(!airborne, "next to its airfield it is parked");
    assert!(parked_hp < 420, "a tank shell hits the parked jet");
    let (airborne, flying_hp) = run(true);
    assert!(airborne, "an order that moves it takes it up");
    assert_eq!(flying_hp, 420, "a tank cannot reach it in the air");
}

#[test]
fn a_missile_on_its_rail_is_not_airborne_until_launched() {
    let mut world = sandbox();
    build(&mut world, 0, "ua-missile-site", 10, 10);
    let missile = put(&mut world, 0, "ua-flamingo", 1150, 1450);
    assert!(!world.is_airborne(missile));
    steps(&mut world, 30);
    assert!(!world.is_airborne(missile), "it waits there until ordered");
    fly_to(&mut world, 0, missile, 5000, 3000);
    world.step();
    assert!(world.is_airborne(missile));
}

#[test]
fn low_observable_missiles_are_engaged_only_inside_a_third_of_the_range() {
    // Gepard range 700: a normal high flyer at 5 tiles is hit, the stealth
    // missile only inside 2.33 tiles. The flyer cannot hover, so it flies away
    // from the Gepard along its line of fire.
    let hit_at = |target: &str, distance: u32| {
        let mut world = sandbox();
        put(&mut world, 0, "ua-gepard", 1000, 1000);
        let flyer = put(&mut world, 1, target, 1000, 1000 + distance);
        fly_to(&mut world, 1, flyer, 1000, 3800);
        steps(&mut world, 15);
        hp(&world, flyer) < max_hp(&world, target)
    };
    assert!(hit_at("ru-geran-3", 500), "a high drone at 5 tiles is hit");
    assert!(!hit_at("ua-storm-shadow", 500), "stealth at 5 tiles is not");
    assert!(hit_at("ua-storm-shadow", 150), "stealth at 1.5 tiles is");
}

#[test]
fn existing_ground_weapons_gain_the_low_anti_air_level() {
    use sim::rules::AntiAir;
    let rules = Ruleset::builtin();
    let level = |id: &str| {
        rules
            .weapons
            .iter()
            .find(|w| w.id == id)
            .unwrap_or_else(|| panic!("weapon {id}"))
            .anti_air
    };
    for small in ["ua-rifle", "ru-ak74", "ru-kpvt", "ua-kozak-hmg"] {
        assert_eq!(level(small), AntiAir::Low, "{small}");
    }
    for cannon in ["ru-2a42", "ua-bushmaster"] {
        assert_eq!(level(cannon), AntiAir::Low, "{cannon}");
    }
    for ground in [
        "ru-rpg7",
        "ru-2a46m",
        "ua-rh120",
        "ua-gmlrs",
        "ru-kab-glide-bomb",
    ] {
        assert_eq!(level(ground), AntiAir::None, "{ground}");
    }
    assert_eq!(level("ru-pantsir-missile"), AntiAir::All);
    assert_eq!(level("ua-sting-launcher"), AntiAir::Low);
    // The old damage modifiers are untouched.
    assert_eq!(rules.damage_modifiers[0][..4], [100, 30, 25, 10]);
}

#[test]
fn the_glide_bomb_outranges_the_ground_anti_air_but_not_the_patriot() {
    let rules = Ruleset::builtin();
    let range = |id: &str| {
        rules
            .weapons
            .iter()
            .find(|w| w.id == id)
            .unwrap()
            .range_centi
    };
    let bomb = range("ru-kab-glide-bomb");
    assert!(bomb > range("ru-pantsir-missile"));
    assert!(bomb > range("ua-gepard-gun"));
    assert!(bomb < range("ua-patriot-missile"));
}

// ---------------------------------------------------------------------------
// §4.2 one-way units
// ---------------------------------------------------------------------------

fn detonations(world: &World) -> Vec<(u32, FxVec2)> {
    world
        .events()
        .iter()
        .filter_map(|event| match event {
            CombatEvent::Detonate {
                projectile, pos, ..
            } if *projectile == u32::MAX => Some((*projectile, *pos)),
            _ => None,
        })
        .collect()
}

#[test]
fn a_one_way_drone_detonates_on_arrival_and_dies_without_a_death_of_its_own() {
    let mut world = sandbox();
    let plant = build(&mut world, 0, "ua-power-plant", 30, 20);
    let geran = put(&mut world, 1, "ru-geran-2", 2000, 2150);
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![geran],
            target: plant,
        },
    );
    let mut blasts = Vec::new();
    let mut death = None;
    for _ in 0..80 {
        world.step();
        blasts.extend(detonations(&world));
        for event in world.events() {
            if let CombatEvent::Death {
                victim,
                killer,
                weapon,
                ..
            } = event
                && *victim == geran
            {
                death = Some((*killer, *weapon));
            }
        }
    }
    assert!(world.entity(geran).is_none(), "the drone is spent");
    assert_eq!(blasts.len(), 1, "exactly one detonation");
    assert_eq!(
        hp(&world, plant),
        1000 - 170,
        "high explosive on a structure"
    );
    let (killer, weapon) = death.expect("the drone's death is reported once");
    assert_eq!(killer, Some(geran), "it killed itself");
    assert!(weapon.is_some());
}

#[test]
fn a_shot_down_one_way_drone_does_not_explode() {
    let mut world = sandbox();
    let plant = build(&mut world, 0, "ua-power-plant", 30, 20);
    let geran = put(&mut world, 1, "ru-geran-2", 2000, 2150);
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![geran],
            target: plant,
        },
    );
    world.step();
    world.set_hp(geran, 0);
    steps(&mut world, 60);
    assert_eq!(hp(&world, plant), 1000, "a dead drone has no warhead");
}

#[test]
fn the_warhead_is_unarmed_until_the_arming_distance_is_flown() {
    let mut world = sandbox();
    let plant = build(&mut world, 0, "ua-power-plant", 20, 20);
    // 1.5 tiles from the plant, armTiles 3 at speed 30: armed after 10 ticks.
    let geran = put(&mut world, 1, "ru-geran-2", 1750, 2150);
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![geran],
            target: plant,
        },
    );
    steps(&mut world, 5);
    assert!(world.entity(geran).is_some(), "too close to be armed");
    assert_eq!(hp(&world, plant), 1000);
    steps(&mut world, 200);
    assert!(
        world.entity(geran).is_none(),
        "armed, it comes back and hits"
    );
    assert!(hp(&world, plant) < 1000);
}

#[test]
fn a_one_way_drone_out_of_fuel_falls_and_detonates_where_it_is() {
    // Molniya: fuelTicks 240 at 0.55 tiles a tick. It is sent to a point
    // farther than its fuel reaches and falls on the way, where it is.
    let mut world = World::sandbox(Ruleset::builtin(), MapGrid::open(256, 40), &[0, 1]);
    let molniya = put(&mut world, 1, "ru-molniya", 500, 2000);
    fly_to(&mut world, 1, molniya, 25000, 2000);
    steps(&mut world, 200);
    assert!(world.entity(molniya).is_some(), "still fuel left");
    let mut blast = None;
    for _ in 0..80 {
        world.step();
        if let Some(&(_, pos)) = detonations(&world).first() {
            blast = Some(pos);
        }
    }
    assert!(world.entity(molniya).is_none(), "out of fuel at 240 ticks");
    let pos = blast.expect("it came down and went off where it was");
    assert!(
        pos.x > fx_centi(10000) && pos.x < fx_centi(16000),
        "on the way, short of its ordered point"
    );
}

#[test]
fn a_one_way_unit_waits_at_its_launcher_and_is_never_auto_launched() {
    let mut world = sandbox();
    let site = build(&mut world, 1, "ru-geran-site", 40, 20);
    world.set_credits(1, 10_000);
    build(&mut world, 0, "ua-power-plant", 20, 20);
    let kind = kind(&world, "ru-geran-2");
    order(
        &mut world,
        1,
        Command::Rally {
            building: site,
            target: at(3000, 2000),
        },
    );
    order(
        &mut world,
        1,
        Command::Produce {
            building: site,
            kind,
        },
    );
    steps(&mut world, 300);
    let geran = world
        .entities()
        .iter()
        .find(|e| e.kind == kind)
        .expect("produced");
    assert!(matches!(geran.order, Order::Idle { .. }), "no rally flight");
    assert!(!world.is_airborne(geran.id));
}

#[test]
fn a_ground_one_way_robot_drives_into_its_target() {
    let mut world = sandbox();
    let tank = put(&mut world, 1, "ru-t-72b3", 3000, 2000);
    let ratel = put(&mut world, 0, "ua-ratel", 2850, 2000);
    order(
        &mut world,
        0,
        Command::Attack {
            units: vec![ratel],
            target: tank,
        },
    );
    steps(&mut world, 60);
    assert!(world.entity(ratel).is_none(), "the robot is spent");
    assert!(
        hp(&world, tank) < max_hp(&world, "ru-t-72b3"),
        "armour takes a heavy blast"
    );
}

#[test]
fn an_attack_order_a_unit_cannot_carry_out_by_height_is_ignored() {
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 70, 30);
    let jet = put(&mut world, 1, "ru-su-34", 3000, 2000);
    fly_to(&mut world, 1, jet, 7500, 2000);
    let rifleman = put(&mut world, 0, "ua-rifleman", 2000, 2000);
    let leopard = put(&mut world, 0, "ua-leopard-2a4", 2000, 2400);
    world.step();
    order(
        &mut world,
        0,
        Command::Attack {
            units: vec![rifleman, leopard],
            target: jet,
        },
    );
    world.step();
    assert!(matches!(
        world.entity(leopard).unwrap().order,
        Order::Idle { .. }
    ));
    assert!(
        matches!(world.entity(rifleman).unwrap().order, Order::Idle { .. }),
        "the jet is class high, small arms only reach low"
    );
}

// ---------------------------------------------------------------------------
// §4.3 sorties
// ---------------------------------------------------------------------------

#[test]
fn a_sortie_flyer_spends_a_round_a_shot_and_flies_home_when_empty() {
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 10, 10);
    let target = build(&mut world, 0, "ua-power-plant", 40, 12);
    let jet = put(&mut world, 1, "ru-su-34", 1250, 900);
    assert_eq!(world.entity(jet).unwrap().ammo, 2);
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![jet],
            target,
        },
    );
    let mut seen_empty = false;
    let mut went_home = false;
    for _ in 0..400 {
        world.step();
        let e = world.entity(jet).unwrap();
        if e.ammo == 0 {
            seen_empty = true;
            assert!(
                matches!(e.order, Order::Attack { .. }),
                "the attack is remembered while empty"
            );
            if !world.is_airborne(jet) {
                went_home = true;
                break;
            }
        }
    }
    assert!(seen_empty, "two bombs spent");
    assert!(went_home, "the empty jet flew back to its airfield");
    assert!(hp(&world, target) < 1000, "the bombs landed");
}

#[test]
fn a_sortie_reloads_over_reload_ticks_repairs_and_resumes_the_remembered_attack() {
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 10, 10);
    let target = build(&mut world, 0, "ua-hq", 40, 12);
    let jet = put(&mut world, 1, "ru-su-34", 1250, 900);
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![jet],
            target,
        },
    );
    let (mut empty_at, mut full_again) = (None, None);
    for tick in 0..1500 {
        world.step();
        let e = world.entity(jet).unwrap();
        if empty_at.is_none() && e.ammo == 0 {
            empty_at = Some(tick);
        }
        if empty_at.is_some() && full_again.is_none() && e.ammo == 2 {
            full_again = Some(tick);
        }
    }
    let (empty_at, full_again) = (empty_at.unwrap(), full_again.expect("it reloaded"));
    assert!(
        full_again - empty_at >= 450,
        "the clip refills over reloadTicks at the base, not before ({} ticks)",
        full_again - empty_at
    );
    // The remembered order sent it out again: the HQ lost more than one salvo.
    assert!(hp(&world, target) < 3000 - 2 * 160, "a second sortie flew");
}

#[test]
fn a_damaged_aircraft_is_repaired_while_it_reloads() {
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 10, 10);
    let jet = put(&mut world, 1, "ru-su-34", 1250, 900);
    world.set_hp(jet, 100);
    steps(&mut world, 50);
    let part = hp(&world, jet);
    assert!(part > 100 && part < 420, "being repaired: {part}");
    steps(&mut world, 402);
    assert_eq!(hp(&world, jet), 420, "whole after reloadTicks");
    assert_eq!(world.entity(jet).unwrap().ammo, 2);
}

#[test]
fn an_idle_sortie_flyer_away_from_base_returns_to_the_nearest_own_base() {
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 10, 10);
    let far = build(&mut world, 1, "ru-airfield", 60, 30);
    let jet = put(&mut world, 1, "ru-su-34", 5000, 3300);
    world.step();
    assert!(matches!(
        world.entity(jet).unwrap().order,
        Order::ReturnToBase { .. }
    ));
    steps(&mut world, 40);
    assert!(matches!(
        world.entity(jet).unwrap().order,
        Order::Idle { .. }
    ));
    let landed = world.entity(far).unwrap();
    assert!((landed.pos - world.entity(jet).unwrap().pos).length() < fx_centi(500));
    assert!(!world.is_airborne(jet), "landed, it is parked");
}

#[test]
fn with_no_base_a_sortie_flyer_loses_five_percent_a_second() {
    let mut world = sandbox();
    let jet = put(&mut world, 1, "ru-su-34", 3000, 2000);
    // 420 hp: 5 % is 21 per second, every 15 ticks.
    steps(&mut world, 1);
    let start = hp(&world, jet);
    steps(&mut world, 15);
    assert_eq!(start - hp(&world, jet), 21);
    steps(&mut world, 15 * 19);
    assert_eq!(hp(&world, jet), 0, "twenty seconds burn it down");
    world.step();
    assert!(world.entity(jet).is_none());
}

#[test]
fn a_parked_clip_is_full_and_fires_at_nothing_it_cannot_see() {
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 10, 10);
    let jet = put(&mut world, 1, "ru-su-34", 1250, 900);
    steps(&mut world, 100);
    let e = world.entity(jet).unwrap();
    assert_eq!(e.ammo, 2);
    assert_eq!(e.reload, 0);
}

// ---------------------------------------------------------------------------
// §4.4 launched drones
// ---------------------------------------------------------------------------

fn launched(world: &World, master: EntityId) -> Option<EntityId> {
    world
        .entities()
        .iter()
        .find(|e| e.master == Some(master))
        .map(|e| e.id)
}

#[test]
fn a_launcher_weapon_spawns_a_drone_with_its_master_and_an_attack_order() {
    let mut world = sandbox();
    let crew = put(&mut world, 1, "ru-molniya-crew", 2000, 2000);
    let target = put(&mut world, 0, "ua-bradley", 2500, 2000);
    steps(&mut world, 3);
    let drone = launched(&world, crew).expect("the crew launched a Molniya");
    let drone = world.entity(drone).unwrap();
    assert_eq!(drone.owner, 1);
    assert_eq!(drone.kind, kind(&world, "ru-molniya"));
    assert!(matches!(
        drone.order,
        Order::Attack { target: t, .. } if t == target
    ));
    assert!(world.is_airborne(drone.id));
}

#[test]
fn a_fibre_drone_falls_harmless_when_its_crew_dies() {
    let mut world = sandbox();
    let crew = put(&mut world, 1, "ru-molniya-crew", 2000, 2000);
    let target = put(&mut world, 0, "ua-bradley", 2500, 2000);
    steps(&mut world, 3);
    let drone = launched(&world, crew).unwrap();
    world.set_hp(crew, 0);
    steps(&mut world, 120);
    assert!(world.entity(drone).is_none(), "the drone is gone");
    assert_eq!(hp(&world, target), max_hp(&world, "ua-bradley"), "no blast");
}

#[test]
fn a_radio_drone_falls_harmless_when_its_crew_dies() {
    let mut world = sandbox();
    let crew = put(&mut world, 0, "ua-fpv-team", 2000, 2000);
    let target = put(&mut world, 1, "ru-t-72b3", 2800, 2000);
    steps(&mut world, 3);
    let drone = launched(&world, crew).unwrap();
    world.set_hp(crew, 0);
    steps(&mut world, 120);
    assert!(world.entity(drone).is_none());
    assert_eq!(hp(&world, target), max_hp(&world, "ru-t-72b3"));
}

#[test]
fn an_autonomous_drone_finishes_the_attack_without_its_master() {
    let mut world = sandbox();
    build(&mut world, 0, "ua-power-plant", 5, 5);
    let nest = build(&mut world, 0, "ua-sting-nest", 20, 20);
    let geran = put(&mut world, 1, "ru-geran-2", 2900, 2100);
    fly_to(&mut world, 1, geran, 2900, 2200);
    world.step();
    world.step();
    let sting = launched(&world, nest).expect("the nest launched a Sting");
    world.set_hp(nest, 0);
    steps(&mut world, 120);
    assert!(
        world.entity(sting).is_none(),
        "the Sting rammed and is spent"
    );
    assert!(world.entity(geran).is_none(), "the Geran is down");
}

#[test]
fn a_sting_cannot_reach_a_high_flyer() {
    let mut world = sandbox();
    build(&mut world, 0, "ua-power-plant", 5, 5);
    let nest = build(&mut world, 0, "ua-sting-nest", 20, 20);
    let jet = put(&mut world, 1, "ru-geran-3", 2900, 2100);
    fly_to(&mut world, 1, jet, 7900, 2100);
    steps(&mut world, 60);
    assert!(
        launched(&world, nest).is_none(),
        "the nest never fires at it"
    );
    assert_eq!(hp(&world, jet), max_hp(&world, "ru-geran-3"));
}

// ---------------------------------------------------------------------------
// §4.5 links and jamming
// ---------------------------------------------------------------------------

#[test]
fn a_hostile_jammer_stops_a_radio_ground_robot() {
    let mut world = sandbox();
    let tank = put(&mut world, 1, "ru-t-72b3", 4000, 2000);
    let robot = put(&mut world, 0, "ua-tw-12-7", 2000, 2000);
    let jammer = put(&mut world, 1, "ru-pole-21", 2400, 2400);
    order(
        &mut world,
        0,
        Command::Attack {
            units: vec![robot],
            target: tank,
        },
    );
    let start = world.entity(robot).unwrap().pos;
    steps(&mut world, 30);
    assert_eq!(world.entity(robot).unwrap().pos, start, "it cannot move");
    assert_eq!(hp(&world, tank), max_hp(&world, "ru-t-72b3"), "or fire");
    assert!(world.is_jammed(robot));
    world.set_hp(jammer, 0);
    steps(&mut world, 60);
    assert_ne!(world.entity(robot).unwrap().pos, start, "free again");
}

#[test]
fn a_jammer_never_affects_its_own_side_or_the_unjammable() {
    let mut world = sandbox();
    put(&mut world, 1, "ru-pole-21", 2400, 2400);
    let own = put(&mut world, 1, "ru-geran-2", 2300, 2400);
    let fibre = put(&mut world, 1, "ru-molniya", 2300, 2300);
    let nest = build(&mut world, 0, "ua-sting-nest", 60, 30);
    let sting = put(&mut world, 0, "ua-sting", 2350, 2350);
    fly_to(&mut world, 1, own, 3000, 2400);
    fly_to(&mut world, 1, fibre, 3000, 2300);
    fly_to(&mut world, 0, sting, 3000, 2350);
    steps(&mut world, 5);
    for id in [own, fibre, sting] {
        assert!(world.entity(id).is_some(), "{id} is not jammed");
        assert!(!world.is_jammed(id));
    }
    assert!(world.entity(nest).is_some());
}

#[test]
fn a_hostile_jammer_drops_radio_flyers_harmless() {
    let mut world = sandbox();
    let victim = put(&mut world, 0, "ua-bradley", 2400, 2000);
    put(&mut world, 1, "ru-pole-21", 2200, 2400);
    let fpv = put(&mut world, 0, "ua-fpv", 2400, 2100);
    fly_to(&mut world, 0, fpv, 2400, 2000);
    world.step();
    world.step();
    assert!(world.entity(fpv).is_none(), "the FPV fell");
    assert_eq!(hp(&world, victim), max_hp(&world, "ua-bradley"));
}

#[test]
fn a_jammed_gnss_warhead_lands_off_target() {
    let strike = |jammer: bool| {
        let mut world = sandbox();
        let plant = build(&mut world, 0, "ua-power-plant", 30, 20);
        if jammer {
            put(&mut world, 0, "ru-pole-21", 3300, 2900);
        }
        let geran = put(&mut world, 1, "ru-geran-2", 2400, 2150);
        order(
            &mut world,
            1,
            Command::Attack {
                units: vec![geran],
                target: plant,
            },
        );
        for _ in 0..120 {
            world.step();
            if let Some((_, pos)) = detonations(&world).first() {
                return *pos;
            }
        }
        panic!("no detonation");
    };
    let straight = strike(false);
    let jammed = strike(true);
    let off = (jammed - straight).length();
    assert!(off > fx_centi(10), "it lands elsewhere");
    assert!(off <= fx_centi(250 + 60), "but within gnssScatterCenti");
}

// ---------------------------------------------------------------------------
// determinism, hashing, saves
// ---------------------------------------------------------------------------

/// A busy sandbox: every mechanic of the spec in play at once.
fn air_war() -> World {
    let mut world = sandbox();
    world.set_credits(0, 20_000);
    world.set_credits(1, 20_000);
    build(&mut world, 0, "ua-power-plant", 3, 3);
    build(&mut world, 0, "ua-power-plant", 3, 7);
    build(&mut world, 1, "ru-power-plant", 70, 3);
    build(&mut world, 1, "ru-airfield", 55, 25);
    let site = build(&mut world, 1, "ru-geran-site", 66, 12);
    build(&mut world, 0, "ua-sting-nest", 14, 10);
    build(&mut world, 0, "ua-patriot", 14, 15);
    let hq = build(&mut world, 0, "ua-hq", 8, 20);
    build(&mut world, 0, "ua-drone-workshop", 4, 26);
    let target = hq;
    let jets: Vec<EntityId> = (0..2)
        .map(|i| put(&mut world, 1, "ru-su-34", 5600 + 80 * i, 2400))
        .collect();
    let gerans: Vec<EntityId> = (0..6)
        .map(|i| put(&mut world, 1, "ru-geran-2", 6700, 1300 + 40 * i))
        .collect();
    let storm = put(&mut world, 0, "ua-storm-shadow", 1000, 3500);
    put(&mut world, 1, "ru-pole-21", 3000, 2000);
    let robot = put(&mut world, 0, "ua-ratel", 2500, 2000);
    let crew = put(&mut world, 1, "ru-molniya-crew", 2800, 2200);
    put(&mut world, 0, "ua-gepard", 2000, 1000);
    put(&mut world, 1, "ru-pantsir", 6000, 1500);
    let ru_hq = put(&mut world, 1, "ru-t-72b3", 3300, 2300);
    order(
        &mut world,
        1,
        Command::Attack {
            units: jets.clone(),
            target,
        },
    );
    order(
        &mut world,
        1,
        Command::Attack {
            units: gerans,
            target,
        },
    );
    order(
        &mut world,
        0,
        Command::Attack {
            units: vec![storm],
            target: site,
        },
    );
    order(
        &mut world,
        0,
        Command::Attack {
            units: vec![robot],
            target: ru_hq,
        },
    );
    let _ = crew;
    world
}

#[test]
fn a_match_with_air_units_is_deterministic() {
    let run = |ticks: u32| {
        let mut world = air_war();
        steps(&mut world, ticks);
        state_hash(&world)
    };
    assert_eq!(run(600), run(600), "same inputs, same hash");
    assert_ne!(run(600), run(601), "time moves the hash");
    // The units actually did something.
    let mut world = air_war();
    steps(&mut world, 600);
    assert!(world.entities().len() != air_war().entities().len());
}

#[test]
fn the_air_state_is_part_of_the_hash() {
    let hash_after = |tweak: &dyn Fn(&mut World, EntityId)| {
        let mut world = sandbox();
        build(&mut world, 1, "ru-airfield", 10, 10);
        let jet = put(&mut world, 1, "ru-su-34", 1250, 900);
        tweak(&mut world, jet);
        state_hash(&world)
    };
    let base = hash_after(&|_, _| {});
    // Ammo and reload move through a sortie; a missing round changes the hash.
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 10, 10);
    let jet = put(&mut world, 1, "ru-su-34", 1250, 900);
    world.set_hp(jet, 100);
    steps(&mut world, 10);
    let reloading = state_hash(&world);
    assert_ne!(base, reloading);
    assert!(world.entity(jet).unwrap().reload > 0);
}

#[test]
fn a_world_without_flyers_keeps_its_old_hash_layout() {
    // A plain world writes none of the air fields into the hash.
    let mut a = sandbox();
    put(&mut a, 0, "ua-rifleman", 1000, 1000);
    let mut b = sandbox();
    put(&mut b, 0, "ua-rifleman", 1000, 1000);
    assert_eq!(state_hash(&a), state_hash(&b));
    let rifleman = a.entities()[0].clone();
    assert_eq!((rifleman.ammo, rifleman.reload, rifleman.fuel), (0, 0, 0));
    assert!(rifleman.master.is_none());
}

#[test]
fn a_save_round_trips_mid_flight_and_continues_identically() {
    let mut world = World::skirmish(Ruleset::builtin(), "showcase", 0).unwrap();
    let hq = world
        .entities()
        .iter()
        .find(|e| {
            e.owner == 0 && world.rules().ty(e.kind).category == sim::rules::Category::Building
        })
        .unwrap()
        .id;
    let field = {
        let kind = kind(&world, "ru-airfield");
        world.place_building(1, kind, Cell { x: 54, y: 14 }, true)
    };
    let _ = field;
    let jets: Vec<EntityId> = (0..2)
        .map(|i| put(&mut world, 1, "ru-su-34", 5700 + 60 * i, 1700))
        .collect();
    let gerans: Vec<EntityId> = (0..3)
        .map(|i| put(&mut world, 1, "ru-geran-2", 5800, 2000 + 50 * i))
        .collect();
    let crew = put(&mut world, 1, "ru-molniya-crew", 1000, 2000);
    put(&mut world, 0, "ua-leopard-2a4", 1300, 2000);
    order(
        &mut world,
        1,
        Command::Attack {
            units: jets.clone(),
            target: hq,
        },
    );
    order(
        &mut world,
        1,
        Command::Attack {
            units: gerans.clone(),
            target: hq,
        },
    );
    steps(&mut world, 5);
    // Mid-flight: fuel burnt, a clip partly spent, a drone with a master.
    assert!(world.entity(gerans[0]).is_some_and(|e| e.fuel > 0));
    assert!(world.entities().iter().any(|e| e.master == Some(crew)));
    let state = save_state(&world, 9, &[]).unwrap();
    let text = serde_json::to_string(&state).unwrap();
    let parsed: SimState = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed, state);
    let (mut loaded, seed, _) = load_state(&parsed).unwrap();
    assert_eq!(seed, 9);
    assert_eq!(state_hash(&loaded), state_hash(&world));
    steps(&mut world, 200);
    steps(&mut loaded, 200);
    assert_eq!(state_hash(&loaded), state_hash(&world), "same future");
    assert!(
        world
            .entities()
            .iter()
            .any(|e| e.kind == kind(&world, "ru-su-34")),
        "the jets are still around"
    );
}

#[test]
fn old_saves_without_air_fields_still_load() {
    let world = World::skirmish(Ruleset::builtin(), "showcase", 0).unwrap();
    let state = save_state(&world, 1, &[]).unwrap();
    let text = serde_json::to_string(&state).unwrap();
    for key in ["\"ammo\"", "\"reload\"", "\"master\"", "\"fuel\""] {
        assert!(!text.contains(key), "{key} is left out while zero");
    }
    let (loaded, _, _) = load_state(&serde_json::from_str(&text).unwrap()).unwrap();
    assert_eq!(state_hash(&loaded), state_hash(&world));
}

#[test]
fn every_new_type_is_defined_and_the_old_indices_hold() {
    let rules = Ruleset::builtin();
    for id in [
        "ru-airfield",
        "ru-su-34",
        "ru-orlan",
        "ru-geran-site",
        "ru-geran-2",
        "ru-geran-3",
        "ru-molniya-crew",
        "ru-molniya",
        "ru-pantsir",
        "ru-pole-21",
        "ua-drone-workshop",
        "ua-ratel",
        "ua-tw-12-7",
        "ua-baba-yaga",
        "ua-fpv-team",
        "ua-fpv",
        "ua-sting-nest",
        "ua-sting",
        "ua-gepard",
        "ua-patriot",
        "ua-missile-site",
        "ua-flamingo",
        "ua-storm-shadow",
    ] {
        let kind = rules.type_index(id).unwrap_or_else(|| panic!("{id}"));
        // They all come after the 31 types of the previous ruleset.
        assert!(kind >= 31, "{id} is a late type");
    }
    assert_eq!(rules.type_index("ua-rifleman"), Some(2));
    assert_eq!(rules.type_index("ru-defense"), Some(29));
    assert_eq!(rules.type_index("port-depot"), Some(30));
    assert_eq!(rules.weapons[0].id, "ua-rifle");
    assert!(
        rules
            .ty(rules.type_index("ua-storm-shadow").unwrap())
            .low_observable
    );
    assert!(
        rules
            .ty(rules.type_index("ru-pole-21").unwrap())
            .jammer
            .is_some()
    );
}

// ---------------------------------------------------------------------------
// the example saves of spec 43 §7
// ---------------------------------------------------------------------------

fn find(world: &World, id: &str) -> Vec<EntityId> {
    let kind = kind(world, id);
    world
        .entities()
        .iter()
        .filter(|e| e.kind == kind)
        .map(|e| e.id)
        .collect()
}

#[test]
fn deep_strike_pantsir_kills_the_flamingo_and_the_storm_shadow_slips_past() {
    let (mut world, _, _) = load_example("deep-strike");
    let flamingo = find(&world, "ua-flamingo")[0];
    let plant = find(&world, "ru-power-plant")[0];
    let field = find(&world, "ru-airfield")[0];
    steps(&mut world, 200);
    assert!(world.entity(flamingo).is_none());
    assert_eq!(hp(&world, field), 2200, "the Flamingo never arrived");
    assert!(hp(&world, plant) <= 100, "the Storm Shadow hit the plant");
}

#[test]
fn robots_vs_jammer_stops_the_robots_and_not_the_fibre_drones() {
    let (mut world, _, _) = load_example("robots-vs-jammer");
    let ratels = find(&world, "ua-ratel");
    let tanks = find(&world, "ru-t-72b3");
    let leopard = find(&world, "ua-leopard-2a4")[0];
    steps(&mut world, 400);
    for ratel in ratels {
        assert!(
            world.entity(ratel).is_some_and(|e| e.hp == 140),
            "stopped, unhurt"
        );
        assert!(world.is_jammed(ratel));
    }
    for tank in tanks {
        assert_eq!(hp(&world, tank), 850, "no robot or FPV got through");
    }
    assert!(
        hp(&world, leopard) < max_hp(&world, "ua-leopard-2a4"),
        "the Molniya drones ignore the jammer"
    );
}

#[test]
fn air_war_has_sortie_waves_and_interceptors() {
    let (mut world, _, _) = load_example("air-war");
    let gerans = find(&world, "ru-geran-2").len();
    let mut stings = false;
    let mut bombs = false;
    for _ in 0..400 {
        world.step();
        stings |= !find(&world, "ua-sting").is_empty();
        bombs |= find(&world, "ru-su-34")
            .iter()
            .any(|&jet| world.entity(jet).is_some_and(|e| e.ammo < 2));
    }
    assert_eq!(gerans, 4);
    assert!(stings, "the nest launched Stings");
    assert!(bombs, "the jets dropped bombs");
    assert!(find(&world, "ru-geran-2").is_empty(), "the wave is spent");
}

// ---------------------------------------------------------------------------
// §4.1 flight model: fixed-wing flyers never stop, rotorcraft may hover
// ---------------------------------------------------------------------------

fn motion(world: &World, id: &str) -> sim::rules::Motion {
    world.rules().ty(kind(world, id)).motion
}

fn speed_of(world: &World, id: EntityId) -> Fx {
    world.entity(id).unwrap().speed
}

#[test]
fn only_the_rotorcraft_may_hover() {
    let world = sandbox();
    for id in ["ua-baba-yaga", "ua-fpv", "ua-sting"] {
        assert!(world.rules().ty(kind(&world, id)).hover, "{id} hovers");
    }
    let rules = world.rules();
    for ty in rules.types.iter().filter(|ty| ty.is_air()) {
        let rotor = matches!(ty.id.as_str(), "ua-baba-yaga" | "ua-fpv" | "ua-sting");
        assert_eq!(ty.is_fixed_wing(), !rotor, "{}", ty.id);
        if ty.is_fixed_wing() {
            assert!(ty.motion.min_speed > Fx::ZERO, "{}", ty.id);
            assert!(ty.motion.turn_step > 0, "{}", ty.id);
        }
    }
}

#[test]
fn a_fixed_wing_flyer_never_drops_below_its_minimum_speed_while_airborne() {
    let mut world = sandbox();
    // No base: an idle flyer stays up. An Orlan, a Su-34, a Geran and a
    // Storm Shadow, each with a different job.
    let orlan = put(&mut world, 1, "ru-orlan", 3000, 2000);
    let jet = put(&mut world, 1, "ru-su-34", 5000, 1000);
    let geran = put(&mut world, 1, "ru-geran-2", 6000, 3000);
    let target = put(&mut world, 0, "ua-leopard-2a4", 1000, 3000);
    fly_to(&mut world, 1, orlan, 3500, 2500);
    fly_to(&mut world, 1, jet, 1000, 1000);
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![geran],
            target,
        },
    );
    let ids = [orlan, jet, geran];
    for tick in 0..400 {
        world.step();
        for &id in &ids {
            let Some(entity) = world.entity(id) else {
                continue;
            };
            let floor = world.rules().ty(entity.kind).motion.min_speed;
            assert!(world.is_airborne(id));
            assert!(
                entity.speed >= floor,
                "tick {tick}: {} stopped",
                entity.kind
            );
        }
    }
    assert!(world.entity(orlan).is_some(), "the spotter still circles");
}

#[test]
fn a_fixed_wing_flyer_turns_at_its_rate_and_never_in_place() {
    let mut world = sandbox();
    let jet = put(&mut world, 1, "ru-su-34", 4000, 2000);
    fly_to(&mut world, 1, jet, 4000, 600);
    steps(&mut world, 3);
    let step = motion(&world, "ru-su-34").turn_step;
    // Order it back the way it came: a U-turn, not a spin.
    fly_to(&mut world, 1, jet, 4000, 3500);
    let mut last = world.entity(jet).unwrap().clone();
    let mut travelled = Fx::ZERO;
    for _ in 0..60 {
        world.step();
        let now = world.entity(jet).unwrap().clone();
        assert!(last.heading.delta(now.heading).abs() <= step, "turn rate");
        assert!(now.speed >= motion(&world, "ru-su-34").min_speed);
        travelled = travelled + (now.pos - last.pos).length();
        last = now;
    }
    assert!(
        travelled > fx_centi(2000),
        "it kept flying through the turn"
    );
}

#[test]
fn an_idle_flyer_with_no_base_circles_inside_a_circle_of_its_speed_and_turn_rate() {
    let mut world = sandbox();
    let jet = put(&mut world, 1, "ru-su-34", 4000, 2000);
    let m = motion(&world, "ru-su-34");
    let radius = sim::air::turn_radius(m.min_speed, m.turn_step);
    let start = world.entity(jet).unwrap().pos;
    let mut farthest = Fx::ZERO;
    for _ in 0..200 {
        world.step();
        let e = world.entity(jet).unwrap();
        assert!(e.speed >= m.min_speed);
        farthest = farthest.max((e.pos - start).length());
    }
    // A full circle of radius r is at most 2 r across.
    assert!(farthest <= radius + radius + fx_centi(20), "{farthest:?}");
    assert!(farthest > radius, "it really circles");
}

#[test]
fn a_spotter_circles_over_its_ordered_point() {
    let mut world = sandbox();
    let orlan = put(&mut world, 1, "ru-orlan", 1000, 1000);
    fly_to(&mut world, 1, orlan, 4000, 2500);
    let m = motion(&world, "ru-orlan");
    let ring = sim::air::loiter_radius(&m);
    steps(&mut world, 300);
    let centre = at(4000, 2500);
    let (mut nearest, mut farthest) = (fx_centi(10_000), Fx::ZERO);
    for _ in 0..300 {
        world.step();
        let e = world.entity(orlan).unwrap();
        assert!(e.speed >= m.min_speed);
        assert!(
            matches!(e.order, Order::Move { .. }),
            "the circle is its order"
        );
        let d = (e.pos - centre).length();
        nearest = nearest.min(d);
        farthest = farthest.max(d);
    }
    assert!(
        farthest <= ring + Fx::from_raw(ring.raw() / 2),
        "inside its circle: {farthest:?}"
    );
    assert!(
        nearest >= Fx::from_raw(ring.raw() / 2),
        "and not parked on the point: {nearest:?}"
    );
}

#[test]
fn a_one_way_flyer_reaches_a_target_inside_its_turning_circle() {
    // Offsets all around a target well inside every flyer's turning circle.
    for id in ["ru-geran-2", "ru-geran-3", "ru-molniya", "ua-flamingo"] {
        for (dx, dy) in [
            (0, 80),
            (0, -80),
            (80, 0),
            (-80, 0),
            (120, 120),
            (-100, -60),
            (30, -30),
        ] {
            let mut world = sandbox();
            let (side, other) = if id.starts_with("ua-") {
                (0, 1)
            } else {
                (1, 0)
            };
            let victim = put(&mut world, other, "ua-leopard-2a4", 4000, 2000);
            let flyer = put(&mut world, side, id, (4000 + dx) as u32, (2000 + dy) as u32);
            order(
                &mut world,
                side,
                Command::Attack {
                    units: vec![flyer],
                    target: victim,
                },
            );
            let mut done = false;
            for _ in 0..300 {
                world.step();
                if !detonations(&world).is_empty() {
                    done = true;
                    break;
                }
            }
            assert!(done, "{id} from ({dx}, {dy}) never arrived");
            assert!(world.entity(flyer).is_none());
        }
    }
}

#[test]
fn a_one_way_flyer_whose_target_is_behind_it_turns_round_and_gets_there() {
    let mut world = sandbox();
    let victim = put(&mut world, 0, "ua-leopard-2a4", 4000, 2000);
    let geran = put(&mut world, 1, "ru-geran-3", 4000, 2150);
    // Heading 0 is +y, away from the target.
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![geran],
            target: victim,
        },
    );
    steps(&mut world, 200);
    assert!(world.entity(geran).is_none());
    assert!(hp(&world, victim) < max_hp(&world, "ua-leopard-2a4"));
}

/// An airfield, a bomber and a target, with the pass recorded tick by tick:
/// `(airborne, speed ok, released this tick)`.
fn bombing_pass() -> (World, Vec<(bool, bool, bool)>) {
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 10, 10);
    let target = build(&mut world, 0, "ua-power-plant", 40, 12);
    let jet = put(&mut world, 1, "ru-su-34", 1250, 900);
    let floor = motion(&world, "ru-su-34").min_speed;
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![jet],
            target,
        },
    );
    let mut log = Vec::new();
    let mut ammo = world.entity(jet).unwrap().ammo;
    for _ in 0..300 {
        world.step();
        let e = world.entity(jet).unwrap();
        log.push((
            world.is_airborne(jet),
            !world.is_airborne(jet) || e.speed >= floor,
            e.ammo < ammo,
        ));
        ammo = e.ammo;
    }
    (world, log)
}

#[test]
fn a_bomber_releases_during_a_pass_without_ever_slowing_below_minimum_speed() {
    let (_, log) = bombing_pass();
    assert!(log.iter().all(|&(_, speed_ok, _)| speed_ok), "never slower");
    let releases: Vec<usize> = (0..log.len()).filter(|&i| log[i].2).collect();
    assert_eq!(releases.len(), 2, "both bombs of the clip dropped");
    for &i in &releases {
        assert!(log[i].0 && log[i].1, "released in flight at speed");
    }
    assert!(
        releases[1] - releases[0] < 30,
        "one pass: {releases:?}, not a second approach"
    );
}

#[test]
fn a_bomber_breaks_away_and_lands_after_its_pass() {
    let (world, log) = bombing_pass();
    // After the last release it is airborne for a while, then parked again.
    let last = (0..log.len()).rev().find(|&i| log[i].2).unwrap();
    assert!(log[last + 1].0, "it flew on after releasing");
    assert!(!log[log.len() - 1].0, "and landed at its airfield");
    let _ = world;
}

#[test]
fn a_bomber_comes_round_when_it_misses_the_window() {
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 10, 10);
    let target = build(&mut world, 0, "ua-power-plant", 40, 12);
    // Level with the target and beside it: the target is far outside the
    // nose cone for the first moments.
    let jet = put(&mut world, 1, "ru-su-34", 4000, 600);
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![jet],
            target,
        },
    );
    let floor = motion(&world, "ru-su-34").min_speed;
    let mut released = false;
    for _ in 0..300 {
        world.step();
        let e = world.entity(jet).unwrap();
        if e.ammo > 0 {
            assert!(e.speed >= floor);
        }
        released |= e.ammo < 2;
    }
    assert!(released, "it came round into the window and dropped");
}

#[test]
fn rotorcraft_may_hover_and_fixed_wing_flyers_may_not() {
    let mut world = sandbox();
    let target = put(&mut world, 0, "ua-leopard-2a4", 3000, 2000);
    let hexa = put(&mut world, 0, "ua-baba-yaga", 2000, 2000);
    world.set_hp(target, 10_000);
    fly_to(&mut world, 0, hexa, 2200, 2000);
    steps(&mut world, 60);
    assert_eq!(speed_of(&world, hexa), Fx::ZERO, "hangs there");
    assert!(world.is_airborne(hexa));
    // The Baba Yaga drops on what it hangs over, holding in range.
    let foe = put(&mut world, 1, "ru-t-72b3", 2600, 2000);
    order(
        &mut world,
        0,
        Command::Attack {
            units: vec![hexa],
            target: foe,
        },
    );
    steps(&mut world, 120);
    assert_eq!(speed_of(&world, hexa), Fx::ZERO, "holds to bomb");
    assert!(world.entity(hexa).unwrap().ammo < 4, "and bombed");
}

#[test]
fn parked_aircraft_and_missiles_on_a_rail_stay_still() {
    let mut world = sandbox();
    build(&mut world, 1, "ru-airfield", 10, 10);
    build(&mut world, 0, "ua-missile-site", 50, 10);
    let jet = put(&mut world, 1, "ru-su-34", 1250, 900);
    let missile = put(&mut world, 0, "ua-flamingo", 5150, 1450);
    let before = (
        world.entity(jet).unwrap().pos,
        world.entity(missile).unwrap().pos,
    );
    steps(&mut world, 100);
    assert!(!world.is_airborne(jet) && !world.is_airborne(missile));
    assert_eq!(speed_of(&world, jet), Fx::ZERO);
    assert_eq!(speed_of(&world, missile), Fx::ZERO);
    assert_eq!(
        (
            world.entity(jet).unwrap().pos,
            world.entity(missile).unwrap().pos
        ),
        before
    );
}

#[test]
fn flight_is_deterministic_and_the_heading_is_part_of_the_hash() {
    let run = || {
        let (world, _) = bombing_pass();
        state_hash(&world)
    };
    assert_eq!(run(), run());
    let mut a = sandbox();
    let mut b = sandbox();
    put(&mut a, 1, "ru-orlan", 2000, 2000);
    put(&mut b, 1, "ru-orlan", 2000, 2000);
    steps(&mut a, 40);
    steps(&mut b, 41);
    assert_ne!(state_hash(&a), state_hash(&b));
}

// ---------------------------------------------------------------------------
// §4.4 charges: a launcher's drones are its ammunition
// ---------------------------------------------------------------------------

fn charges(world: &World, id: EntityId) -> u32 {
    world.entity(id).unwrap().charges
}

/// Every unit that was ever launched by `master`, over `ticks` of play.
fn launches_over(world: &mut World, master: EntityId, ticks: u32) -> usize {
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..ticks {
        world.step();
        seen.extend(
            world
                .entities()
                .iter()
                .filter(|e| e.master == Some(master))
                .map(|e| e.id),
        );
    }
    seen.len()
}

#[test]
fn launchers_start_full_and_every_launch_spends_a_charge() {
    let mut world = sandbox();
    let team = put(&mut world, 0, "ua-fpv-team", 1000, 2000);
    let crew = put(&mut world, 1, "ru-molniya-crew", 3000, 2000);
    assert_eq!(charges(&world, team), 4);
    assert_eq!(charges(&world, crew), 3);
    // A target that cannot shoot back and does not die.
    let plant = build(&mut world, 1, "ru-power-plant", 15, 20);
    world.set_hp(plant, 1_000_000);
    order(
        &mut world,
        0,
        Command::Attack {
            units: vec![team],
            target: plant,
        },
    );
    let launched = launches_over(&mut world, team, 200);
    assert!(launched >= 1, "it launched");
    assert_eq!(charges(&world, team) as usize, 4 - launched);
}

#[test]
fn a_launcher_with_no_charge_launches_nothing_and_idles() {
    let mut world = sandbox();
    let team = put(&mut world, 0, "ua-fpv-team", 1000, 2000);
    let plant = build(&mut world, 1, "ru-power-plant", 15, 20);
    world.set_hp(plant, 1_000_000);
    order(
        &mut world,
        0,
        Command::Attack {
            units: vec![team],
            target: plant,
        },
    );
    // Four charges at one launch per 150 ticks: all spent in 600 ticks.
    let launched = launches_over(&mut world, team, 620);
    assert_eq!(launched, 4, "exactly the four charges");
    assert_eq!(charges(&world, team), 0);
    assert!(
        matches!(world.entity(team).unwrap().order, Order::Idle { .. }),
        "an empty team gives up the attack"
    );
    assert_eq!(launches_over(&mut world, team, 600), 0, "and stays empty");
    // It can still be ordered about.
    fly_to(&mut world, 0, team, 800, 2000);
    steps(&mut world, 60);
    assert!(
        world.entity(team).unwrap().pos.x < fx_centi(950),
        "it walked"
    );
}

/// A spent crew `id` at (1000, 2000) and `source` at `dx` centi-tiles from it:
/// charges after `ticks`.
fn refilled(crew: &str, owner: u8, source: &str, building: bool, dx: u32, ticks: u32) -> u32 {
    let mut world = sandbox();
    let unit = put(&mut world, owner, crew, 1000, 2000);
    world.set_charges(unit, 0);
    if building {
        // A building footprint starts at its cell; put its edge `dx` away.
        build(&mut world, owner, source, ((1000 + dx) / 100) as i32, 20);
    } else {
        put(&mut world, owner, source, 1000 + dx, 2000);
    }
    steps(&mut world, ticks);
    charges(&world, unit)
}

#[test]
fn a_launcher_refills_one_charge_per_refill_time_next_to_each_source() {
    // Refill: 300 ticks per charge for the FPV team, 360 for the Molniya crew.
    assert_eq!(
        refilled("ua-fpv-team", 0, "ua-supply-truck", false, 300, 290),
        0
    );
    assert_eq!(
        refilled("ua-fpv-team", 0, "ua-supply-truck", false, 300, 310),
        1
    );
    assert_eq!(
        refilled("ua-fpv-team", 0, "ua-supply-truck", false, 300, 610),
        2
    );
    assert_eq!(
        refilled("ua-fpv-team", 0, "ua-supply-center", true, 300, 310),
        1
    );
    assert_eq!(refilled("ua-fpv-team", 0, "ua-barracks", true, 300, 310), 1);
    assert_eq!(
        refilled("ru-molniya-crew", 1, "ru-supply-truck", false, 300, 370),
        1
    );
    assert_eq!(
        refilled("ru-molniya-crew", 1, "ru-supply-center", true, 300, 370),
        1
    );
    assert_eq!(
        refilled("ru-molniya-crew", 1, "ru-barracks", true, 300, 370),
        1
    );
    assert_eq!(
        refilled("ru-molniya-crew", 1, "ru-barracks", true, 300, 360),
        1
    );
}

#[test]
fn a_launcher_never_refills_far_from_a_source_or_next_to_an_enemy_one() {
    // Out of the 5 tile radius, however long it waits.
    assert_eq!(
        refilled("ua-fpv-team", 0, "ua-supply-truck", false, 900, 1500),
        0
    );
    assert_eq!(
        refilled("ua-fpv-team", 0, "ua-barracks", true, 1200, 1500),
        0
    );
    // Something else that is close does not count.
    assert_eq!(
        refilled("ua-fpv-team", 0, "ua-rifleman", false, 100, 1500),
        0
    );
    // Nor does an enemy truck.
    let mut world = sandbox();
    let unit = put(&mut world, 0, "ua-fpv-team", 1000, 2000);
    world.set_charges(unit, 0);
    put(&mut world, 1, "ru-supply-truck", 1100, 2000);
    steps(&mut world, 1000);
    assert_eq!(charges(&world, unit), 0);
}

#[test]
fn walking_away_from_the_source_resets_the_refill_clock() {
    let mut world = sandbox();
    let unit = put(&mut world, 0, "ua-fpv-team", 1000, 2000);
    world.set_charges(unit, 0);
    put(&mut world, 0, "ua-supply-truck", 1450, 2000);
    steps(&mut world, 250);
    fly_to(&mut world, 0, unit, 500, 2000);
    steps(&mut world, 100);
    fly_to(&mut world, 0, unit, 1000, 2000);
    steps(&mut world, 100);
    assert_eq!(charges(&world, unit), 0, "no progress carried over");
}

#[test]
fn the_sting_nest_refills_by_itself_and_only_launches_with_a_charge() {
    let mut world = sandbox();
    let nest = build(&mut world, 0, "ua-sting-nest", 10, 10);
    build(&mut world, 0, "ua-power-plant", 4, 10);
    assert_eq!(charges(&world, nest), 6);
    world.set_charges(nest, 0);
    // A Russian drone over the nest: nothing launches while it is empty.
    let drone = put(&mut world, 1, "ru-geran-2", 1300, 1100);
    order(
        &mut world,
        1,
        Command::Attack {
            units: vec![drone],
            target: nest,
        },
    );
    world.set_charges(nest, 0);
    // 59 ticks: no charge yet, no Sting.
    let early = launches_over(&mut world, nest, 59);
    assert_eq!(early, 0, "empty, it launches nothing");
    steps(&mut world, 2);
    assert!(
        charges(&world, nest) >= 1 || world.entities().iter().any(|e| e.master == Some(nest)),
        "a charge came back by itself and was used"
    );
}

#[test]
fn a_launcher_save_round_trips_and_old_saves_load_full() {
    let mut world = World::skirmish(Ruleset::builtin(), "showcase", 0).unwrap();
    let team = put(&mut world, 0, "ua-fpv-team", 1000, 2000);
    world.set_charges(team, 1);
    put(&mut world, 0, "ua-supply-truck", 1100, 2000);
    steps(&mut world, 100);
    assert_eq!(world.entity(team).unwrap().charge_clock, 100);
    let state = save_state(&world, 3, &[]).unwrap();
    let parsed: SimState = serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
    let (mut loaded, _, _) = load_state(&parsed).unwrap();
    assert_eq!(charges(&loaded, team), 1);
    assert_eq!(loaded.entity(team).unwrap().charge_clock, 100);
    assert_eq!(state_hash(&loaded), state_hash(&world));
    steps(&mut world, 250);
    steps(&mut loaded, 250);
    assert_eq!(charges(&loaded, team), 2);
    assert_eq!(state_hash(&loaded), state_hash(&world));
    // A save without the field (every save before charges) loads full.
    let mut text = serde_json::to_value(&state).unwrap();
    for entity in text["entities"].as_array_mut().unwrap() {
        entity.as_object_mut().unwrap().remove("charges");
        entity.as_object_mut().unwrap().remove("chargeClock");
    }
    let old: SimState = serde_json::from_value(text).unwrap();
    let (old_world, _, _) = load_state(&old).unwrap();
    assert_eq!(charges(&old_world, team), 4);
}

#[test]
fn the_charge_state_is_part_of_the_hash() {
    let hash = |spent: bool| {
        let mut world = sandbox();
        let team = put(&mut world, 0, "ua-fpv-team", 1000, 2000);
        if spent {
            world.set_charges(team, 3);
        }
        state_hash(&world)
    };
    assert_ne!(hash(true), hash(false));
    assert_eq!(hash(false), hash(false));
}

#[test]
fn the_showcase_examples_keep_every_unit_when_left_alone() {
    // Flyers and drones placed by a save are parked, on a rail or waiting on
    // the ground: none burns its fuel or starves while nobody orders it.
    for id in ["showcase", "showcase-units"] {
        let (mut world, _, _) = load_example(id);
        let before: Vec<(EntityId, u32)> = world.entities().iter().map(|e| (e.id, e.hp)).collect();
        assert_eq!(before.len(), 51, "{id}");
        steps(&mut world, 900);
        let after: Vec<(EntityId, u32)> = world.entities().iter().map(|e| (e.id, e.hp)).collect();
        assert_eq!(after, before, "{id}: 60 seconds on, nothing changed");
    }
}

// ---------------------------------------------------------------------------
// Spec 44: drones crash into tall civilian buildings
// ---------------------------------------------------------------------------

/// The west city of river-port: an apartment block east of the base covers
/// cells 29..=31 x 39..=41. A flyer of player 1 starts east of it and flies
/// west along y 40.5, straight through it.
fn through_the_apartment_block(id: &str) -> (World, EntityId, u32) {
    let mut world = World::skirmish(Ruleset::builtin(), "river-port", 1).unwrap();
    let block = world
        .feature_at(Cell { x: 30, y: 40 })
        .expect("the apartment block stands");
    let before = world.features()[block as usize].hp;
    let flyer = put(&mut world, 1, id, 4400, 4050);
    fly_to(&mut world, 1, flyer, 1000, 4050);
    steps(&mut world, 120);
    (world, flyer, before)
}

#[test]
fn a_one_way_drone_flying_into_a_tall_building_crashes_and_detonates_there() {
    let (world, geran, before) = through_the_apartment_block("ru-geran-2");
    assert!(world.entity(geran).is_none(), "the drone crashed");
    let block = world
        .feature_at(Cell { x: 30, y: 40 })
        .expect("still standing");
    assert!(
        world.features()[block as usize].hp < before,
        "the warhead hit the building"
    );
}

#[test]
fn a_flyer_above_the_rooftops_passes_over_the_town() {
    let (world, jet, _) = through_the_apartment_block("ru-su-34");
    assert!(world.entity(jet).is_some(), "the jet flies high");
}

#[test]
fn a_one_way_flyer_sent_to_an_empty_point_orbits_it_without_attacking() {
    let mut world = sandbox();
    let geran = put(&mut world, 1, "ru-geran-2", 6000, 2000);
    fly_to(&mut world, 1, geran, 2000, 2000);
    let mut blasts = Vec::new();
    for _ in 0..200 {
        world.step();
        blasts.extend(detonations(&world));
    }
    let pos = world.entity(geran).expect("still flying").pos;
    assert!(blasts.is_empty(), "nothing detonated");
    assert!(
        (pos - at(2000, 2000)).length() < fx_centi(1500),
        "it circles the point"
    );
}

#[test]
fn a_one_way_flyer_ordered_to_force_fire_a_point_still_dives_into_it() {
    let mut world = sandbox();
    let geran = put(&mut world, 1, "ru-geran-2", 6000, 2000);
    order(
        &mut world,
        1,
        Command::AttackGround {
            units: vec![geran],
            target: at(2000, 2000),
        },
    );
    let mut blasts = Vec::new();
    for _ in 0..200 {
        world.step();
        blasts.extend(detonations(&world));
    }
    assert!(world.entity(geran).is_none(), "the drone is spent");
    assert_eq!(blasts.len(), 1, "it detonated once");
}

/// The factory east of the west base on river-port covers cells 22..=25 x
/// 42..=44 and is lower (130) than the drone altitude (140). A Geran flies
/// west along y 43.5 to the point `x_centi`.
fn over_the_factory(x_centi: u32, ticks: u32) -> (World, EntityId, u32, Vec<FxVec2>) {
    let mut world = World::skirmish(Ruleset::builtin(), "river-port", 1).unwrap();
    let factory = world
        .feature_at(Cell { x: 23, y: 43 })
        .expect("the factory");
    let before = world.features()[factory as usize].hp;
    let geran = put(&mut world, 1, "ru-geran-2", 4400, 4350);
    order(
        &mut world,
        1,
        Command::AttackGround {
            units: vec![geran],
            target: at(x_centi, 4350),
        },
    );
    let mut blasts = Vec::new();
    for _ in 0..ticks {
        world.step();
        blasts.extend(detonations(&world).into_iter().map(|(_, pos)| pos));
    }
    (world, geran, before, blasts)
}

#[test]
fn a_cruising_drone_flies_over_a_low_building() {
    let (world, geran, _, blasts) = over_the_factory(500, 90);
    let pos = world.entity(geran).expect("still flying").pos;
    assert!(pos.x < fx_centi(2100), "past the factory");
    assert!(blasts.is_empty());
}

#[test]
fn a_diving_drone_hits_a_low_building_right_before_its_target() {
    let (world, geran, before, blasts) = over_the_factory(2100, 120);
    assert!(world.entity(geran).is_none(), "it went off");
    let blast = blasts.first().expect("one blast");
    assert!(
        blast.x >= fx_centi(2200) && blast.x <= fx_centi(2600),
        "in the factory, short of its point"
    );
    let factory = world
        .feature_at(Cell { x: 23, y: 43 })
        .expect("still standing");
    assert!(world.features()[factory as usize].hp < before);
}

#[test]
fn a_hovering_drone_ordered_onto_a_mountain_wall_stops_there() {
    let mut grid = MapGrid::open(80, 40);
    for x in 19..=21 {
        for y in 19..=21 {
            grid.set_blocked(Cell { x, y }, true);
        }
    }
    let mut world = World::sandbox(Ruleset::builtin(), grid, &[0, 1]);
    let fpv = put(&mut world, 0, "ua-fpv", 2400, 2100);
    fly_to(&mut world, 0, fpv, 2000, 2000);
    steps(&mut world, 200);
    let unit = world.entity(fpv).expect("still hovering");
    assert!(
        (unit.pos - at(2000, 2000)).length() < fx_centi(50),
        "on the wall"
    );
    assert!(matches!(unit.order, Order::Idle { .. }));
}
