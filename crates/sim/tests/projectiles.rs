//! AC-17-02..10: projectile flight, delivery, scatter, salvos, combat events
//! and the combat snapshot (spec 17 §4.2–§4.7).

use serde_json::{Value, json};
use sim::fixed::FxVec2;
use sim::hash::{fnv1a64, state_hash};
use sim::map::MapGrid;
use sim::rules::{Ruleset, fx_centi};
use sim::world::{Command, World};

fn at(x_centi: u32, y_centi: u32) -> FxVec2 {
    FxVec2::new(fx_centi(x_centi), fx_centi(y_centi))
}

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/test-rules.json")).expect("fixture is JSON")
}

/// A copy of the fixture ruleset with extra weapons and unit types (spec 17 §10).
struct TestRules {
    value: Value,
}

impl TestRules {
    fn new() -> Self {
        Self { value: fixture() }
    }

    /// Appends `weapon` to the fixture and returns its index.
    fn weapon(&mut self, weapon: Value) -> i32 {
        let weapons = self.value["weapons"].as_array_mut().expect("weapons array");
        weapons.push(weapon);
        (weapons.len() - 1) as i32
    }

    /// Appends a `base`-shaped unit named `id` at `speed_centi`, firing the
    /// weapon at `weapon` (`-1` for unarmed), and with a sight range long enough
    /// for the sandbox scenarios.
    fn unit(&mut self, id: &str, base: &str, weapon: i32, speed_centi: u32) {
        let types = self.value["types"].as_array_mut().expect("types array");
        let mut unit = types
            .iter()
            .find(|ty| ty["id"] == base)
            .expect("base type exists")
            .clone();
        unit["id"] = json!(id);
        unit["weapon"] = json!(weapon);
        unit["speedCenti"] = json!(speed_centi);
        unit["sightCenti"] = json!(2000);
        types.push(unit);
    }

    fn build(&self) -> Ruleset {
        Ruleset::from_json(&self.value.to_string()).expect("test ruleset parses")
    }
}

/// A splash-free projectile weapon over the fixture's `explosive` damage type.
fn weapon(
    id: &str,
    speed_centi: u32,
    delivery: u8,
    scatter: u32,
    salvo: u32,
    interval: u32,
) -> Value {
    json!({
        "id": id,
        "damageType": 1,
        "damage": 20,
        "rangeCenti": 4000,
        "minRangeCenti": 0,
        "cooldownTicks": 500,
        "splashCenti": 0,
        "projectileTicks": 0,
        "speedCenti": speed_centi,
        "delivery": delivery,
        "scatterCenti": scatter,
        "salvo": salvo,
        "salvoIntervalTicks": interval,
    })
}

#[test]
fn ac_17_02_flight_time_from_speed() {
    let mut rules = TestRules::new();
    let gun = rules.weapon(weapon("speed-rifle", 400, 0, 0, 1, 0));
    rules.unit("rifleman", "soldier", gun, 10);
    let rules = rules.build();
    let rifleman = rules.type_index("rifleman").unwrap();
    let target_kind = rules.type_index("dozer").unwrap();

    // 3.0 tiles at speed 400: one tick of flight.
    let mut world = World::sandbox(rules.clone(), MapGrid::open(40, 24), &[0, 0]);
    let _shooter = world.spawn(0, rifleman, at(1000, 1000));
    let target = world.spawn(1, target_kind, at(1300, 1000));
    world.step();
    assert_eq!(world.projectiles().len(), 1);
    assert_eq!(world.projectiles()[0].launch_tick, 0);
    assert_eq!(world.projectiles()[0].impact_tick, 1);
    assert_eq!(
        world.entity(target).unwrap().hp,
        100,
        "damage before impact"
    );
    world.step();
    assert!(world.projectiles().is_empty());
    assert_eq!(world.entity(target).unwrap().hp, 80, "damage on impact");

    // 4.2 tiles: two ticks of flight.
    let mut world = World::sandbox(rules, MapGrid::open(40, 24), &[0, 0]);
    let _shooter = world.spawn(0, rifleman, at(1000, 1000));
    let target = world.spawn(1, target_kind, at(1420, 1000));
    world.step();
    assert_eq!(world.projectiles()[0].impact_tick, 2);
    world.step();
    assert_eq!(
        world.entity(target).unwrap().hp,
        100,
        "damage before impact"
    );
    world.step();
    assert_eq!(world.entity(target).unwrap().hp, 80, "damage on impact");
}

