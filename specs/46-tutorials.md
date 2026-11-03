# 46 — Tutorials

## 1. Goal

The main menu offers **Tutorials**: short missions, three per army, that teach
how to build a base and how to build and use each army's infantry and
vehicles.

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

Russia's missions mirror Ukraine's through the map centre.

* *Build / train* steps count the player's finished entities of that type
  (`BUILT_BY_PLAYER`).
* *Destroy every enemy* holds once an enemy has been seen and every enemy seen
  has left the snapshot while its last tile was in sight; one that leaves into
  the fog is still alive.

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
* No voice-over or briefing screen; the hint line plays the role of the
  military captions.
* The mission has no defeat: the player can reload it from the game menu.
