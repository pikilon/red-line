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
  progress is recorded and the score screen (spec 57) offers **Next mission**
  (the next briefing) or, after the tenth, **Epilogue**; and **Main menu**.
* When the sim names another winner (every player building is gone) the score
  screen (spec 57) says **Mission failed.** with **Retry** (reloads the mission) and **Main
  menu**.
* `?campaign=<mission id>` opens the main menu with that briefing, if the
  mission is open; `?campaign=<ukraine|russia>-ending` opens the epilogue once
  that campaign is won. Any other `?campaign` value shows the main menu.
* Progress (`redline.campaign` in `localStorage`: missions won per army) is
  per browser; it never goes back.

## 5. Assumptions

* Missions reuse the existing maps (first-line, river-port, demo-coast,
  demo-town, demo-bridges, showcase); the exceptions are mission 1 of both
  campaigns, which plays on its own map `hostomel` (§6), Ukraine 2, on
  `irpin` (§7), the two Snake Island missions, on `snake-island` (§8),
  Russia 3, on `mariupol` (§9), Russia 4, on `bakhmut` (§10), Russia 5,
  on `surovikin-line` (§11), Russia 6, on `avdiivka` (§12), Russia 7, on `kursk-pipe` (§13), and Russia 8, on `oreshnik` (§14). Own maps for the remaining missions are tracked
  in issue #482.
* The game has no ships: the cruiser Moskva is played as the Black Sea Fleet
  command post on the shore. Snake Island is no longer the coast of
  demo-coast: it has its own map (§8).
* Stand-ins for units the game lacks: Su-34 for the Tu-95 and Tu-22M3 of
  Spiderweb, power plants for refineries and pipeline stations, supply centers
  for warehouses and supply hubs, Storm Shadow / Flamingo for the Neptune,
  Geran waves and the Su-34 for the Oreshnik strike.
* Every enemy uses its map start's faction (spec 19): the "coalition" of the
  Russian finale fights with Ukrainian units.
* Ukraine 10 and Russia 9–10 are fiction, and the briefings say so; Nord
  Stream is told as a fictionalised version of the German investigation.
* The briefing offers Easy, Medium, Hard and Brutal (the skirmish levels,
  spec 05 §9); Medium is the default. The choice sets the difficulty of every
  enemy AI of the mission (the save keeps its credits and personality), applies
  to every mission and is remembered per browser (`redline.campaign.difficulty`).
  There is no voice-over yet; the score screen is spec 57.

  Acceptance: the briefing shows the four levels with the saved one marked;
  picking one marks it and survives a reload; starting the mission loads its
  save with that difficulty on the enemy AI; an unreadable stored value plays
  Medium.
* Progress lives in the browser like the settings, not in a save slot.

## 6. Map `hostomel` (issue #450)

`data/maps/hostomel.yaml`, 128 x 128, same HQ cells as first-line, so both
Hostomel saves keep their bases. It sketches the Antonov Airport (Hostomel,
24 Feb 2022) with existing feature types only:

* A 100-cell concrete runway runs NW to SE, with a parallel asphalt taxiway,
  three connectors and a concrete apron on its north-east side.
* Four hangars (`warehouse-barn`, garrisonable), a control tower
  (`office-tower`), two terminal/maintenance buildings (`factory`), crates,
  lamp posts and a second hangar pair at the SE end of the taxiway.
* The town of Hostomel fills the south-east: main street with houses,
  townhouses, shops, a church and apartment blocks, joined to the runway end
  by an airport road; pine woods north and south-west, birch/oak/poplar
  groves around.
* Campaign wiring: Ukraine 1 is unchanged (hold the airfield, destroy the
  landing zone, which sits on the open ground between the base and the
  runway). In Russia 1 the two Ukrainian "towers" and the "hangar" targets now
  stand on the apron and hangar yard, so "destroy the airport" means the
  airfield itself.
* Assumptions: neutral capturable buildings do not exist, so hangars and the
  terminal are plain garrisonable map features, not objectives; the runway is
  a ground patch (no aircraft takeoff mechanics).

## 7. Map `irpin` (issue #482)

