use sim::wasm_api::Sim;

#[test]
fn ac_01_05_api_version_is_one() {
    assert_eq!(sim::api_version(), 1);
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
