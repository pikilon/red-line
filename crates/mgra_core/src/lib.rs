pub mod types;
pub mod world;
pub mod command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tick(pub u64);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tick_advancement() {
        let t0 = Tick(0);
        let t1 = Tick(t0.0 + 1);
        assert_eq!(t1.0, 1);
    }
}
