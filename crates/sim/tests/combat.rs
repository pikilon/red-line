//! AC-03-26..AC-03-30: damage formula, targeting, cooldowns and attack orders.

use sim::combat::damage_dealt;
use sim::fixed::{Fx, FxVec2};
use sim::map::{Cell, MapGrid};
use sim::rules::{Ruleset, fx_centi};
use sim::world::{Command, Order, World};

fn test_rules() -> Ruleset {
    Ruleset::from_json(include_str!("fixtures/test-rules.json")).unwrap()
}

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn sandbox() -> World {
    World::sandbox(test_rules(), MapGrid::open(40, 24), &[0, 0])
}

fn steps(world: &mut World, count: u32) {
    for _ in 0..count {
        world.step();
    }
}

#[test]
fn ac_03_26_damage_formula() {
    assert_eq!(damage_dealt(10, 100), 10);
    assert_eq!(damage_dealt(10, 0), 0);
    assert_eq!(damage_dealt(10, 50), 5);
    assert_eq!(damage_dealt(1, 50), 1);
    assert_eq!(damage_dealt(3, 33), 1);
    assert_eq!(damage_dealt(40, 150), 60);
}

#[test]
fn ac_03_27_auto_targeting_cooldown_and_id_order() {
    let mut world = sandbox();
    let a = world.spawn(0, 9, at(1050, 1050));
    let b = world.spawn(1, 9, at(1450, 1050));
    assert_eq!((a, b), (0, 1));

    world.step();
    assert_eq!(world.entity(a).unwrap().hp, 40);
    assert_eq!(world.entity(b).unwrap().hp, 40);
    assert_eq!(world.entity(a).unwrap().last_target, Some(b));
    assert_eq!(world.entity(b).unwrap().last_target, Some(a));

    // Cooldown 5: both hold fire until the next volley on step 6.
    steps(&mut world, 4);
    assert_eq!(world.entity(a).unwrap().hp, 40);
    assert_eq!(world.entity(b).unwrap().hp, 40);
    world.step();
    assert_eq!(world.entity(a).unwrap().hp, 30);
    assert_eq!(world.entity(b).unwrap().hp, 30);

    // Volleys on steps 11, 16 and 21: A fires first in id order, so B dies at
    // step 21 without firing again.
    steps(&mut world, 15);
    assert!(world.entity(b).is_none());
    assert_eq!(world.entity(a).unwrap().hp, 10);

    world.step();
    assert_eq!(world.entity(a).unwrap().last_target, None);
}

#[test]
fn ac_03_28_zero_modifiers_are_never_targeted() {
    let mut world = sandbox();
    let soldier = world.spawn(0, 9, at(1050, 1050));
    let tank = world.spawn(1, 10, at(1450, 1050));

    // The gun's kinetic damage has a zero modifier against the tank's hard
    // armor, so the soldier never acquires it as a target: no `last_target`, no
    // cooldown and therefore no shot. The tank is unharmed either way, because
    // a zero-modifier hit deals no damage, so the target filter has to be
    // observed directly.
    world.step();
    assert_eq!(world.entity(soldier).unwrap().last_target, None);
    assert_eq!(world.entity(soldier).unwrap().cooldown, 0);
    assert_eq!(world.entity(tank).unwrap().last_target, Some(soldier));

    // Second cannon volley on step 11: still alive, still not targeting.
    steps(&mut world, 10);
    assert_eq!(world.entity(soldier).unwrap().last_target, None);
    assert_eq!(world.entity(soldier).unwrap().cooldown, 0);
    assert_eq!(world.entity(tank).unwrap().last_target, Some(soldier));

    // The cannon kills the soldier on step 21, which never harmed the tank.
    steps(&mut world, 10);
    assert_eq!(world.entity(tank).unwrap().hp, 200);
    assert!(world.entity(soldier).is_none());
}

