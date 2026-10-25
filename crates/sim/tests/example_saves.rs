//! AC-19-14: every example save keeps its contract (spec 19 §7), and
//! AC-19-04 (b) / AC-19-05: examples round-trip and continue identically.
//!
//! Committed in the RED phase (D-08). The implementer must make these pass
//! without modifying them.

mod common;

use common::saves::{example_ids, load_example, run};
use sim::ai::step_with_ai;
use sim::entity::OBSERVER;
use sim::fixed::FxVec2;
use sim::hash::state_hash;
use sim::rules::{Category, fx_centi};
use sim::save::save_state;
use sim::snapshot::{encode_fog, encode_match_snapshot_with_shots};
use sim::world::{Outcome, World};
use std::collections::BTreeMap;

fn kind(world: &World, id: &str) -> u16 {
    world
        .rules()
        .type_index(id)
        .unwrap_or_else(|| panic!("type {id}"))
}

fn count(world: &World, player: u8, category: Category) -> usize {
    world
        .entities()
        .iter()
        .filter(|e| e.owner == player && world.rules().ty(e.kind).category == category)
        .count()
}

/// Deaths in the first `ticks` steps.
fn deaths(id: &str, ticks: u32) -> usize {
    let (mut world, _, mut ais) = load_example(id);
    run(&mut world, &mut ais, ticks)
}

fn showcase_contract(id: &str) {
    let (world, _, _) = load_example(id);
    assert_eq!(world.entities().len(), 28);
    let rules = world.rules();
    for (player, faction) in [(0u8, 0usize), (1, 1)] {
        let mut kinds: Vec<u16> = world
            .entities()
            .iter()
            .filter(|e| e.owner == player)
            .map(|e| e.kind)
            .collect();
        kinds.sort_unstable();
        let mut expected: Vec<u16> = (0..rules.types.len() as u16)
            .filter(|&k| {
                let ty = rules.ty(k);
                ty.faction == faction as i32 && ty.category != Category::Depot
            })
            .collect();
        expected.sort_unstable();
        assert_eq!(kinds, expected, "{id}: player {player} has each type once");
    }
}

#[test]
fn ac_19_14_showcase() {
    showcase_contract("showcase");
}

#[test]
fn ac_19_14_showcase_units() {
    showcase_contract("showcase-units");
}

#[test]
fn ac_19_14_armor_duel() {
    assert!(deaths("armor-duel", 900) > 0);
}

#[test]
fn ac_19_14_infantry_vs_armor() {
    // Changed by the owner (issue #232): with tracked tanks the tanks stop beyond the
    // line after their orders, so the contract is checked as hits, not deaths.
    let (mut world, _, mut ais) = load_example("infantry-vs-armor");
    run(&mut world, &mut ais, 900);
    let rules = world.rules();
    assert!(
        world.entities().iter().any(|e| {
            rules.ty(e.kind).category == sim::rules::Category::Unit && e.hp < rules.ty(e.kind).hp
        }),
        "a unit takes damage within 900 ticks"
    );
}

#[test]
fn ac_25_08_run_over() {
    // Spec 25: the tank's lane is crushed; the truck's lane is shoved, hurt, alive.
    let (mut world, _, mut ais) = load_example("run-over");
    run(&mut world, &mut ais, 900);
    let rules = world.rules();
    let soldiers: Vec<_> = world.entities().iter().filter(|e| e.owner == 1).collect();
    let lane = fx_centi(2000);
    assert!(
        soldiers.iter().all(|e| e.pos.y > lane),
        "no rifleman survives the tank"
    );
    assert!(!soldiers.is_empty(), "the truck does not crush");
    assert!(
        soldiers.iter().any(|e| e.hp < rules.ty(e.kind).hp),
        "the truck's shove hurts"
    );
}

#[test]
fn ac_19_14_rpg_ambush() {
    assert!(deaths("rpg-ambush", 900) > 0);
}