`data/maps/irpin.yaml`, 64 x 48 (same size and HQ cells as demo-bridges, so
the Ukraine 2 save keeps its bases, convoy and units). Existing feature types
only:

* A river runs north to south with a bend (shallow banks, deep channel). The
  Romanivka road bridge is destroyed: no bridge feature, only rubble piles and
  wrecked cars at both ends of the road. One wooden bridge in the north is the
  only ground crossing; the FPV teams fly over the river.
* Irpin (west bank): apartment blocks, houses, a shop and a townhouse row along
  a main street around the Ukrainian base.
* Bucha side (east bank): the Giraffe shopping centre (`factory` + `warehouse`
  on a concrete car park), a petrol station, apartment blocks and houses along
  the convoy road (y = 30), where the four supply trucks stand.
* Pine, birch and fir stands along the river and map edges.
* Assumption: the destroyed bridge is rubble, not a destructible-bridge state;
  no mission script exists for this mission, so none needed re-pointing.

## 8. Map `snake-island` (issue #482)

`data/maps/snake-island.yaml`, 64 x 64, same HQ cells and start positions as
demo-coast, so `campaign-ru-02-snake-island` and `campaign-ua-04-snake-island`
keep every entity cell and only change `map:`:

* A flat island (land x 1..62, y 20..44) of bare dirt with a grass patch in
  the middle, sand beaches north and south and rounded corners; deep sea north
  and south, shallow sea fringe around it.
* The lighthouse stands on the north shore with a pier running out into the
  sea beside a fishing boat and buoys; in the middle, on a concrete yard, the
  old radar post (`factory`), two barns, houses and a shop as garrison
  buildings, with lamp posts, crates, a wall and scattered bushes and dead
  trees.
* Campaign wiring: unchanged. Russia 2 destroys the two Ukrainian guard
  posts and the HQ at the west end; Ukraine 4 builds 2 HIMARS and destroys the
  two Pantsir at the east end.
* Assumptions: the island is scaled up from the real 0.17 km2 so two bases and
  a field of fire fit; the game still has no ships or landing craft, so no
  mission needs the sea to be crossed. These two missions have no mission
  script, so no areas needed moving.

## 9. Map `mariupol` (issue #482)

`data/maps/mariupol.yaml`, 64 x 56 (same size and HQ cells as demo-town, so the
Russia 3 save keeps its bases and units). Existing feature types only:

* The Sea of Azov (deep sea, shallow fringe, a short pier) fills the south; the
  Kalmius river runs north to south down the middle into it, crossed by one road
  bridge on y = 30.
* West of the river, Azovstal (Ukrainian side): large `factory` and `warehouse`
  halls on concrete yards and a dirt apron towards the shore, crates, walls and
  dead trees.
* East of the river, the city (Russian side): rows of apartment blocks,
  townhouses, houses and shops along asphalt streets, and the drama theatre
  square, an open concrete plaza with one large building (`office-tower`) and
  some rubble and a parked car.
* Assumptions: the theatre is a garrisonable tower, not a special objective;
  the save has no mission script, so none was re-pointed.

## 10. Map `bakhmut` (issue #482)

`data/maps/bakhmut.yaml`, 128 x 128, same HQ cells and starts as first-line, so
`campaign-ru-04-bakhmut` keeps every entity cell and only changes `map:`.
Existing feature types only:

* The Bakhmutka river runs north to south through the middle (shallow banks,
  deep channel) with a road bridge on the main street and two wooden bridges
  north and south.
* West bank: the old town centre, apartment blocks round the Mig-17 monument
  square (an open concrete plaza), townhouses, shops, a petrol station,
  rubble and wrecked cars; the Ukrainian strongpoints and the "Artemivsk"
  barracks stand in it. A smaller suburb on the east bank.
* North: the AZOM works (factory and warehouse halls on a concrete yard) and
  the winery / salt-mine halls.
* East, the Russian approach: mud and dirt fields pocked with rubble piles
  and burnt stumps, breastwork lines of walls and hedges, poplar, oak and
  pine tree belts.
