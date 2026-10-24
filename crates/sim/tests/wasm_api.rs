use sim::wasm_api::Sim;

#[test]
fn ac_01_05_api_version_is_one() {
    assert_eq!(sim::api_version(), 4);
}

#[test]
fn ac_02_22_wasm_api_natively() {
    let mut sim = Sim::new(42, 500).unwrap();
    assert_eq!(sim.map_width(), 128);
    assert_eq!(sim.map_height(), 128);
    assert_eq!(sim.map_tiles().len(), 16384);
    assert_eq!(sim.unit_count(), 500);
    assert_eq!(sim.snapshot().len(), 2 + 500 * 4);
    assert_eq!(sim.tick(), 0);
    let hash = sim.state_hash_hex();
    assert_eq!(hash.len(), 16);
    assert!(
        hash.chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    );

    sim.command_move(&[0], 4030464, 1998848);
    sim.step_n(3);
    assert_eq!(sim.tick(), 3);

    let err = Sim::new(1, 2001).err().unwrap();
    assert!(err.contains("too many units"));
}

#[test]
fn ac_03_39_wasm_api_v2_natively() {
    let rules = sim::rules::Ruleset::builtin();
    let power_plant = rules.type_index("ua-power-plant").unwrap();
    let rifleman = rules.type_index("ua-rifleman").unwrap();

    let mut sim = Sim::skirmish(1, "first-line").unwrap();
    assert_eq!(sim.player_count(), 2);
    assert_eq!(sim.unit_count(), 10);
    assert_eq!(sim.map_width(), 128);
    assert_eq!(sim.snapshot_for(0)[1], 0);
    assert_eq!(sim.snapshot_for(0)[2], 5000);
    assert_eq!(sim.fog_for(0).len(), 16384);

    let err = Sim::skirmish(1, "nope").err().unwrap();
    assert!(err.contains("unknown map"));

    sim.command_construct(0, 7, power_plant, 18, 64);
    sim.step();
    assert_eq!(sim.snapshot_for(0)[2], 4400);

    let before = sim.unit_count();
    sim.debug_spawn(0, rifleman, 24 * 65536, 64 * 65536);
    sim.step();
    assert_eq!(sim.unit_count(), before);

    sim.enable_debug_commands();
    sim.debug_spawn(0, rifleman, 24 * 65536, 64 * 65536);
    sim.step();
    assert_eq!(sim.unit_count(), before + 1);

    sim.debug_set_hp(8, 0);
    sim.step();
    assert_eq!(sim.snapshot_for(0)[5], 1);
    assert_eq!(sim.snapshot_for(0)[6], 0);
}

#[test]
fn ac_05_20_wasm_api_v3() {
    assert_eq!(sim::api_version(), 4);

    let mut sim = Sim::skirmish(1, "first-line").unwrap();
    assert!(sim.attach_ai(1, "russia-balanced").is_ok());
    assert!(sim.attach_ai(1, "ukraine-balanced").is_err());

    sim.step_n(900);

    let rules = sim::rules::Ruleset::builtin();
    let buildings: Vec<i32> = rules
        .types
        .iter()
        .enumerate()
        .filter(|(_, ty)| ty.category == sim::rules::Category::Building)
        .map(|(index, _)| index as i32)
        .collect();
    const MATCH_HEADER_LEN: usize = 8;
    const ENTITY_STRIDE: usize = 11;
    let data = sim.snapshot_for(255);
    let count = data[7] as usize;
    let owned = (0..count)
        .filter(|&row| {
            let base = MATCH_HEADER_LEN + row * ENTITY_STRIDE;
            data[base + 1] == 1 && buildings.contains(&data[base + 2])
        })
        .count();
    assert!(owned > 1, "player 1 owns {owned} buildings");
}

/// Ids of the entities carrying `FLAG_FIRED` in a match snapshot.
fn fired_ids(snapshot: &[i32]) -> Vec<i32> {
    use sim::snapshot::{ENTITY_STRIDE, FLAG_FIRED, MATCH_HEADER_LEN};
    let count = snapshot[MATCH_HEADER_LEN - 1] as usize;
    (0..count)
        .map(|i| &snapshot[MATCH_HEADER_LEN + i * ENTITY_STRIDE..][..ENTITY_STRIDE])
        .filter(|row| row[6] & FLAG_FIRED != 0)
        .map(|row| row[0])
        .collect()
}

/// Two adjacent enemy riflemen in the first-line skirmish.
fn duel() -> Sim {
    let mut sim = Sim::skirmish(1, "first-line").unwrap();
    sim.enable_debug_commands();
    let ua = sim::rules::Ruleset::builtin()
        .type_index("ua-rifleman")
        .unwrap();
    let ru = sim::rules::Ruleset::builtin()
        .type_index("ru-rifleman")
        .unwrap();
    sim.debug_spawn(0, ua, 20 * 65536 + 32768, 62 * 65536 + 32768);
    sim.debug_spawn(1, ru, 23 * 65536 + 32768, 62 * 65536 + 32768);
    sim
}

#[test]
fn shots_survive_multi_step_snapshots() {
    // Find a tick t where someone fires and t + 1 where nobody does.
    let mut probe = duel();
    let mut previous_fired = false;
    let mut shot_tick = None;
    for _ in 0..300 {
        probe.step();
        let fired = !fired_ids(&probe.snapshot_for(0)).is_empty();
        if previous_fired && !fired {
            shot_tick = Some(probe.tick() - 1);
            break;
        }
        previous_fired = fired;
    }
    let shot_tick = shot_tick.expect("the riflemen exchange fire");

    // Step to t - 1, read (and clear) a snapshot, then advance two ticks at
    // once like a slow frame does: the shot at t must still be reported.
    let mut sim = duel();
    sim.step_n(shot_tick - 1);
    let _ = sim.snapshot_for(0);
    sim.step_n(2);
    assert!(!fired_ids(&sim.snapshot_for(0)).is_empty());
    // Reported once: after the snapshot that carried the shot at t, the
    // shot-free tick t + 1 reports nothing.
    let mut once = duel();
    once.step_n(shot_tick);
    assert!(!fired_ids(&once.snapshot_for(0)).is_empty());
    once.step();
    assert!(fired_ids(&once.snapshot_for(0)).is_empty());
}

#[test]
fn ac_14_01_debug_spawn_places_buildings() {
    let rules = sim::rules::Ruleset::builtin();
    let power_plant = rules.type_index("ua-power-plant").unwrap();
    let barracks = rules.type_index("ua-barracks").unwrap();
    let mut sim = Sim::skirmish(1, "first-line").unwrap();
    let before = sim.unit_count();

    // Ignored without debug commands.
    sim.debug_spawn(0, power_plant, 20 * 65536, 40 * 65536);
    sim.step();
    assert_eq!(sim.unit_count(), before);

    sim.enable_debug_commands();
    sim.debug_spawn(0, power_plant, 20 * 65536, 40 * 65536);
    sim.step();
    assert_eq!(sim.unit_count(), before + 1);

    // The footprint is occupied now: the same spot is ignored.
    sim.debug_spawn(0, barracks, 20 * 65536, 40 * 65536);
    sim.step();
    assert_eq!(sim.unit_count(), before + 1);
}
