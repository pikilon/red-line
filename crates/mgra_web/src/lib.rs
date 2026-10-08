use mgra_core::world::GameWorld;

pub struct WebClient {
    pub world: GameWorld,
}

impl WebClient {
    pub fn new() -> Self {
        Self {
            world: GameWorld::new(),
        }
    }
}