#[test]
fn ac_17_03_legacy_behaviour() {
    // The unchanged fixture keeps the spec 03 behaviour: a weapon with
    // `projectileTicks == 0` and no `speedCenti` hits in the tick it fires and
    // creates no projectile. AC-03-27..33 pin the rest of the fixture.
    let rules = Ruleset::from_json(include_str!("fixtures/test-rules.json")).unwrap();
    let soldier = rules.type_index("soldier").unwrap();
    let mut world = World::sandbox(rules, MapGrid::open(40, 24), &[0, 0]);
    world.spawn(0, soldier, at(1000, 1000));
    let target = world.spawn(1, soldier, at(1400, 1000));
    world.step();
    assert!(world.projectiles().is_empty());
    assert_eq!(world.entity(target).unwrap().hp, 40, "instant hit");
}

#[test]
fn ac_17_04_homing_tracks() {
    let mut rules = TestRules::new();
    let atgm = rules.weapon(weapon("homing-atgm", 45, 0, 0, 1, 0));
    rules.unit("atgm-team", "soldier", atgm, 6);
    let rules = rules.build();
    let team = rules.type_index("atgm-team").unwrap();
    let runner_kind = rules.type_index("dozer").unwrap();

    let mut world = World::sandbox(rules, MapGrid::open(60, 40), &[0, 0]);
    let _shooter = world.spawn(0, team, at(500, 500));
    let target = world.spawn(1, runner_kind, at(1000, 500));
    world.enqueue_as(
        1,
        Command::Move {
            units: vec![target],
            target: at(1000, 6000),
        },
    );
    world.step();
    assert_eq!(world.projectiles().len(), 1);
    assert_eq!(world.projectiles()[0].launch_tick, 0);
    assert_eq!(world.projectiles()[0].impact_tick, 12);
    assert_eq!(
        world.projectiles()[0].impact,
        world.entity(target).unwrap().pos,
        "impact follows the target"
    );

    // The target keeps moving and the missile follows every tick until impact.
    for _ in 1..12 {
        world.step();
        let target_pos = world.entity(target).unwrap().pos;
        assert_eq!(world.projectiles()[0].impact, target_pos);
    }
    let before = world.entity(target).unwrap().hp;
    world.step();
    assert!(world.projectiles().is_empty());
    assert_eq!(world.entity(target).unwrap().hp, before - 20);

    // A target that dies first leaves the last `impact` frozen; the missile
    // resolves at that point and damages nobody (the shooter is unharmed).
    let mut rules = TestRules::new();
    let atgm = rules.weapon(weapon("homing-atgm", 45, 0, 0, 1, 0));
    rules.unit("atgm-team", "soldier", atgm, 6);
    let rules = rules.build();
    let team = rules.type_index("atgm-team").unwrap();
    let runner_kind = rules.type_index("dozer").unwrap();
    let mut world = World::sandbox(rules, MapGrid::open(60, 40), &[0, 0]);
    let shooter = world.spawn(0, team, at(500, 500));
    let target = world.spawn(1, runner_kind, at(1000, 500));
    world.step();
    let last_impact = world.projectiles()[0].impact;
    let shooter_hp = world.entity(shooter).unwrap().hp;
    world.set_hp(target, 0);
    for _ in 0..14 {
        world.step();
    }
    assert!(world.projectiles().is_empty());
    assert!(world.entity(target).is_none());
    assert_eq!(
        world.entity(shooter).unwrap().hp,
        shooter_hp,
        "nobody is damaged"
    );
    let _ = last_impact;
}