#[test]
fn ac_19_14_artillery_range() {
    let (mut world, _, mut ais) = load_example("artillery-range");
    let targets: Vec<(u32, u32)> = world
        .entities()
        .iter()
        .filter(|e| {
            let id = &world.rules().ty(e.kind).id;
            id.ends_with("power-plant") || id.ends_with("barracks")
        })
        .map(|e| (e.id, e.hp))
        .collect();
    assert_eq!(targets.len(), 4);
    let mut flying = false;
    for _ in 0..300 {
        step_with_ai(&mut world, &mut ais);
        flying |= !world.projectiles().is_empty();
    }
    assert!(flying, "a projectile in flight within 300 ticks");
    run(&mut world, &mut ais, 600);
    let damaged = targets
        .iter()
        .any(|&(id, hp)| world.entity(id).is_none_or(|e| e.hp < hp));
    assert!(damaged, "a targeted building lost HP by tick 900");
}

#[test]
fn ac_19_14_force_fire_demo() {
    let (mut world, _, mut ais) = load_example("force-fire-demo");
    assert_eq!(count(&world, 0, Category::Unit), 2);
    assert_eq!(count(&world, 1, Category::Unit), 1);
    assert_eq!(count(&world, 1, Category::Building), 1);
    let plant = world
        .entities()
        .iter()
        .find(|e| world.rules().ty(e.kind).id == "ru-power-plant")
        .map(|e| (e.id, e.hp))
        .expect("demo power plant");
    run(&mut world, &mut ais, 900);
    assert!(
        world.entity(plant.0).is_none_or(|e| e.hp < plant.1),
        "the HIMARS shells the power plant"
    );
}

#[test]
fn ac_19_14_defenses() {
    assert!(deaths("defenses", 900) > 0);
}

#[test]
fn ac_19_14_base_assault() {
    let (mut world, _, mut ais) = load_example("base-assault");
    let before: BTreeMap<u32, u32> = world
        .entities()
        .iter()
        .filter(|e| e.owner == 0 && e.site.is_some())
        .map(|e| (e.id, e.hp))
        .collect();
    run(&mut world, &mut ais, 900);
    let damaged = before
        .iter()
        .any(|(&id, &hp)| world.entity(id).is_none_or(|e| e.hp < hp));
    assert!(damaged, "a Ukrainian building damaged within 900 ticks");
}

#[test]
fn ac_19_14_economy() {
    let (mut world, _, mut ais) = load_example("economy");
    let start: Vec<u32> = world.players().iter().map(|p| p.credits).collect();
    let mut rose = [false, false];
    for _ in 0..900 {
        step_with_ai(&mut world, &mut ais);
        for (player, flag) in rose.iter_mut().enumerate() {
            *flag |= world.players()[player].credits > start[player];
        }
    }
    assert_eq!(
        rose,
        [true, true],
        "both players earn credits within 900 ticks"
    );
}

#[test]
fn ac_19_14_low_power() {
    let (mut world, _, mut ais) = load_example("low-power");
    run(&mut world, &mut ais, 1);
    let (produced, consumed) = world.players()[0].power();
    assert!(consumed > produced, "{consumed} > {produced}");
}

#[test]
fn ac_19_14_production() {
    let (world, _, _) = load_example("production");
    assert_eq!(world.players()[0].credits, 50_000);
    let rules = world.rules();
    for k in 0..rules.types.len() as u16 {
        let ty = rules.ty(k);
        if ty.faction != 0 || ty.category != Category::Building {
            continue;
        }
        assert!(
            world.entities().iter().any(|e| e.owner == 0
                && e.kind == k
                && e.site.as_ref().is_some_and(|s| s.complete)),
            "{} complete",
            ty.id
        );
    }
}

