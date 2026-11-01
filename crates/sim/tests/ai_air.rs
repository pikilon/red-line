//! Spec 43 §5: the computer opponents really field and use their new arms.
//!
//! Full `first-line` matches, as in AC-05-15. Each test plays seeds one after
//! the other until everything it wants has been seen (a match ends when one side
//! loses its last building, so no single seed is guaranteed to reach every arm).

use sim::ai::{Ai, step_with_ai};
use sim::entity::{EntityId, Order};
use sim::rules::Ruleset;
use sim::world::{CombatEvent, Outcome, World};
use std::collections::{BTreeMap, BTreeSet};

/// Longest a match runs (spec 05 §8).
const MAX_TICKS: u32 = 27_000;

/// What the matches showed, by type id.
#[derive(Default)]
struct Report {
    /// Entities of the type that ever existed.
    built: BTreeMap<String, u32>,
    /// Types with an entity that was airborne at some tick.
    airborne: BTreeSet<String>,
    /// Types with an entity that went off (died by its own warhead).
    detonated: BTreeSet<String>,
    /// Sortie aircraft that emptied the clip, reloaded and flew a second sortie.
    resorties: u32,
}

impl Report {
    fn built(&self, id: &str) -> bool {
        self.built.get(id).is_some_and(|&n| n > 0)
    }

    fn missing(&self, wanted: &[&str]) -> Vec<String> {
        wanted
            .iter()
            .filter(|id| !self.built(id))
            .map(|id| (*id).to_string())
            .collect()
    }
}

/// Where a sortie aircraft stands in its empty, reloaded, flown-again cycle.
#[derive(Clone, Copy, PartialEq)]
enum Cycle {
    Full,
    Empty,
    Reloaded,
}

/// Plays one match of `ai_a` (player 0) against `ai_b` (player 1) and adds
/// what it saw to `report`. No AI ever orders a one-way unit to `Move`.
fn play(report: &mut Report, ai_a: &str, ai_b: &str, seed: u64) {
    let mut world = World::skirmish(Ruleset::builtin(), "first-line", seed).unwrap();
    let mut ais = [
        Ai::new(&world, 0, ai_a, seed).unwrap(),
        Ai::new(&world, 1, ai_b, seed).unwrap(),
    ];
    let mut known: BTreeSet<EntityId> = BTreeSet::new();
    let mut cycles: BTreeMap<EntityId, Cycle> = BTreeMap::new();
    while world.tick() < MAX_TICKS && world.outcome() == Outcome::Ongoing {
        step_with_ai(&mut world, &mut ais);
        for entity in world.entities() {
            let ty = world.rules().ty(entity.kind);
            if known.insert(entity.id) {
                *report.built.entry(ty.id.clone()).or_insert(0) += 1;
            }
            if ty.is_air() && world.is_airborne(entity.id) {
                report.airborne.insert(ty.id.clone());
            }
            if ty.one_way.is_some() && entity.master.is_none() {
                assert!(
                    !matches!(entity.order, Order::Move { .. }),
                    "the AI sent {} on a Move, which never detonates",
                    ty.id
                );
            }
            if let Some(sortie) = ty.sortie {
                let state = cycles.entry(entity.id).or_insert(Cycle::Full);
                *state = match (*state, entity.ammo) {
                    (Cycle::Full, 0) => Cycle::Empty,
                    (Cycle::Empty, ammo) if ammo >= sortie.clip => Cycle::Reloaded,
                    (Cycle::Reloaded, ammo) if ammo < sortie.clip => {
                        report.resorties += 1;
                        Cycle::Full
                    }
                    (state, _) => state,
                };
            }
        }
        for event in world.events() {
            if let CombatEvent::Death {
                victim,
                killer,
                kind,
                ..
            } = event
                && *killer == Some(*victim)
            {
                report.detonated.insert(world.rules().ty(*kind).id.clone());
            }
        }
    }
}

/// Plays seeds from 1 until `done` is satisfied, at most `max` matches.
fn play_until(ai_a: &str, ai_b: &str, max: u64, done: impl Fn(&Report) -> bool) -> Report {
    let mut report = Report::default();
    for seed in 1..=max {
        play(&mut report, ai_a, ai_b, seed);
        if done(&report) {
            break;
        }
    }
    report
}

const RUSSIAN_ARMS: &[&str] = &[
    "ru-geran-site",
    "ru-airfield",
    "ru-geran-2",
    "ru-geran-3",
    "ru-su-34",
    "ru-molniya-crew",
    "ru-molniya",
];
const RUSSIAN_ANSWERS: &[&str] = &["ru-pantsir", "ru-pole-21"];
const UKRAINIAN_ARMS: &[&str] = &[
    "ua-missile-site",
    "ua-drone-workshop",
    "ua-flamingo",
    "ua-storm-shadow",
    "ua-baba-yaga",
    "ua-ratel",
    "ua-tw-12-7",
    "ua-fpv-team",
    "ua-fpv",
];
const UKRAINIAN_ANSWERS: &[&str] = &["ua-sting-nest", "ua-sting", "ua-patriot", "ua-gepard"];

fn all(groups: &[&[&'static str]]) -> Vec<&'static str> {
    groups
        .iter()
        .flat_map(|group| group.iter().copied())
        .collect()
}

#[test]
fn the_balanced_ais_field_every_new_arm_and_its_answers() {
    let wanted = all(&[
        RUSSIAN_ARMS,
        RUSSIAN_ANSWERS,
        UKRAINIAN_ARMS,
        UKRAINIAN_ANSWERS,
    ]);
    let report = play_until("ukraine-balanced", "russia-balanced", 6, |report| {
        report.missing(&wanted).is_empty() && report.resorties > 0
    });

    let missing = report.missing(&wanted);
    assert!(missing.is_empty(), "never built: {missing:?}");

    // The flying arms really go up.
    for flyer in [
        "ru-geran-2",
        "ru-geran-3",
        "ru-su-34",
        "ru-molniya",
        "ua-flamingo",
        "ua-storm-shadow",
        "ua-baba-yaga",
        "ua-fpv",
        "ua-sting",
    ] {
        assert!(
            report.airborne.contains(flyer),
            "{flyer} never went airborne"
        );
    }

    // One-way units reach their targets and go off.
    for one_way in [
        "ru-geran-2",
        "ru-geran-3",
        "ru-molniya",
        "ua-flamingo",
        "ua-storm-shadow",
        "ua-fpv",
        "ua-sting",
    ] {
        assert!(
            report.detonated.contains(one_way),
            "{one_way} never detonated"
        );
    }

    // Sortie aircraft return, reload and are sent again.
    assert!(report.resorties > 0, "no Su-34 flew a second sortie");
}

#[test]
fn the_rush_ais_field_their_new_arms_too() {
    let russian = ["ru-geran-site", "ru-geran-2", "ru-pantsir"];
    let ukrainian = ["ua-fpv-team", "ua-fpv", "ua-sting-nest", "ua-gepard"];
    let report = play_until("ukraine-rush", "russia-rush", 4, |report| {
        report.missing(&russian).is_empty() && report.missing(&ukrainian).is_empty()
    });
    assert_eq!(report.missing(&russian), Vec::<String>::new());
    assert_eq!(report.missing(&ukrainian), Vec::<String>::new());
    assert!(report.airborne.contains("ru-geran-2"));
    assert!(report.detonated.contains("ru-geran-2"), "the waves strike");
    assert!(report.airborne.contains("ua-fpv"), "the FPV team launches");
}
