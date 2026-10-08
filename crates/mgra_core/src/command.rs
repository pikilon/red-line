use crate::types::{EntityId, FactionId, Vec2D};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Command {
    Move {
        entity_ids: Vec<EntityId>,
        target: Vec2D,
    },
    Attack {
        attacker_ids: Vec<EntityId>,
        target_id: EntityId,
    },
    BuildUnit {
        factory_id: EntityId,
        unit_type_id: String,
    },
    DeployDrone {
        operator_id: EntityId,
        target: Vec2D,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerAction {
    pub faction: FactionId,
    pub command: Command,
}
