use mgra_core::types::{FactionId, Vec2D};
use mgra_core::world::GameWorld;

pub struct BotHeadlessRunner;

impl BotHeadlessRunner {
    pub fn run_match_ticks(ticks: u64) -> GameWorld {
        let mut world = GameWorld::new();
        world.spawn_unit(FactionId::Ukraine, Vec2D::new(0.0, 0.0), 100, 5.0);
        world.spawn_unit(FactionId::Russia, Vec2D::new(100.0, 100.0), 120, 4.0);

        for _ in 0..ticks {
            world.step(&[]);
        }
        world
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_headless_run() {
        let world = BotHeadlessRunner::run_match_ticks(100);
        assert_eq!(world.tick, 100);
    }
}
