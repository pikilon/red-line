//! Spec 57: capturable neutral tech buildings (Zero Hour `KINDOF_CAPTURABLE`
//! `TECH_BUILDING`). Infantry walk beside one and work on it for
//! `captureTicks`; it then belongs to their player until another player
//! captures it. An owned building pays periodic credits (`AutoDepositUpdate`)
//! and heals the owner's infantry around it (`AutoHealBehavior`). A neutral
//! one does nothing. The owner is stored on the feature row, so it is hashed
//! and saved with the rest of the world.

use crate::entity::{EntityId, NEUTRAL, Order, PlayerId};
use crate::features::footprint;
use crate::fixed::Fx;
use crate::map::Cell;
use crate::nav::footprint_distance;
use crate::rules::{TechDef, fx_centi};
use crate::world::World;

/// How close (centi-tiles from the footprint edge) a capturer must be to work.
const CAPTURE_RANGE_CENTI: u32 = 150;

impl World {
    /// Tech data of feature `index` while it stands.
    pub fn tech_def(&self, index: u32) -> Option<TechDef> {
        let row = self.features.get(index as usize)?;
        if !row.alive {
            return None;
        }
        self.rules.feature_types[row.kind as usize].tech
    }

    /// Player that owns tech feature `index`, `NEUTRAL` for anything else.
    pub fn tech_owner(&self, index: u32) -> PlayerId {
        match self.tech_def(index) {
            Some(_) => self.features[index as usize].owner,
            None => NEUTRAL,
        }
    }

    /// True when `unit` is free infantry of a player that does not own the
    /// tech building `feature` yet.
    pub fn can_capture(&self, unit: EntityId, feature: u32) -> bool {
        let Some(entity) = self.entity(unit) else {
            return false;
        };
        self.can_ride(unit)
            && self.tech_def(feature).is_some()
            && self.tech_owner(feature) != entity.owner
    }

    /// `Capture` command: every listed unit of `player` that can walks to the
    /// building and works on it.
    pub(crate) fn apply_capture(&mut self, player: PlayerId, units: &[EntityId], feature: u32) {
        let order_id = self.next_order_id;
        self.next_order_id += 1;
        for &id in units {
            let Some(index) = self.index_of(id) else {
                continue;
            };
            if self.entities[index].owner == player && self.can_capture(id, feature) {
                self.entities[index].order = Order::Capture {
                    order_id,
                    feature,
                    progress: 0,
                };
            }
        }
    }

    /// `Capture` order step: walk beside the building, then count up; at
    /// `captureTicks` the building changes hands.
    pub(crate) fn step_capture(
        &mut self,
        index: usize,
        order_id: u32,
        feature: u32,
        progress: u32,
    ) {
        let id = self.entities[index].id;
        let idle = Order::Idle {
            last_order_id: order_id,
        };
        let Some(def) = self.tech_def(feature) else {
            self.entities[index].order = idle;
            return;
        };
        if !self.can_capture(id, feature) {
            self.entities[index].order = idle;
            return;
        }
        let row = self.features[feature as usize];
        let (w, h) = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
        let origin = Cell { x: row.x, y: row.y };
        let pos = self.entities[index].pos;
        if footprint_distance(pos, origin, [w as u16, h as u16]) > fx_centi(CAPTURE_RANGE_CENTI) {
            if let Some(goal) = self.garrison_goal(pos, feature) {
                self.step_toward_goal(index, goal);
            }
            return;
        }
        self.entities[index].speed = Fx::ZERO;
        let progress = progress + 1;
        if progress < def.capture_ticks.max(1) {
            self.entities[index].order = Order::Capture {
                order_id,
                feature,
                progress,
            };
            return;
        }
        let owner = self.entities[index].owner;
        self.features[feature as usize].owner = owner;
        if let Some(income) = def.income
            && let Some(player) = self.players.get_mut(usize::from(owner))
        {
            player.credits = player.credits.saturating_add(income.capture_bonus);
        }
        self.entities[index].order = idle;
    }