#[test]
fn ac_19_14_construction() {
    let (world, _, _) = load_example("construction");
    let mut seen = Vec::new();
    for e in world.entities() {
        let site = e.site.as_ref().expect("only buildings");
        let total = world.rules().ty(e.kind).build_ticks * 100;
        let percent = site.progress * 100 / total;
        assert_eq!(site.complete, percent == 100);
        seen.push(percent);
    }
    seen.sort_unstable();
    seen.dedup();
    assert_eq!(seen, [0, 30, 60, 100]);
}

#[test]
fn ac_19_14_damaged_base() {
    let (world, _, _) = load_example("damaged-base");
    let mut levels = BTreeMap::new();
    for e in world.entities() {
        let max = world.rules().ty(e.kind).hp;
        *levels.entry(e.hp * 100 / max).or_insert(0) += 1;
    }
    let expected: BTreeMap<u32, i32> = [(10, 12), (25, 12), (50, 12), (75, 12), (100, 12)].into();
    assert_eq!(levels, expected, "each of 12 building types at 5 HP levels");
}

#[test]
fn ac_19_14_pathfinding_river() {
    let (mut world, _, mut ais) = load_example("pathfinding-river");
    let ids: Vec<u32> = world
        .entities()
        .iter()
        .filter(|e| e.owner == 0)
        .map(|e| e.id)
        .collect();
    assert_eq!(ids.len(), 10);
    run(&mut world, &mut ais, 1800);
    let target = FxVec2::new(fx_centi(8050), fx_centi(6050));
    let near = ids
        .iter()
        .filter_map(|&id| world.entity(id))
        .filter(|e| (e.pos - target).length() <= fx_centi(300))
        .count();
    assert!(near >= 8, "{near} of 10 units reached the east bank");
}

/// Spec 04 §5.3: the lone tank reaches the far side of the packed idle block
/// and no two tanks ever overlap on the way (the parked ones make way).
#[test]
fn ac_19_14_tank_through_group() {
    let (mut world, _, mut ais) = load_example("tank-through-group");
    let mover = world.entities()[0].id;
    let radius = fx_centi(world.rules().ty(world.entities()[0].kind).radius_centi);
    let mut closest = fx_centi(10_000);
    for _ in 0..900 {
        step_with_ai(&mut world, &mut ais);
        let units = world.entities();
        for (i, a) in units.iter().enumerate() {
            for b in &units[i + 1..] {
                closest = closest.min((a.pos - b.pos).length());
            }
        }
    }
    let target = FxVec2::new(fx_centi(4450), fx_centi(1550));
    let end = world.entity(mover).unwrap().pos;
    assert!(
        (end - target).length() <= fx_centi(50),
        "tank ended at {end:?}"
    );
    assert!(
        closest >= radius + radius - fx_centi(2),
        "two tanks came within {closest:?} of each other"
    );
}

#[test]
fn ac_19_14_crowd() {
    let (world, _, _) = load_example("crowd");
    assert_eq!(count(&world, 0, Category::Unit), 60);
    assert_eq!(count(&world, 1, Category::Unit), 60);
    assert!(deaths("crowd", 900) > 0);
}

#[test]
fn ac_19_14_gore() {
    assert!(deaths("gore", 900) >= 5);
}

#[test]
fn ac_19_14_victory_near() {
    let (mut world, _, mut ais) = load_example("victory-near");
    for _ in 0..900 {
        step_with_ai(&mut world, &mut ais);
        if world.outcome() != Outcome::Ongoing {
            break;
        }
    }
    assert_eq!(world.outcome(), Outcome::Winner(0));
}

#[test]
fn ac_19_14_ai_attack() {
    let (mut world, _, mut ais) = load_example("ai-attack");
    assert_eq!(ais.len(), 1);
    let hq = kind(&world, "ua-hq");
    let base = world
        .entities()
        .iter()
        .find(|e| e.owner == 0 && e.kind == hq)
        .expect("Ukrainian HQ")
        .pos;
    let mut reached = false;
    for _ in 0..6000 {
        step_with_ai(&mut world, &mut ais);
        reached = world
            .entities()
            .iter()
            .any(|e| e.owner == 1 && e.site.is_none() && (e.pos - base).length() <= fx_centi(2000));
        if reached {
            break;
        }
    }
    assert!(
        reached,
        "a Russian unit within 20 tiles of the Ukrainian HQ"
    );
}