#[test]
fn ac_17_05_ballistic_can_miss() {
    let mut rules = TestRules::new();
    let rpg = rules.weapon(weapon("ballistic-rpg", 60, 1, 0, 1, 0));
    rules.unit("rpg-gunner", "soldier", rpg, 1);
    rules.unit("runner", "dozer", -1, 30);
    let rules = rules.build();
    let gunner = rules.type_index("rpg-gunner").unwrap();
    let runner_kind = rules.type_index("runner").unwrap();

    // A moving target is missed: the aim is frozen at fire time.
    let mut world = World::sandbox(rules.clone(), MapGrid::open(60, 40), &[0, 0]);
    let _shooter = world.spawn(0, gunner, at(1000, 1000));
    let runner = world.spawn(1, runner_kind, at(1500, 1000));
    world.enqueue_as(
        1,
        Command::Move {
            units: vec![runner],
            target: at(1500, 6000),
        },
    );
    world.step();
    assert_eq!(world.projectiles().len(), 1);
    assert_eq!(world.projectiles()[0].impact_tick, 9);
    let aim = world.projectiles()[0].impact;
    assert_eq!(aim, world.entity(runner).unwrap().pos);
    for _ in 0..3 {
        world.step();
        assert_eq!(
            world.projectiles()[0].impact,
            aim,
            "ballistic aim is frozen"
        );
    }
    let mut guard = 0;
    while !world.projectiles().is_empty() && guard < 40 {
        world.step();
        guard += 1;
    }
    assert!(world.projectiles().is_empty());
    assert_eq!(
        world.entity(runner).unwrap().hp,
        100,
        "the runner was missed"
    );

    // A stationary target standing on the aim point is hit.
    let mut world = World::sandbox(rules.clone(), MapGrid::open(60, 40), &[0, 0]);
    let _shooter = world.spawn(0, gunner, at(1000, 1000));
    let sitting = world.spawn(1, runner_kind, at(1500, 1000));
    world.step();
    let mut guard = 0;
    while !world.projectiles().is_empty() && guard < 40 {
        world.step();
        guard += 1;
    }
    assert_eq!(
        world.entity(sitting).unwrap().hp,
        80,
        "stationary target hit"
    );

    // An enemy standing within `DIRECT_HIT_CENTI` of the impact is hit instead.
    let mut world = World::sandbox(rules, MapGrid::open(60, 40), &[0, 0, 0]);
    let _shooter = world.spawn(0, gunner, at(1000, 1000));
    let runner = world.spawn(1, runner_kind, at(1500, 1000));
    world.enqueue_as(
        1,
        Command::Move {
            units: vec![runner],
            target: at(1500, 6000),
        },
    );
    world.step();
    let impact = world.projectiles()[0].impact;
    // A third player's unit, so it does not step out of the runner's way
    // (spec 04 §5.3).
    let sitter = world.spawn(2, runner_kind, impact);
    let mut guard = 0;
    while !world.projectiles().is_empty() && guard < 40 {
        world.step();
        guard += 1;
    }
    assert_eq!(world.entity(sitter).unwrap().hp, 80, "nearby enemy is hit");
    assert_eq!(
        world.entity(runner).unwrap().hp,
        100,
        "the runner still left"
    );
}

