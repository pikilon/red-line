use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EntityId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FactionId {
    Ukraine,
    Russia,
    USA,
    China,
    EuropeanUnion,
    AsymmetricInsurgency,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnitClass {
    Infantry,
    LightVehicle,
    MainBattleTank,
    Artillery,
    AirDefense,
    ReconDrone,
    KamikazeDrone,
    Aircraft,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Vec2D {
    pub x: f32,
    pub y: f32,
}

impl Vec2D {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
    pub fn distance_squared(&self, other: &Self) -> f32 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        dx * dx + dy * dy
    }
}
