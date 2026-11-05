# 46 — Tutorials

## 1. Goal

The main menu offers **Tutorials**: short missions, five per army, that teach
how to build a base, how to build and use each army's infantry and vehicles,
and how its drones and air defenses work (owner request: the asymmetric air
war of spec 43 is the most confusing part).

## 2. Precedent (generals-precedent note)

* Zero Hour reaches its Training campaign from the Single Player menu
  (`MainMenu.cpp:1570`, `setCampaign("TRAINING")`).
* Objectives are text lines (`ObjectiveLine0..4`, `CampaignManager.cpp:371`);
  in-mission text comes from script actions (`ScriptActions.cpp:2547, 3852`).
* Progress is checked by script conditions such as `BUILT_BY_PLAYER`
  (`ScriptConditions.cpp:881`) and named unit destroyed (`:298`); one-shot
  scripts arm the next step (`ScriptEngine.cpp:7007, 7653`).
* `VICTORY` shows the victory screen and the score screen returns to the menu
  (`ScriptActions.cpp:215`, `ScoreScreen.cpp:544`).

## 3. Missions

Each mission is an example save `tutorial-<ua|ru>-<name>` on `first-line`
(spec 19), with no AI, `victory: false`, fog of war on and the camera on the
player's base. Steps are checked in order; a step counts only once the earlier
ones are done and stays done.

| Mission | Start | Steps |
| --- | --- | --- |
| Build a base | HQ, dozer, 3000 credits | power plant, supply center, barracks |
| Infantry | HQ, power plant, barracks, 1000 credits; 3 enemy riflemen 22 tiles away | 3 riflemen, 1 anti-tank infantry (Stugna-P / RPG), destroy every enemy |
| Armor | HQ, power plant, supply center, factory, 2500 credits; an enemy IFV, rifleman and power plant 26 tiles away | 1 scout vehicle, 1 tank, destroy every enemy |
| Drones (Ukraine) | HQ, power plant, barracks, drone workshop, 2000 credits; a T-72 and 2 riflemen | 1 FPV team, 1 Baba Yaga, destroy every enemy |
| Air defense (Ukraine) | HQ, power plant, supply center, factory, 2500 credits; 4 Geran-2 parked far east | 1 Sting nest, 1 Gepard, destroy the wave |
| Drones (Russia) | HQ, power plant, supply center, barracks, Geran site, 1500 credits; a Ukrainian power plant, scout car and rifleman | 1 Molniya crew, 2 Geran-2, destroy every enemy |
| Air defense (Russia) | HQ, power plant, supply center, factory, 2 riflemen, 2500 credits; a Ukrainian drone workshop with 2 Baba Yagas and 2 TW-12.7 far west | 1 Pantsir, 1 Pole-21, destroy the wave |

The first three missions of Russia mirror Ukraine's through the map centre.
Each step of the drone missions has a hint that explains the unit: how it is
guided, what stops it (jammer, small arms, interceptors) and how to use it.

* *Build / train* steps count every entity of that type the player has
  finished, even if it is gone since (`BUILT_BY_PLAYER`): a Geran launched
  before the step still counts.
* *Destroy* steps name save entities and hold once the sim says each is dead,
  regardless of fog, as a Zero Hour script condition knows. The sim answers
  `Sim::alive(ids)`; save entities are numbered in order after the map's
  depots, so the player's HQ (always the first entity) gives the offset.
* *Wave* (air defense missions): once both defenses are built, the tutorial
  orders the wave at the player's power plant, as a mission script orders a
  team, and repeats the order every 450 ticks so a bomber that went home to
  reload comes back; it goes for the HQ once the plant is gone.

## 4. Interface

* `#main-menu-tutorials` opens a page with one group per army and a **Back**
  button; each mission opens `?load=<mission id>`.
* `#tutorial` (top left) shows the mission title, the numbered steps (done
  struck through, the current one bold) and a hint for the current step.
* When every step is done it shows **Mission complete!** with **Next mission**
  (the next one of the same army, if any) and **Main menu**.

## 5. Assumptions

* The step list lives in `client/src/ui/tutorial.ts`, not `data/`: it is
  presentation over example saves and has no balance numbers.
* The step list lives in code because it names save entities by index; a
  test checks every index against the save.
* No voice-over or briefing screen (campaigns add one, spec 48); the hint line plays the role of the
  military captions.
* The mission has no defeat: the player can reload it from the game menu.