#[test]
fn ac_17_06_scatter() {
    let mut rules = TestRules::new();
    let rocket = rules.weapon(weapon("scatter-rocket", 45, 1, 150, 4, 0));
    rules.unit("scatterer", "soldier", rocket, 1);
    let rules = rules.build();
    let scatterer = rules.type_index("scatterer").unwrap();
    let target_kind = rules.type_index("dozer").unwrap();

    let build = || {
        let mut world = World::sandbox(rules.clone(), MapGrid::open(60, 40), &[0, 0]);
        world.spawn(0, scatterer, at(500, 500));
        world.spawn(1, target_kind, at(1500, 500));
        world.step();
        world
    };

    let first = build();
    assert_eq!(first.projectiles().len(), 4);
    assert_eq!(
        first.projectiles().iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![0, 1, 2, 3]
    );
    let aim = first.entity(1).unwrap().pos;
    let impacts: Vec<FxVec2> = first.projectiles().iter().map(|p| p.impact).collect();
    for impact in &impacts {
        assert!(
            (*impact - aim).length() <= fx_centi(150),
            "impact {impact:?} outside the scatter radius"
        );
    }
    assert!(
        impacts.iter().any(|impact| *impact != impacts[0]),
        "all four impacts are equal"
    );

    // The draw is stateless: the same commands give the same impacts.
    let second = build();
    let impacts_second: Vec<FxVec2> = second.projectiles().iter().map(|p| p.impact).collect();
    assert_eq!(impacts, impacts_second);

    // Scatter 0 lands exactly on the aim point.
    let mut rules = TestRules::new();
    let plain = rules.weapon(weapon("plain-rocket", 45, 1, 0, 4, 0));
    rules.unit("plain-gunner", "soldier", plain, 1);
    let rules = rules.build();
    let gunner = rules.type_index("plain-gunner").unwrap();
    let target_kind = rules.type_index("dozer").unwrap();
    let mut world = World::sandbox(rules, MapGrid::open(60, 40), &[0, 0]);
    world.spawn(0, gunner, at(500, 500));
    world.spawn(1, target_kind, at(1500, 500));
    world.step();
    let aim = world.entity(1).unwrap().pos;
    for projectile in world.projectiles() {
        assert_eq!(projectile.impact, aim);
    }
}

#[test]
fn ac_17_07_salvo() {
    let mut rules = TestRules::new();
    let salvo = rules.weapon(weapon("salvo-gun", 45, 0, 0, 4, 3));
    rules.unit("salvoer", "soldier", salvo, 1);
    let rules = rules.build();
    let salvoer = rules.type_index("salvoer").unwrap();
    let target_kind = rules.type_index("dozer").unwrap();

    let mut world = World::sandbox(rules.clone(), MapGrid::open(60, 40), &[0, 0]);
    let _shooter = world.spawn(0, salvoer, at(500, 500));
    world.spawn(1, target_kind, at(1500, 500));
    world.step();
    assert_eq!(
        world.projectiles().iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![0, 1, 2, 3]
    );
    assert_eq!(
        world
            .projectiles()
            .iter()
            .map(|p| p.launch_tick)
            .collect::<Vec<_>>(),
        vec![0, 3, 6, 9]
    );
    assert_eq!(
        world
            .projectiles()
            .iter()
            .map(|p| p.impact_tick)
            .collect::<Vec<_>>(),
        vec![23, 26, 29, 32]
    );

    // The shooter dies on tick 4: the not-yet-launched `t + 6` and `t + 9`
    // projectiles are removed, the launcher keeps flying.
    let mut world = World::sandbox(rules, MapGrid::open(60, 40), &[0, 0]);
    let shooter = world.spawn(0, salvoer, at(500, 500));
    world.spawn(1, target_kind, at(1500, 500));
    while world.tick() < 4 {
        world.step();
    }
    assert_eq!(world.projectiles().len(), 4);
    world.set_hp(shooter, 0);
    world.step();
    assert_eq!(
        world
            .projectiles()
            .iter()
            .map(|p| p.launch_tick)
            .collect::<Vec<_>>(),
        vec![0, 3]
    );
}

