//! Spec 56 §5.1: the China horde bonus (Zero Hour `HordeUpdate`). A unit with
//! at least `count - 1` allies of its own type within `radius_centi` is in a
//! horde; it stays in one while another horde member is within
//! `rub_off_radius_centi`. Recomputed every tick from the previous flags, in
//! entity order, so it is deterministic.

use crate::entity::Entity;
use crate::rules::fx_centi;
use crate::world::World;

fn within(a: &Entity, b: &Entity, reach: i64) -> bool {
    let dx = i64::from(a.pos.x.raw() - b.pos.x.raw());
    let dy = i64::from(a.pos.y.raw() - b.pos.y.raw());
    dx * dx + dy * dy <= reach * reach
}

impl World {
    pub(crate) fn update_horde(&mut self) {
        let mut flags = Vec::with_capacity(self.entities.len());
        for entity in &self.entities {
            let Some(horde) = self.rules.ty(entity.kind).horde else {
                flags.push(false);
                continue;
            };
            if entity.hp == 0 {
                flags.push(false);
                continue;
            }
            let join = i64::from(fx_centi(horde.radius_centi).raw());
            let stay = i64::from(fx_centi(horde.rub_off_radius_centi).raw());
            let mut near = 0;
            let mut member = false;
            for other in &self.entities {
                if other.id == entity.id
                    || other.owner != entity.owner
                    || other.kind != entity.kind
                    || other.hp == 0
                {
                    continue;
                }
                if within(entity, other, join) {
                    near += 1;
                }
                member |= other.horde && within(entity, other, stay);
            }
            flags.push(near + 1 >= horde.count || (entity.horde && member));
        }
        for (entity, flag) in self.entities.iter_mut().zip(flags) {
            entity.horde = flag;
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::fixed::FxVec2;
    use crate::map::MapGrid;
    use crate::rules::{Ruleset, fx_centi};
    use crate::world::World;

    fn at(x: u32, y: u32) -> FxVec2 {
        FxVec2::new(fx_centi(x), fx_centi(y))
    }

    fn squad(world: &mut World, owner: u8, kind: &str, x: u32, y: u32) -> u32 {
        let kind = world.rules().type_index(kind).unwrap();
        world.spawn(owner, kind, at(x, y))
    }

    fn flag(world: &World, id: u32) -> bool {
        world.entity(id).unwrap().horde
    }

    fn sandbox() -> World {
        World::sandbox(Ruleset::builtin(), MapGrid::open(40, 24), &[0, 1])
    }

    fn five(world: &mut World) -> Vec<u32> {
        (0..5)
            .map(|i| squad(world, 0, "cn-rifle-squad", 1000 + i * 40, 1000))
            .collect()
    }

    #[test]
    fn five_together_form_a_horde_and_one_alone_does_not() {
        let mut world = sandbox();
        let ids = five(&mut world);
        let alone = squad(&mut world, 0, "cn-rifle-squad", 3500, 1000);
        world.update_horde();
        assert!(ids.iter().all(|&id| flag(&world, id)));
        assert!(!flag(&world, alone));
    }

    #[test]
    fn enemies_and_other_types_do_not_count() {
        let mut world = sandbox();
        let ids: Vec<u32> = (0..3)
            .map(|i| squad(&mut world, 0, "cn-rifle-squad", 1000 + i * 40, 1000))
            .collect();
        squad(&mut world, 1, "cn-rifle-squad", 1100, 1040);
        squad(&mut world, 0, "cn-hj-team", 1100, 1080);
        world.update_horde();
        assert!(ids.iter().all(|&id| !flag(&world, id)));
    }

    #[test]
    fn rub_off_keeps_the_bonus_only_near_a_member() {
        let mut world = sandbox();
        let ids = five(&mut world);
        world.update_horde();
        let last = world.index_of(ids[4]).unwrap();
        world.entities[last].pos = at(2500, 1000);
        world.update_horde();
        assert!(!flag(&world, ids[4]), "the straggler loses it");
        assert!(flag(&world, ids[0]), "the rest keep it by rub-off");
    }

    #[test]
    fn a_horde_member_fires_faster_and_nationalism_adds_more() {
        let mut world = sandbox();
        let ids = five(&mut world);
        let kind = world.rules().type_index("cn-rifle-squad").unwrap();
        let weapon = world.rules().weapons[world.rules().ty(kind).weapon as usize].clone();
        let base = weapon.cooldown_ticks;
        assert_eq!(
            world.rank_weapon(ids[0], weapon.clone()).cooldown_ticks,
            base
        );
        world.update_horde();
        assert_eq!(
            world.rank_weapon(ids[0], weapon.clone()).cooldown_ticks,
            base * 100 / 125
        );
        let upgrade = world.rules().type_index("cn-nationalism").unwrap();
        world.grant_upgrade(0, upgrade);
        assert_eq!(
            world.rank_weapon(ids[0], weapon.clone()).cooldown_ticks,
            base * 100 / 140
        );
    }
}