    /// Every tick: owned tech buildings pay their income and heal the owner's
    /// infantry around them. Ascending feature index, then entity order.
    pub(crate) fn tech_buildings(&mut self) {
        let tick = self.tick;
        for feature in 0..self.features.len() as u32 {
            let Some(def) = self.tech_def(feature) else {
                continue;
            };
            let owner = self.features[feature as usize].owner;
            if owner == NEUTRAL {
                continue;
            }
            if let Some(income) = def.income
                && income.every_ticks > 0
                && tick > 0
                && tick.is_multiple_of(income.every_ticks)
                && let Some(player) = self.players.get_mut(usize::from(owner))
            {
                player.credits = player.credits.saturating_add(income.amount);
            }
            let Some(heal) = def.heal else {
                continue;
            };
            if heal.every_ticks == 0 || tick == 0 || !tick.is_multiple_of(heal.every_ticks) {
                continue;
            }
            let row = self.features[feature as usize];
            let (w, h) = footprint(&self.rules.feature_types[row.kind as usize], row.rot);
            let origin = Cell { x: row.x, y: row.y };
            let reach = fx_centi(heal.radius_centi);
            for at in 0..self.entities.len() {
                let entity = &self.entities[at];
                if entity.owner != owner
                    || entity.hp == 0
                    || !self.can_ride(entity.id)
                    || footprint_distance(entity.pos, origin, [w as u16, h as u16]) > reach
                {
                    continue;
                }
                let max = self.max_hp_at(at);
                let entity = &mut self.entities[at];
                entity.hp = entity
                    .hp
                    .saturating_add(heal.amount)
                    .min(max)
                    .max(entity.hp);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixed::FxVec2;
    use crate::hash::state_hash;
    use crate::rules::{Ruleset, TechHeal, TechIncome};
    use crate::save::{load_state, save_state};
    use crate::world::Command;

    const HOUSE: Cell = Cell { x: 19, y: 24 };

    /// `demo-town` whose small houses are tech buildings with both an income
    /// and a heal aura.
    fn world() -> (World, u32) {
        let mut rules = Ruleset::builtin();
        for ty in &mut rules.feature_types {
            if ty.id == "house-small" {
                ty.tech = Some(TechDef {
                    capture_ticks: 30,
                    income: Some(TechIncome {
                        amount: 100,
                        every_ticks: 60,
                        capture_bonus: 500,
                    }),
                    heal: Some(TechHeal {
                        radius_centi: 600,
                        amount: 5,
                        every_ticks: 15,
                    }),
                });
            }
        }
        let mut world = World::skirmish_with(rules, "demo-town", false).unwrap();
        world.victory_enabled = false;
        let feature = world.feature_at(HOUSE).expect("house");
        (world, feature)
    }

    fn at(x: u32, y: u32) -> FxVec2 {
        FxVec2::new(fx_centi(x), fx_centi(y))
    }

    fn rifleman(world: &mut World, owner: PlayerId, x: u32, y: u32) -> EntityId {
        let kind = world.rules.type_index("ua-rifleman").unwrap();
        world.spawn(owner, kind, at(x, y))
    }

    fn run(world: &mut World, ticks: u32) {
        for _ in 0..ticks {
            world.step();
        }
    }

    fn capture(world: &mut World, player: PlayerId, unit: EntityId, feature: u32) {
        world.enqueue_as(
            player,
            Command::Capture {
                units: vec![unit],
                feature,
            },
        );
    }

    #[test]
    fn ac_57_01_infantry_capture_a_neutral_building_and_get_the_bonus() {
        let (mut world, feature) = world();
        assert_eq!(world.tech_owner(feature), NEUTRAL);
        let unit = rifleman(&mut world, 0, 1900, 2700);
        let before = world.player(0).unwrap().credits;
        capture(&mut world, 0, unit, feature);
        run(&mut world, 10);
        assert_eq!(world.tech_owner(feature), NEUTRAL, "capture takes time");
        run(&mut world, 120);
        assert_eq!(world.tech_owner(feature), 0);
        assert!(world.player(0).unwrap().credits >= before + 500);
        assert!(matches!(
            world.entity(unit).unwrap().order,
            Order::Idle { .. }
        ));
    }

    #[test]
    fn ac_57_02_an_owned_building_pays_and_a_neutral_one_does_not() {
        let (mut world, feature) = world();
        run(&mut world, 120);
        let neutral = world.player(0).unwrap().credits;
        let unit = rifleman(&mut world, 0, 1900, 2700);
        capture(&mut world, 0, unit, feature);
        run(&mut world, 150);
        let owned = world.player(0).unwrap().credits;
        run(&mut world, 120);
        assert_eq!(world.player(0).unwrap().credits, owned + 200);
        assert!(owned >= neutral + 500);
    }

    #[test]
    fn ac_57_03_an_owned_building_heals_the_owners_infantry_only() {
        let (mut world, feature) = world();
        let unit = rifleman(&mut world, 0, 1900, 2700);
        capture(&mut world, 0, unit, feature);
        run(&mut world, 100);
        let mine = rifleman(&mut world, 0, 2100, 2800);
        let foe = rifleman(&mut world, 1, 2100, 2850);
        let far = rifleman(&mut world, 0, 4500, 500);
        for id in [mine, foe, far] {
            let at = world.index_of(id).unwrap();
            world.entities[at].hp = 10;
        }
        // Shots between the two sides may kill the foe; it never gets healed.
        run(&mut world, 30);
        assert!(world.entity(mine).unwrap().hp >= 20);
        assert!(world.entity(foe).is_none_or(|entity| entity.hp <= 10));
        assert_eq!(world.entity(far).unwrap().hp, 10);
    }

    #[test]
    fn ac_57_04_an_enemy_recaptures_the_building() {
        let (mut world, feature) = world();
        let first = rifleman(&mut world, 0, 1900, 2700);
        capture(&mut world, 0, first, feature);
        run(&mut world, 150);
        assert_eq!(world.tech_owner(feature), 0);
        // The owner's own infantry have nothing to capture.
        assert!(!world.can_capture(first, feature));
        let foe = rifleman(&mut world, 1, 1900, 2750);
        capture(&mut world, 1, foe, feature);
        run(&mut world, 150);
        assert_eq!(world.tech_owner(feature), 1);
    }

    #[test]
    fn ac_57_05_only_the_owner_of_the_unit_can_order_the_capture() {
        let (mut world, feature) = world();
        let unit = rifleman(&mut world, 0, 1900, 2700);
        assert!(world.can_capture(unit, feature));
        capture(&mut world, 1, unit, feature);
        run(&mut world, 5);
        assert!(matches!(
            world.entity(unit).unwrap().order,
            Order::Idle { .. }
        ));
    }

    #[test]
    fn ac_57_06_the_owner_survives_a_save_and_changes_the_hash() {
        let (mut world, feature) = world();
        let before = state_hash(&world);
        let unit = rifleman(&mut world, 0, 1900, 2700);
        capture(&mut world, 0, unit, feature);
        run(&mut world, 150);
        assert_ne!(before, state_hash(&world));
        let state = save_state(&world, 1, &[]).unwrap();
        let (loaded, _, _) = load_state(&state).unwrap();
        assert_eq!(loaded.features[feature as usize].owner, 0);
        assert_eq!(state_hash(&loaded), state_hash(&world));
    }

    #[test]
    fn ac_57_07_the_ai_sends_infantry_to_capture_and_does_not_double_up() {
        use crate::ai::capture_orders_for_test;
        let (mut world, _) = world();
        // Every small house is a tech building here; the AI picks one.
        let unit = rifleman(&mut world, 1, 2300, 2700);
        let commands = capture_orders_for_test(&world, 1);
        let Some(Command::Capture {
            units,
            feature: near,
        }) = commands.first().cloned()
        else {
            panic!("the AI orders a capture: {commands:?}");
        };
        assert_eq!(units, vec![unit]);
        // Once the unit is on its way, the building gets no second order.
        capture(&mut world, 1, unit, near);
        run(&mut world, 1);
        let again = capture_orders_for_test(&world, 1);
        assert!(again.iter().all(
            |command| !matches!(command, Command::Capture { feature, .. } if *feature == near)
        ));
        // The owner has nothing left to capture there.
        run(&mut world, 200);
        assert_eq!(world.tech_owner(near), 1);
        let after = capture_orders_for_test(&world, 1);
        assert!(after.iter().all(
            |command| !matches!(command, Command::Capture { feature, .. } if *feature == near)
        ));
    }
}