#[test]
fn ac_19_14_weapon_impacts() {
    // Spec 27: every armed unit force-fires at the ground within 300 ticks.
    let (mut world, _, mut ais) = load_example("weapon-impacts");
    let shooters = world
        .entities()
        .iter()
        .filter(|e| world.rules().ty(e.kind).category == Category::Unit)
        .count();
    assert_eq!(shooters, 7);
    let mut weapons = std::collections::BTreeSet::new();
    for _ in 0..300 {
        step_with_ai(&mut world, &mut ais);
        for projectile in world.projectiles() {
            weapons.insert(projectile.weapon);
        }
    }
    assert_eq!(weapons.len(), 7, "every weapon fired: {weapons:?}");
}

#[test]
fn ac_19_04_examples_round_trip() {
    for id in example_ids() {
        let (mut world, seed, mut ais) = load_example(&id);
        run(&mut world, &mut ais, 300);
        let first = serde_json::to_string(&save_state(&world, seed, &ais).unwrap()).unwrap();
        let state = serde_json::from_str(&first).unwrap();
        let (loaded, seed, loaded_ais) = sim::save::load_state(&state).unwrap();
        let second =
            serde_json::to_string(&save_state(&loaded, seed, &loaded_ais).unwrap()).unwrap();
        assert_eq!(first, second, "{id} round trip");
    }
}

#[test]
fn ac_19_05_examples_continuity() {
    for id in ["armor-duel", "artillery-range"] {
        let (mut world, seed, mut ais) = load_example(id);
        run(&mut world, &mut ais, 150);
        let state = save_state(&world, seed, &ais).unwrap();
        let (mut loaded, _, mut loaded_ais) = sim::save::load_state(&state).unwrap();
        let shots = BTreeMap::new();
        for step in 1..=900 {
            step_with_ai(&mut world, &mut ais);
            step_with_ai(&mut loaded, &mut loaded_ais);
            if step % 100 == 0 {
                assert_eq!(
                    state_hash(&loaded),
                    state_hash(&world),
                    "{id} hash at +{step}"
                );
                for viewer in [0, 1, OBSERVER] {
                    assert_eq!(
                        encode_match_snapshot_with_shots(&loaded, viewer, &shots),
                        encode_match_snapshot_with_shots(&world, viewer, &shots),
                        "{id} snapshot for {viewer} at +{step}"
                    );
                }
                assert_eq!(encode_fog(&loaded, 0), encode_fog(&world, 0));
            }
        }
    }
}

#[test]
fn ordered_armor_does_not_pile_up_at_the_goal() {
    // The owner's check: select every own vehicle and send them all to one point.
    use sim::fixed::{Fx, FxVec2};
    let (mut world, _, mut ais) = load_example("armor-duel");
    let units: Vec<u32> = world
        .entities()
        .iter()
        .filter(|e| e.owner == 0)
        .map(|e| e.id)
        .collect();
    let target = FxVec2::new(Fx::from_raw(40 * 65536), Fx::from_raw(20 * 65536));
    world.enqueue(sim::world::Command::Move { units, target });
    run(&mut world, &mut ais, 1200);
    let own: Vec<_> = world.entities().iter().filter(|e| e.owner == 0).collect();
    for (i, a) in own.iter().enumerate() {
        for b in &own[i + 1..] {
            let d = (a.pos - b.pos).length().raw();
            assert!(
                d >= 65536 * 7 / 10,
                "vehicles {} and {} overlap",
                a.id,
                b.id
            );
        }
    }
}