#[test]
fn ac_03_29_range_min_range_and_shared_vision() {
    // Exactly 5.0 tiles apart: inside the gun range (500 centi), both fire.
    let mut world = sandbox();
    world.spawn(0, 9, at(1050, 1050));
    world.spawn(1, 9, at(1550, 1050));
    world.step();
    assert_eq!(world.entity(0).unwrap().hp, 40);
    assert_eq!(world.entity(1).unwrap().hp, 40);

    // One raw unit beyond 5.0 tiles: out of range, both hold fire.
    let mut world = sandbox();
    world.spawn(0, 9, at(1050, 1050));
    world.spawn(
        1,
        9,
        FxVec2::new(Fx::from_raw(15 * 65536 + 32768 + 1), fx_centi(1050)),
    );
    world.step();
    assert_eq!(world.entity(0).unwrap().hp, 50);
    assert_eq!(world.entity(1).unwrap().hp, 50);

    // Minimum range 3.0 tiles: 2.0 launches nothing, exactly 3.0 launches one.
    let mut world = sandbox();
    world.spawn(0, 11, at(550, 1050));
    world.spawn(1, 9, at(750, 1050));
    world.step();
    assert!(world.projectiles().is_empty());

    let mut world = sandbox();
    world.spawn(0, 11, at(550, 1050));
    world.spawn(1, 9, at(850, 1050));
    world.step();
    assert_eq!(world.projectiles().len(), 1);

    // Shared vision: the turret outranges its own sight (6 > 5), so it only
    // fires once the dozer at (17.5, 10.5) spots the soldier.
    let mut world = sandbox();
    world.place_building(0, 3, Cell { x: 0, y: 0 }, true);
    world.place_building(0, 6, Cell { x: 10, y: 10 }, true);
    let soldier = world.spawn(1, 9, at(1650, 1050));
    steps(&mut world, 20);
    assert_eq!(world.entity(soldier).unwrap().hp, 50);

    let mut world = sandbox();
    world.place_building(0, 3, Cell { x: 0, y: 0 }, true);
    world.place_building(0, 6, Cell { x: 10, y: 10 }, true);
    let soldier = world.spawn(1, 9, at(1650, 1050));
    world.spawn(0, 7, at(1750, 1050));
    world.step();
    assert_eq!(world.entity(soldier).unwrap().hp, 38);
}

#[test]
fn ac_03_30_attack_order() {
    let mut world = sandbox();
    let tank = world.spawn(0, 10, at(550, 550));
    let dozer = world.spawn(0, 7, at(2250, 550));
    let soldier = world.spawn(1, 9, at(2550, 550));
    assert_eq!((tank, dozer, soldier), (0, 1, 2));
    world.refresh_visibility();
    assert!(world.is_entity_visible(0, soldier));

    world.enqueue_as(
        0,
        Command::Attack {
            units: vec![tank],
            target: soldier,
        },
    );
    world.step();
    assert_eq!(
        world.entity(tank).unwrap().order,
        Order::Attack {
            order_id: 1,
            target: soldier,
        }
    );
    // The tank chases east at its 15 centitile speed.
    assert_eq!(world.entity(tank).unwrap().pos, at(565, 550));

    // The cannon (range 600 centi) reaches on step 94 and fires every 10 ticks.
    steps(&mut world, 92);
    assert_eq!(world.entity(soldier).unwrap().hp, 50);
    world.step();
    assert_eq!(world.entity(soldier).unwrap().hp, 30);
    assert_eq!(world.entity(tank).unwrap().pos.x.raw(), 1284468);

    // Inside the weapon range the tank holds position on steps 95..100.
    let parked = world.entity(tank).unwrap().pos;
    steps(&mut world, 6);
    assert_eq!(world.entity(tank).unwrap().pos, parked);

    while world.tick() < 114 {
        world.step();
    }
    assert!(world.entity(soldier).is_none());

    world.step();
    assert_eq!(
        world.entity(tank).unwrap().order,
        Order::Idle { last_order_id: 1 }
    );

    // An Attack on a target that is not visible to the issuer, on an own entity
    // or on a depot is ignored and consumes no order id.
    let mut world = sandbox();
    let tank = world.spawn(0, 10, at(550, 550));
    let dozer = world.spawn(0, 7, at(2250, 550));
    let hidden = world.spawn(1, 9, at(3550, 2050));
    let depot = world.place_depot(Cell { x: 30, y: 20 }, 100);
    world.refresh_visibility();
    assert!(!world.is_entity_visible(0, hidden));

    let order_id = world.next_order_id();
    for target in [dozer, depot, hidden] {
        world.enqueue_as(
            0,
            Command::Attack {
                units: vec![tank],
                target,
            },
        );
    }
    world.step();
    assert_eq!(world.next_order_id(), order_id);
    assert_eq!(
        world.entity(tank).unwrap().order,
        Order::Idle { last_order_id: 0 }
    );
}