* Assumptions: trenches are dug in match (spec 35), no map places them, so
  breastworks stand in for trench lines. No mission script exists for this
  mission.

## 11. Map `surovikin-line` (issue #482)

`data/maps/surovikin-line.yaml`, 128 x 128 (same size and HQ cells as
first-line, so the Russia 5 save keeps its bases and units). Existing feature
types only:

* Open steppe: ploughed wheat (dirt) and dry sunflower (sand) fields cut by
  poplar and oak windbreaks (tree belts).
* The Russian layered defence runs north to south across the middle: sand
  strips as minefield stand-ins, an anti-tank ditch (a dirt strip with
  `rubble-pile` spoil), two staggered rows of dragon's teeth (`stone-wall`),
  then container and crate strongpoints. The Melitopol road crosses every
  layer on y = 64 through a gap in the walls.
* Robotyne stands in front of the line: houses, shops, farmhouses and a
  church on gravel yards on both sides of the road, with a little rubble.
* Assumptions: mines and the ditch are not real mechanics (the ditch is
  decoration, walkable), and the village is plain garrisonable scenery.

## 12. Map `avdiivka` (issue #482)

`data/maps/avdiivka.yaml`, 128 x 128, same HQ cells and starts as first-line,
so `campaign-ru-06-avdiivka` keeps every entity cell and only changes `map:`.
Existing feature types only:

* North: the Koksokhim coke plant, two rows of factory and warehouse halls on
  a concrete yard, rail sidings as concrete strips, office towers standing in
  for the chimneys, a perimeter wall.
* East of the plant: ash heaps and spoil tips as hills and a ridge.
* West and south: the Khimik district (apartment blocks, townhouses, a petrol
  station) along a main street; the "Tsarskaya Okhota" restaurant strongpoint
  (shop, fences, wall, crates on a concrete forecourt) next to the Zenit
  position.
* East and south, the Russian approach: dirt fields with hedgerows, poplar,
  oak and pine belts, farmhouses, rubble and burnt stumps.
* Assumptions: no tall chimney feature exists, so office towers stand in. No
  mission script exists for this mission.

## 13. Map `kursk-pipe` (issue #482)

`data/maps/kursk-pipe.yaml`, 128 x 128 (same size and HQ cells as first-line,
so the Russia 7 save keeps its bases and units). Existing feature types only:

* Late-winter fields: frozen mud (dirt) with grass, rock and sand patches,
  thin birch, poplar, oak and pine belts and a few dead trees and stumps.
* The pipeline is a long sand strip on y = 64 (spoil on both sides) ending in
  a concrete exit pit, ringed by crate and container stacks (the exit points)
  on the Ukrainian side.
* Sudzha stands in the middle on gravel yards: church, shops, houses and
  apartment blocks along the border road and a north-south street, with a
  little rubble. The gas metering station (factory and warehouse halls,
  containers, fence) stands north-east on a concrete yard.
* Assumptions: the pipe is not a real mechanic (the strip is walkable
  decoration); the exits and the station are plain scenery. No mission script
  exists for this mission.

## 14. Map `oreshnik` (issue #482)

`data/maps/oreshnik.yaml`, 128 x 128, same HQ cells and starts as first-line,
so `campaign-ru-08-oreshnik` keeps every entity cell and only changes `map:`.
Existing feature types only:

* North edge: the wide Dnipro (shallow banks, deep channel) crossed by one
  long `road-bridge` at x=62; the bridge avenue runs south from it.
* North-west: the Pivdenmash (Yuzhmash) plant, two rows of factory and
  warehouse halls on a concrete yard, rail sidings as concrete strips, office
  towers, container stacks, a perimeter wall with a gate gap.
* Air-defence positions (stone-wall pockets with crates) around the plant,
  near the Patriot sites of the save.
* Centre and east of the avenue: downtown Dnipro, apartment blocks and office
  towers; houses and townhouse rows south; tree belts and farmhouses on the
  southern approach.
* Assumptions: the Oreshnik strike stays a stand-in (Geran-2 swarm); the save
  does not add `ru-oreshnik-launcher` (spec 64) because it would make the
  Yuzhmash goal trivial. No mission script exists for this mission.