#[test]
fn ac_17_10_hash() {
    // The empty-world stream of AC-03-08 is unchanged by the projectile record.
    let empty = World::new(MapGrid::open(4, 4));
    let bytes: [u8; 39] = [
        0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 255, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    assert_eq!(state_hash(&empty), fnv1a64(&bytes));

    // Two worlds that differ only in the flying projectile's `origin` hash
    // differently: the shooter is removed before the comparison.
    let origin_world = |x_centi: u32| {
        let mut rules = TestRules::new();
        let gun = rules.weapon(weapon("hash-gun", 400, 0, 0, 1, 0));
        rules.unit("hasher", "soldier", gun, 10);
        let rules = rules.build();
        let hasher = rules.type_index("hasher").unwrap();
        let target_kind = rules.type_index("dozer").unwrap();
        let mut world = World::sandbox(rules, MapGrid::open(40, 24), &[0, 0]);
        let shooter = world.spawn(0, hasher, at(x_centi, 1000));
        world.spawn(1, target_kind, at(2500, 1000));
        world.step();
        world.set_hp(shooter, 0);
        world.step();
        assert!(world.entity(shooter).is_none());
        assert_eq!(world.projectiles().len(), 1);
        assert_eq!(world.projectiles()[0].origin, at(x_centi, 1000));
        world
    };
    let a = origin_world(1000);
    let b = origin_world(1050);
    assert_eq!(a.projectiles()[0].impact, b.projectiles()[0].impact);
    assert_ne!(state_hash(&a), state_hash(&b));
}

#[test]
fn ac_17_08_events_and_killer() {
    use sim::rules::WeaponId;
    use sim::world::CombatEvent;

    // An instant kill: the step that removes the victim names the killer and
    // its weapon.
    let mut rules = TestRules::new();
    let gun = rules.weapon(weapon("killer-gun", 0, 0, 0, 1, 0));
    rules.unit("killer", "soldier", gun, 10);
    let rules = rules.build();
    let killer_kind = rules.type_index("killer").unwrap();
    let victim_kind = rules.type_index("tech-slice-placeholder").unwrap();
    let weapon_id = rules.ty(killer_kind).weapon as WeaponId;

    let mut world = World::sandbox(rules, MapGrid::open(40, 24), &[0, 0]);
    let killer = world.spawn(0, killer_kind, at(1000, 1000));
    let victim = world.spawn(1, victim_kind, at(1300, 1000));
    let victim_pos = world.entity(victim).unwrap().pos;
    world.step();
    assert_eq!(
        world.events(),
        &[CombatEvent::Death {
            victim,
            owner: 1,
            kind: victim_kind,
            pos: victim_pos,
            killer: Some(killer),
            weapon: Some(weapon_id),
        }],
        "the instant kill names the killer"
    );
    assert!(world.entity(victim).is_none());

    // A projectile whose shooter dies in flight still credits that shooter.
    let mut rules = TestRules::new();
    let shell = rules.weapon(weapon("flight-gun", 45, 0, 0, 1, 0));
    rules.unit("flyer", "soldier", shell, 10);
    let rules = rules.build();
    let flyer_kind = rules.type_index("flyer").unwrap();
    let victim_kind = rules.type_index("tech-slice-placeholder").unwrap();
    let weapon_id = rules.ty(flyer_kind).weapon as WeaponId;

    let mut world = World::sandbox(rules, MapGrid::open(40, 24), &[0, 0]);
    let shooter = world.spawn(0, flyer_kind, at(500, 500));
    let victim = world.spawn(1, victim_kind, at(800, 500));
    world.step();
    assert_eq!(world.projectiles().len(), 1);
    world.set_hp(shooter, 0);
    world.step();
    assert!(world.entity(shooter).is_none(), "the shooter is removed");
    let mut death = None;
    for _ in 0..20 {
        world.step();
        for event in world.events() {
            if let CombatEvent::Death {
                victim: dead,
                killer,
                weapon,
                ..
            } = event
                && *dead == victim
            {
                death = Some((*killer, *weapon));
            }
        }
        if death.is_some() {
            break;
        }
    }
    assert_eq!(death, Some((Some(shooter), Some(weapon_id))));
    assert!(world.entity(victim).is_none());

    // A unit set to `hp 0` with no prior hit has no killer.
    let rules = TestRules::new().build();
    let victim_kind = rules.type_index("tech-slice-placeholder").unwrap();
    let mut world = World::sandbox(rules, MapGrid::open(40, 24), &[0, 0]);
    let victim = world.spawn(1, victim_kind, at(500, 500));
    world.set_hp(victim, 0);
    world.step();
    assert_eq!(
        world.events(),
        &[CombatEvent::Death {
            victim,
            owner: 1,
            kind: victim_kind,
            pos: at(500, 500),
            killer: None,
            weapon: None,
        }]
    );

    // A step with no combat emits no events.
    let mut world = World::new(MapGrid::open(4, 4));
    world.step();
    assert!(world.events().is_empty());
}

#[test]
fn ac_17_09_combat_snapshot() {
    use sim::rules::WeaponId;
    use sim::snapshot::{
        EVENT_DEATH, EVENT_DETONATE, EVENT_STRIDE, PROJECTILE_STRIDE, encode_combat,
    };
    use sim::wasm_api::Sim;

    // The AC-17-07 scenario: one salvo of four projectiles whose impacts are
    // three ticks apart. The player owns them; the observer sees everything.
    let mut rules = TestRules::new();
    let salvo = rules.weapon(weapon("salvo-gun", 45, 0, 0, 4, 3));
    rules.unit("salvoer", "soldier", salvo, 1);
    let rules = rules.build();
    let salvoer = rules.type_index("salvoer").unwrap();
    let target_kind = rules.type_index("dozer").unwrap();
    let weapon_id = rules.ty(salvoer).weapon as WeaponId;

    let mut world = World::sandbox(rules, MapGrid::open(60, 40), &[0, 0, 0]);
    let shooter = world.spawn(0, salvoer, at(500, 500));
    let target = world.spawn(1, target_kind, at(1500, 500));
    world.step();

    let origin = at(500, 500);
    let aim = at(1500, 500);
    let projectile_row = |id: i32, launch_tick: i32, impact_tick: i32| {
        [
            id,
            0,
            weapon_id as i32,
            shooter as i32,
            target as i32,
            origin.x.raw(),
            origin.y.raw(),
            aim.x.raw(),
            aim.y.raw(),
            launch_tick,
            impact_tick,
        ]
    };
    let encoded = encode_combat(&world, 0, &[]);
    assert_eq!(encoded.len(), 1 + 4 * PROJECTILE_STRIDE + 1);
    assert_eq!(encoded[0], 4, "four projectiles");
    assert_eq!(encoded[1 + 4 * PROJECTILE_STRIDE], 0, "no events yet");
    for (k, row) in [
        projectile_row(0, 0, 23),
        projectile_row(1, 3, 26),
        projectile_row(2, 6, 29),
        projectile_row(3, 9, 32),
    ]
    .iter()
    .enumerate()
    {
        let base = 1 + k * PROJECTILE_STRIDE;
        assert_eq!(&encoded[base..base + PROJECTILE_STRIDE], row);
    }

    // A blind player (no entities) sees neither origin nor impact, so the
    // projectiles are omitted; the observer sees everything.
    assert_eq!(encode_combat(&world, 2, &[]), vec![0, 0]);
    assert_eq!(encode_combat(&world, 255, &[]), encoded);

    // `combat_for` is `encode_combat` over the pending events: with none, the
    // AC-17-07 layout comes back unchanged on every call.
    let mut sim = Sim::from_world(world);
    assert_eq!(sim.combat_for(0), encoded);
    assert_eq!(sim.combat_for(0), encoded);

    // `combat_for` accumulates the events of every step, then clears them: a
    // salvo with a one-tick interval detonates on two consecutive steps.
    let mut rules = TestRules::new();
    let rapid = rules.weapon(weapon("rapid-salvo", 45, 0, 0, 4, 1));
    rules.unit("rapid-salvoer", "soldier", rapid, 1);
    let rules = rules.build();
    let salvoer = rules.type_index("rapid-salvoer").unwrap();
    let target_kind = rules.type_index("dozer").unwrap();
    let weapon_id = rules.ty(salvoer).weapon as WeaponId;

    let mut world = World::sandbox(rules, MapGrid::open(60, 40), &[0, 0]);
    let _shooter = world.spawn(0, salvoer, at(500, 500));
    let target = world.spawn(1, target_kind, at(1500, 500));
    let mut sim = Sim::from_world(world);
    sim.step();
    let _ = sim.combat_for(0);
    sim.step_n(22);
    assert_eq!(sim.tick(), 23);
    sim.step();
    sim.step();

    let data = sim.combat_for(0);
    let projectiles = data[0] as usize;
    let event_base = 1 + projectiles * PROJECTILE_STRIDE;
    assert_eq!(data[event_base], 2, "both steps' events are reported");
    let impact = at(1500, 500);
    for (k, projectile) in [0, 1].iter().enumerate() {
        let base = event_base + 1 + k * EVENT_STRIDE;
        assert_eq!(
            &data[base..base + EVENT_STRIDE],
            &[
                EVENT_DETONATE,
                *projectile,
                0,
                weapon_id as i32,
                target as i32,
                impact.x.raw(),
                impact.y.raw(),
            ]
        );
    }
    let second = sim.combat_for(0);
    let projectiles = second[0] as usize;
    assert_eq!(
        second[1 + projectiles * PROJECTILE_STRIDE],
        0,
        "a second combat_for reports no events"
    );

    // The death layout: victim, kind, killer, weapon and position, `-1` when
    // absent.
    let mut rules = TestRules::new();
    let gun = rules.weapon(weapon("snapshot-killer", 0, 0, 0, 1, 0));
    rules.unit("snapshot-killer", "soldier", gun, 10);
    let rules = rules.build();
    let killer_kind = rules.type_index("snapshot-killer").unwrap();
    let victim_kind = rules.type_index("tech-slice-placeholder").unwrap();
    let weapon_id = rules.ty(killer_kind).weapon as WeaponId;

    let mut world = World::sandbox(rules, MapGrid::open(40, 24), &[0, 0]);
    let killer = world.spawn(0, killer_kind, at(1000, 1000));
    let victim = world.spawn(1, victim_kind, at(1300, 1000));
    world.step();
    let killed = encode_combat(&world, 0, world.events());
    assert_eq!(killed[0], 0, "the instant kill creates no projectile");
    assert_eq!(killed[1], 1, "one death event");
    let victim_pos = at(1300, 1000);
    assert_eq!(
        &killed[2..2 + EVENT_STRIDE],
        &[
            EVENT_DEATH,
            victim as i32,
            victim_kind as i32,
            killer as i32,
            weapon_id as i32,
            victim_pos.x.raw(),
            victim_pos.y.raw(),
        ]
    );

    // No prior hit: killer and weapon encode as `-1`.
    let rules = TestRules::new().build();
    let victim_kind = rules.type_index("tech-slice-placeholder").unwrap();
    let mut world = World::sandbox(rules, MapGrid::open(40, 24), &[0, 0]);
    let victim = world.spawn(1, victim_kind, at(500, 500));
    world.set_hp(victim, 0);
    world.step();
    // Player 0 owns no entity that could see the victim: the event is omitted.
    assert_eq!(encode_combat(&world, 0, world.events()), vec![0, 0]);
    let killed = encode_combat(&world, 255, world.events());
    assert_eq!(killed[1], 1);
    assert_eq!(&killed[2..3], &[EVENT_DEATH]);
    assert_eq!(&killed[5..7], &[-1, -1], "no killer and no weapon");
}