#[test]
fn ac_03_31_area_projectiles() {
    let mut world = sandbox();
    let mortar = world.spawn(0, 11, at(550, 1050));
    let b1 = world.spawn(1, 9, at(1350, 1050));
    let b2 = world.spawn(1, 9, at(1450, 1050));
    let b3 = world.spawn(1, 9, at(1350, 1250));
    let dozer = world.spawn(0, 7, at(1350, 950));
    assert_eq!((mortar, b1, b2, b3, dozer), (0, 1, 2, 3, 4));

    // The mortar (projectile_ticks 4) fires on step 1 with the impact point
    // frozen at the target's fire-time position.
    world.step();
    assert_eq!(world.projectiles().len(), 1);
    let projectile = &world.projectiles()[0];
    assert_eq!(projectile.target, b1);
    assert_eq!(projectile.impact, at(1350, 1050));
    assert_eq!(projectile.impact_tick, 4);

    // The shell is airborne through step 4: nobody takes damage yet.
    steps(&mut world, 3);
    for soldier in [b1, b2, b3] {
        assert_eq!(world.entity(soldier).unwrap().hp, 50);
    }
    assert_eq!(world.entity(dozer).unwrap().hp, 100);

    // Step 5: splash 150 centi reaches B1 and B2 but not B3, and the shooter's
    // own dozer takes no friendly fire.
    world.step();
    assert_eq!(world.entity(b1).unwrap().hp, 35);
    assert_eq!(world.entity(b2).unwrap().hp, 35);
    assert_eq!(world.entity(b3).unwrap().hp, 50);
    assert_eq!(world.entity(dozer).unwrap().hp, 100);
    assert!(world.projectiles().is_empty());
}

#[test]
fn ac_03_32_guided_projectiles() {
    let mut world = sandbox();
    world.spawn(0, 12, at(550, 550));
    let soldier = world.spawn(1, 9, at(1150, 550));
    world.enqueue_as(
        1,
        Command::Move {
            units: vec![soldier],
            target: at(1150, 2050),
        },
    );
    world.step();
    assert_eq!(world.projectiles().len(), 1);
    assert_eq!(world.projectiles()[0].target, soldier);
    assert_eq!(world.projectiles()[0].impact_tick, 3);

    // The missile homes on the moving soldier: still airborne after step 3,
    // it lands on step 4 wherever the soldier is by then.
    steps(&mut world, 2);
    assert_eq!(world.projectiles().len(), 1);
    assert_eq!(world.entity(soldier).unwrap().hp, 50);
    world.step();
    assert!(world.projectiles().is_empty());
    assert_eq!(world.entity(soldier).unwrap().hp, 40);

    // A projectile whose target is gone at impact time hits nothing.
    let mut world = sandbox();
    let launcher = world.spawn(0, 12, at(550, 550));
    let soldier = world.spawn(1, 9, at(1150, 550));
    world.enqueue_as(
        1,
        Command::Move {
            units: vec![soldier],
            target: at(1150, 2050),
        },
    );
    world.step();
    world.set_hp(soldier, 0);
    steps(&mut world, 3);
    assert!(world.entity(soldier).is_none());
    assert_eq!(world.entities().len(), 1);
    assert_eq!(world.entity(launcher).unwrap().hp, 80);
    assert!(world.projectiles().is_empty());
}

#[test]
fn ac_03_33_powered_defenses() {
    // Powered: the requires_power turret fires its instant gun on step 1.
    let mut world = sandbox();
    world.place_building(0, 3, Cell { x: 0, y: 0 }, true);
    world.place_building(0, 6, Cell { x: 10, y: 10 }, true);
    let soldier = world.spawn(1, 9, at(1450, 1050));
    world.step();
    assert_eq!(world.entity(soldier).unwrap().hp, 38);

    // Two factories (4 each) plus the turret (6) consume 14 against 10
    // produced, so the unpowered turret holds fire.
    let mut world = sandbox();
    world.place_building(0, 3, Cell { x: 0, y: 0 }, true);
    world.place_building(0, 6, Cell { x: 10, y: 10 }, true);
    world.place_building(0, 5, Cell { x: 20, y: 0 }, true);
    world.place_building(0, 5, Cell { x: 24, y: 0 }, true);
    let soldier = world.spawn(1, 9, at(1450, 1050));
    steps(&mut world, 20);
    assert_eq!(world.player(0).unwrap().power(), (10, 14));
    assert_eq!(world.entity(soldier).unwrap().hp, 50);
}
