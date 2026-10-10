use sim::wasm_api::Sim;

#[test]
fn ac_01_05_api_version_is_one() {
    assert_eq!(sim::api_version(), 3);
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
    assert_eq!(sim::api_version(), 3);

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
    const ENTITY_STRIDE: usize = 9;
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
