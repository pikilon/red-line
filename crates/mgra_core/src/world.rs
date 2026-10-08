use crate::command::PlayerAction;
use crate::types::{EntityId, FactionId, Vec2D};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct UnitState {
    pub id: EntityId,
    pub faction: FactionId,
    pub position: Vec2D,
    pub target_position: Option<Vec2D>,
    pub health: u32,
    pub max_health: u32,
    pub speed: f32,
}

#[derive(Debug, Clone)]
pub struct GameWorld {
    pub tick: u64,
    pub units: HashMap<EntityId, UnitState>,
    pub next_entity_id: u32,
}

impl GameWorld {
    pub fn new() -> Self {
        Self {
            tick: 0,
            units: HashMap::new(),
            next_entity_id: 1,
        }
    }

    pub fn spawn_unit(
        &mut self,
        faction: FactionId,
        position: Vec2D,
        health: u32,
        speed: f32,
    ) -> EntityId {
        let id = EntityId(self.next_entity_id);
        self.next_entity_id += 1;
        self.units.insert(
            id,
            UnitState {
                id,
                faction,
                position,
                target_position: None,
                health,
                max_health: health,
                speed,
            },
        );
        id
    }

    /// Step simulation deterministically by 1 tick (standard RTS tick: 30 Hz -> 1/30s = ~0.0333s)
    pub fn step(&mut self, actions: &[PlayerAction]) {
        self.tick += 1;

        // 1. Process Actions
        for action in actions {
            match &action.command {
                crate::command::Command::Move { entity_ids, target } => {
                    for eid in entity_ids {
                        if let Some(unit) = self.units.get_mut(eid) {
                            if unit.faction == action.faction {
                                unit.target_position = Some(target.clone());
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // 2. Update movement
        let dt = 1.0 / 30.0;
        for unit in self.units.values_mut() {
            if let Some(target) = &unit.target_position {
                let dx = target.x - unit.position.x;
                let dy = target.y - unit.position.y;
                let dist_sq = dx * dx + dy * dy;

                if dist_sq < 0.001 {
                    unit.position = target.clone();
                    unit.target_position = None;
                } else {
                    let dist = dist_sq.sqrt();
                    let step = unit.speed * dt;
                    if step >= dist {
                        unit.position = target.clone();
                        unit.target_position = None;
                    } else {
                        unit.position.x += (dx / dist) * step;
                        unit.position.y += (dy / dist) * step;
                    }
                }
            }
        }
    }
}
