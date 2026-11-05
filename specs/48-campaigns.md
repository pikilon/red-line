# 48 — Campaigns

## 1. Goal

The main menu offers **Campaign**: ten consecutive missions per army, drawn
from the real events of the war since 2022 (owner request 2026-11-04).
Ukraine's aim is to bring down Putin; Russia's is to bring every former Soviet
republic back under Moscow. Each mission starts with the description of a
movie (to be produced later with another tool, like the Command & Conquer
cut-scenes) and a briefing; the last one is followed by an epilogue movie.

## 2. Precedent (generals-precedent note)

* Zero Hour reads campaigns from `Campaign.ini` (`CampaignManager.cpp:254`):
  each mission has `Map`, `NextMission`, `IntroMovie`, `BriefingVoice` and
  `ObjectiveLine0..4` (`CampaignManager.cpp:364-388`); missions form a chain
  through `NextMission` (`:192-217`).
* The load screen plays the mission's `IntroMovie` and shows its objective
  lines (`LoadScreen.cpp:427-428, 484`).
* Victory and defeat come from script actions (`ScriptActions.cpp:232, 256`);
  the score screen then offers *Save and Continue* (next mission), *End
  Campaign* with `FinalVictoryMovie` after the last, or *Retry* the same map
  after a defeat (`ScoreScreen.cpp:811-928`).
* Progress is a saved record of campaign and mission
  (`GameState.cpp:630-647`, `SkirmishBattleHonors.cpp:214`).
* Zero Hour does not lock campaign missions; here they are locked by owner
  request ("they are consecutive, they cannot be played in parallel").

## 3. Missions

A mission is a tutorial mission (spec 46: objectives over an example save)
with a number, a date and place line, a movie description and a briefing. Its
save is `campaign-<ua|ru>-<nn>-<slug>` (spec 19), with `victory: true`, fog of
war, the enemy AI active and the player's first entity at index 0. Goals are
checked in order like spec 46, plus two kinds:

* **survive** (`ticks`): holds once the step has been current for that long,
  like a Zero Hour timer; its line counts down (m:ss).
* **victory**: holds once the sim names the player the winner, that is every
  enemy building is gone (spec 03 victory phase).

Destroy goals name save entities by label; the client resolves labels to
save indices from the generated save, and a test checks each one is an enemy.

| # | Ukraine | Real event | Russia | Real event |
| --- | --- | --- | --- | --- |
| 1 | Hostomel: hold the airfield 4:00, destroy the VDV landing zone, victory | Antonov Airport, 24 Feb 2022 | Hostomel: destroy two posts and the hangar, hold 3:00, victory | same |
| 2 | The Irpin Line: train 2 FPV teams, destroy 4 convoy trucks, victory | Kyiv convoy, Aerorozvidka, Irpin bridge, Feb–Mar 2022 | Snake Island: two guard posts, the border post, victory | "Russian warship…", 24 Feb 2022 |
| 3 | The Flagship: build a missile site, two Pantsirs, the fleet command post, victory | Moskva sunk, 13–14 Apr 2022 | Azovstal: build a TOS-1A, two bunkers, steelworks and command post, victory | Mariupol, Mar–May 2022 |
| 4 | Snake Island: 2 HIMARS, two air-defence systems, victory | Zmiinyi retaken, 30 Jun 2022 | Meat Grinder: 12 riflemen, three strongpoints, the town, victory | Bakhmut, Wagner, Prigozhin, 2022–23 |
| 5 | Kharkiv Lightning: Balakliia, Izium, Kupiansk hubs, victory | Kharkiv counteroffensive, Sep 2022 | The Surovikin Line: hold 5:00, destroy 4 Leopards and 4 Bradleys | Robotyne and the Wagner mutiny, Jun 2023 |
| 6 | Andromeda: three pipeline stations, hold 1:00 | Nord Stream sabotage, 26 Sep 2022 | Glide Bombs: 2 Su-34, Koksokhim, Zenit, victory | Avdiivka, FAB-1500 UMPK, 2023–24 |
| 7 | Into Kursk: three border posts, Sudzha station and garrison, hold 3:00 | Kursk incursion, 6 Aug 2024 | The Pipe: two trenches, Sudzha command post, hold 2:00 | Operation Stream, Mar 2025 |
| 8 | Spiderweb: four parked bombers, two airfields | Operation Spiderweb, 1 Jun 2025 | Oreshnik: 6 Geran-2, two Patriots, Yuzhmash, victory | Oreshnik on Dnipro, Nov 2024; Shahed swarms |
| 9 | The Long Arm: missile site, three refineries, two warehouses, victory | Refinery strikes 2024–25; Wildberries warehouses, Jul–Aug 2026 | Bankova: the Patriot, the presidential office, victory | alternate history |
| 10 | The Bunker: three Pantsirs, Putin's bunker, victory | fiction | Narva: two bridgeheads, coalition HQ, victory | alternate history |

Texts (title, date, movie, briefing, objectives, hints, epilogue) are i18n
keys `campaign.<ua|ru>.<nn>.*` in `client/src/i18n/en.json`.

## 4. Interface and flow

* `#main-menu-campaign` opens `#main-menu-campaigns`: per army its aim and
  its ten missions. Won missions show ✓, the next one is open, later ones are
  disabled with 🔒. After the tenth, an **Epilogue** button appears.
* A mission opens `#campaign-briefing`: army, *Mission N: title*, date and
  place, **Cinematic** (the movie description), **Briefing**, **Objectives**
  and **Start mission** / **Back**. Start opens `?load=<mission id>`.
* In the mission, `#tutorial` lists the objectives (spec 46 §4). When every
  step is done, or the sim names the player the winner, the mission is won:
  progress is recorded and the panel offers **Next mission** (the next
  briefing) or, after the tenth, **Epilogue**; and **Main menu**.
* When the sim names another winner (every player building is gone) the panel
  says **Mission failed.** with **Retry** (reloads the mission) and **Main
  menu**.
* `?campaign=<mission id>` opens the main menu with that briefing, if the
  mission is open; `?campaign=<ukraine|russia>-ending` opens the epilogue once
  that campaign is won. Any other `?campaign` value shows the main menu.
* Progress (`redline.campaign` in `localStorage`: missions won per army) is
  per browser; it never goes back.

## 5. Assumptions

* Missions reuse the existing maps (first-line, river-port, demo-coast,
  demo-town, demo-bridges, showcase); no map was drawn for the campaign.
* The game has no ships: the cruiser Moskva is played as the Black Sea Fleet
  command post on the shore; Snake Island is the coast of demo-coast.
* Stand-ins for units the game lacks: Su-34 for the Tu-95 and Tu-22M3 of
  Spiderweb, power plants for refineries and pipeline stations, supply centers
  for warehouses and supply hubs, Storm Shadow / Flamingo for the Neptune,
  Geran waves and the Su-34 for the Oreshnik strike.
* Every enemy uses its map start's faction (spec 19): the "coalition" of the
  Russian finale fights with Ukrainian units.
* Ukraine 10 and Russia 9–10 are fiction, and the briefings say so; Nord
  Stream is told as a fictionalised version of the German investigation.
* Difficulty is fixed per mission (credits and AI personality in the save);
  there is no difficulty selector, voice-over or score screen yet.
* Progress lives in the browser like the settings, not in a save slot.
