//! Spec 05 §9: AI difficulty levels (Easy / Medium / Hard / Brutal).

use sim::ai::{AI_THINK_INTERVAL, Ai, step_with_ai};
use sim::hash::state_hash;
use sim::rules::{AiDifficultyDef, Ruleset};
use sim::save::{SimState, load_state, save_state};
use sim::world::{Outcome, World};

const SEED: u64 = 3;

fn skirmish(seed: u64) -> World {
    World::skirmish(Ruleset::builtin(), "first-line", seed).unwrap()
}

/// An AI for `player` at `difficulty`, with its income applied to the world
/// (what match setup and `Sim::set_ai_difficulty` do).
fn ai_at(world: &mut World, player: u8, personality: &str, difficulty: &str, seed: u64) -> Ai {
    let mut ai = Ai::new(world, player, personality, seed).unwrap();
    ai.set_difficulty(world.rules(), difficulty).unwrap();
    world.set_income_percent(player, ai.difficulty().income_percent);
    ai
}

/// Total cost of everything `player` owns plus its credits.
fn worth(world: &World, player: u8) -> u64 {
    let rules = world.rules();
    let owned: u64 = world
        .entities()
        .iter()
        .filter(|entity| entity.owner == player)
        .map(|entity| u64::from(rules.ty(entity.kind).cost))
        .sum();
    owned + u64::from(world.player(player).unwrap().credits)
}

fn count_kind(world: &World, player: u8, id: &str) -> usize {
    let kind = world.rules().type_index(id).unwrap();
    world
        .entities()
        .iter()
        .filter(|entity| entity.owner == player && entity.kind == kind)
        .count()
}

/// `ukraine-balanced` at `difficulty` against a passive player 1 for `ticks`.
fn grow(difficulty: &str, ticks: u32) -> World {
    let mut world = skirmish(SEED);
    let mut ais = [ai_at(&mut world, 0, "ukraine-balanced", difficulty, SEED)];
    while world.tick() < ticks {
        step_with_ai(&mut world, &mut ais);
    }
    world
}

#[test]
fn a_new_ai_plays_medium_and_unknown_levels_are_refused() {
    let world = skirmish(SEED);
    let mut ai = Ai::new(&world, 0, "ukraine-balanced", SEED).unwrap();
    assert_eq!(ai.difficulty().id, "medium");
    let ids: Vec<&str> = world
        .rules()
        .ai_difficulties
        .iter()
        .map(|d| d.id.as_str())
        .collect();
    assert_eq!(ids, ["easy", "medium", "hard", "brutal"]);
    assert_eq!(
        ai.set_difficulty(world.rules(), "nightmare").unwrap_err(),
        "unknown difficulty nightmare"
    );
    assert_eq!(ai.difficulty().id, "medium");
}

#[test]
fn medium_data_matches_the_ai_before_difficulty_levels() {
    let rules = Ruleset::builtin();
    let medium = &rules.ai_difficulties[rules.ai_difficulty_index("medium").unwrap()];
    assert_eq!(*medium, AiDifficultyDef::default());
    assert_eq!(medium.think_ticks, AI_THINK_INTERVAL);
}

#[test]
fn harder_levels_build_a_richer_base() {
    // 4 minutes against a passive opponent, before the first attacks land.
    let ticks = 3600;
    let easy = grow("easy", ticks);
    let medium = grow("medium", ticks);
    let hard = grow("hard", ticks);
    let brutal = grow("brutal", ticks);
    let (we, wm, wb) = (worth(&easy, 0), worth(&medium, 0), worth(&brutal, 0));
    assert!(we < wm, "easy worth {we} must stay below medium {wm}");
    assert!(wm < wb, "brutal worth {wb} must beat medium {wm}");
    let trucks = |world: &World| count_kind(world, 0, "ua-supply-truck");
    assert!(
        trucks(&hard) > trucks(&medium),
        "hard keeps {} trucks, medium {}",
        trucks(&hard),
        trucks(&medium)
    );
}

fn hard_vs_brutal() -> u64 {
    let mut world = skirmish(SEED);
    let mut ais = [
        ai_at(&mut world, 0, "ukraine-balanced", "hard", SEED),
        ai_at(&mut world, 1, "russia-balanced", "brutal", SEED),
    ];
    while world.tick() < 6000 {
        step_with_ai(&mut world, &mut ais);
    }
    state_hash(&world)
}

#[test]
fn difficulty_matches_are_deterministic() {
    assert_eq!(hard_vs_brutal(), hard_vs_brutal());
}

#[test]
fn saves_keep_the_difficulty_and_the_income_bonus() {
    let mut world = skirmish(SEED);
    let mut ais = vec![
        ai_at(&mut world, 0, "ukraine-balanced", "easy", SEED),
        ai_at(&mut world, 1, "russia-balanced", "brutal", SEED),
    ];
    while world.tick() < 900 {
        step_with_ai(&mut world, &mut ais);
    }
    let state = save_state(&world, SEED, &ais).unwrap();
    let json = serde_json::to_string(&state).unwrap();
    let state: SimState = serde_json::from_str(&json).unwrap();
    let (mut loaded, _, mut loaded_ais) = load_state(&state).unwrap();
    assert_eq!(loaded_ais[0].difficulty().id, "easy");
    assert_eq!(loaded_ais[1].difficulty().id, "brutal");
    assert_eq!(loaded.player(0).unwrap().income_percent(), 75);
    assert_eq!(loaded.player(1).unwrap().income_percent(), 125);
    // The loaded match continues exactly as the original.
    while world.tick() < 1800 {
        step_with_ai(&mut world, &mut ais);
        step_with_ai(&mut loaded, &mut loaded_ais);
    }
    assert_eq!(state_hash(&world), state_hash(&loaded));
}

/// Spec 05 §9.4 ladder: each level against the one below on `first-line`, both
/// sides, seeds 1..=6, 30-minute cap. Slow; run by hand when retuning:
/// `cargo test -p sim --release --test ai_difficulty ladder -- --ignored --nocapture`.
#[test]
#[ignore]
fn ladder() {
    for (stronger, weaker) in [("medium", "easy"), ("hard", "medium"), ("brutal", "hard")] {
        let mut line = format!("{stronger} vs {weaker}:");
        for side in [0u8, 1u8] {
            let (mut wins, mut losses) = (0, 0);
            for seed in 1..=6u64 {
                let mut world = skirmish(seed);
                let (a, b) = if side == 0 {
                    (stronger, weaker)
                } else {
                    (weaker, stronger)
                };
                let mut ais = [
                    ai_at(&mut world, 0, "ukraine-balanced", a, seed),
                    ai_at(&mut world, 1, "russia-balanced", b, seed),
                ];
                while world.tick() < 27_000 && world.outcome() == Outcome::Ongoing {
                    step_with_ai(&mut world, &mut ais);
                }
                match world.outcome() {
                    Outcome::Winner(w) if w == side => wins += 1,
                    Outcome::Winner(_) => losses += 1,
                    _ => {}
                }
            }
            line += &format!(" as p{side} {wins}W/{losses}L");
        }
        println!("{line}");
    }
}
