use sim::rng::SplitMix64;

#[test]
fn ac_02_04_splitmix64_reference_values() {
    let mut rng = SplitMix64::new(0);
    assert_eq!(rng.next_u64(), 0xE220A8397B1DCDAF);
    assert_eq!(rng.next_u64(), 0x6E789E6AA1B965F4);
    assert_eq!(rng.next_u64(), 0x06C45D188009454F);
    assert_eq!(SplitMix64::new(0).next_u32(), 0xE220A839);
}
