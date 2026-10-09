//! SplitMix64 RNG. Stub: behavior is missing on purpose (RED).

pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub const fn new(seed: u64) -> SplitMix64 {
        SplitMix64 { state: seed }
    }
    pub fn next_u64(&mut self) -> u64 {
        let _ = self.state;
        todo!()
    }
    pub fn next_u32(&mut self) -> u32 {
        todo!()
    }
}
