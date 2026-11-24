# 54 — New army: USA

Status: in progress (issue #485). Built with the faction assembly line
(`.agents/workflows/faction-assembly.md`). Depends on `50-veterancy.md`,
`52-upgrades.md`, the skirmish faction choice (both armies selectable) and the
faction-agnostic tooling. Decisions: D-03 (no real people, no official logos
of designated organisations), D-04 (every faction has a unique unit or
ability; balance verified by tournaments), D-05 (numbers in `data/`), D-11
(paid APIs need the owner's confirmation).

## 1. Goal

The player can pick the USA in a skirmish and play a full game with it: build
a base, harvest, produce infantry and vehicles, defend with an artillery fire
base, and win against Ukraine or Russia. The USA is the expensive, high-quality
army: fewer units, each tougher and better equipped, with protection systems
that blunt the enemy's anti-tank weapons.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`. The shipped INI
(`INIZH.big`) is not on this machine, so the note answered from memory and no
numbers are copied; ours are set relative to the existing Ukraine and Russia
data and tuned by tournaments (§7).

* Vanilla USA core: Command Center, Cold Fusion Reactor, Supply Center with
  Chinooks, Barracks, War Factory, Patriot battery, Dozer; Ranger (rifle,
  flash-bang), Missile Defender (laser lock), Humvee (transport for 5, TOW),
  Crusader and Paladin tanks (the Paladin's point-defence laser shoots down
  missiles), Tomahawk long-range launcher, Ambulance, Avenger.
* Identity: expensive and high quality; power comes from upgrades and
  attachments (drones, point defence), against China's mass and the GLA's
  cheap swarms.

## 3. Roster (first 14 types + 2 upgrades)

Real-world equivalents replace the Zero Hour names; no design is shared with
Ukraine or Russia (Ukraine already fields the Patriot and the Bradley, so the
USA base defence is a fire base and its carrier is the Stryker).

| Id | Role (Zero Hour slot) | Category | Notes |
|---|---|---|---|
| `us-hq` | Command Center | building | builds the dozer |
| `us-power-plant` | Cold Fusion Reactor | building | |
| `us-supply-center` | Supply Center | building | free `us-supply-truck` |
| `us-barracks` | Barracks | building | heals infantry |
| `us-vehicle-factory` | War Factory | building | repairs vehicles |
| `us-firebase` | Fire Base (base defence) | building | 155 mm howitzer, ground only, needs power |
| `us-dozer` | Dozer | unit, tracked | armoured bulldozer |
| `us-supply-truck` | supply (Chinook stand-in) | unit, wheeled | HEMTT truck |
| `us-ranger` | Ranger | unit, foot | rifle; flash-bang (§5.2) |
| `us-javelin-team` | Missile Defender | unit, foot | fire-and-forget top-attack missile |
| `us-humvee` | Humvee | unit, wheeled | heavy MG, carries 5, fire from inside |
| `us-stryker` | Troop carrier | unit, wheeled | fast, carries 8 |
| `us-abrams` | Crusader/Paladin | unit, tracked | 120 mm; active protection (§5.1) |
| `us-paladin` | Tomahawk (long range) | unit, tracked | M109 self-propelled howitzer |
| `us-advanced-optics` | upgrade (barracks) | upgrade | infantry damage +20 % |
| `us-reactive-armor` | upgrade (factory) | upgrade | Humvee, Stryker, Abrams health +20 % |

Assumptions:

* The Chinook supply helicopter is deferred; the HEMTT truck harvests like
  every other faction until air harvesting exists.
* The Ambulance, Avenger, aircraft and drones come in a later slice.
* The Javelin team is two soldiers (gunner and spotter), like the Russian RPG team, so it fills its render box.

## 4. Numbers (starting point, D-05)

Relative to Ukraine: about 20-25 % more expensive and tougher per unit.

| Id | HP | Cost | Speed | Weapon |
|---|---|---|---|---|
| `us-ranger` | 115 | 130 | 8 | rifle 11 dmg, 450 range, 15 cd |
| `us-javelin-team` | 90 | 400 | 6 | antiTank 140, 1000 range, min 150, 90 cd, top attack |
| `us-humvee` | 280 | 450 | 27 | smallArms 12, 550, 10 cd |
| `us-stryker` | 480 | 750 | 26 | autocannon 15, 600, 8 cd |
| `us-abrams` | 900 | 1500 | 20 | antiTank 110, 750, 30 cd |
| `us-paladin` | 320 | 1500 | 16 | highExplosive 115, 2600 range, min 700, 180 cd, splash 175 |
| `us-firebase` | 1400 | 1000 | — | highExplosive 90, 1800 range, min 400, 150 cd, splash 150 |
| `us-dozer`, `us-supply-truck`, buildings | as Ukraine | as Ukraine | | |

## 5. Unique abilities

### 5.1 Abrams active protection

The Abrams carries a hard-kill active protection system (Trophy-like). When an
anti-tank missile or rocket flies at it, the system destroys the projectile
before impact, then needs time to reload. Shells, bullets and artillery are
not stopped. Zero Hour precedent: the Paladin's point-defence laser
(`PointDefenseLaserUpdate`: scans for projectiles in range, kills one,
reloads).

* Acceptance: an Abrams hit by two Stugna/Kornet missiles in a row survives the
  first untouched and takes the second; after the reload it stops one again.
* Numbers in data: `activeProtection: { reloadTicks, rangeCenti, stops: [antiTank] }`.

### 5.2 Ranger flash-bang

Rangers can throw a flash-bang at a garrisoned building: the occupants are
forced out stunned for a short time and the building stays standing (Zero Hour
Ranger flash-bang clears garrisons). Built after 5.1 if budget allows.

## 6. Assets (stages 2-4)

Meshy confirmed by the owner for this run (2026-11-24, D-11). Budget: 320
Meshy credits for the 14 types. Briefs (`meshy-modeler`, `unit-animator`):

| Id | Brief |
|---|---|
| `us-hq` | modern US Army forward operating base headquarters, tan prefab buildings, sandbag walls, antenna masts, camouflage netting |
| `us-power-plant` | compact military power station, tan containerised generators, cooling fans, cable runs, fuel tanks |
| `us-supply-center` | military logistics depot, tan warehouse tent, stacked supply crates and pallets, loading ramp |
| `us-barracks` | US Army barracks, tan modular prefab building with sandbags and a flagless pole |
| `us-vehicle-factory` | military vehicle maintenance hangar, large tan hangar with open bay door, crane gantry |
| `us-firebase` | sandbagged artillery fire base with a towed 155 mm howitzer under camouflage netting |
| `us-dozer` | armoured military bulldozer, olive drab, armoured cab with slit windows, large front blade |
| `us-supply-truck` | olive drab 8x8 heavy military cargo truck with covered cargo bed |
| `us-ranger` | US Army infantry soldier in tan-green camouflage uniform, helmet, plate carrier, assault rifle at low ready, A-pose arms |
| `us-javelin-team` | US Army soldier carrying a shoulder-fired anti-tank missile launcher tube with a command sight, tan-green camouflage, A-pose arms |
| `us-humvee` | olive drab 4x4 light military utility vehicle with a roof gun turret and heavy machine gun |
| `us-stryker` | olive drab 8x8 wheeled armoured personnel carrier with a remote weapon station |
| `us-abrams` | olive drab modern main battle tank, angular turret, long 120 mm gun, side skirts, small turret-mounted protection launchers |
| `us-paladin` | olive drab tracked self-propelled howitzer, large boxy turret, long 155 mm gun |

### Generation log

Image: `nano-banana` (prompt = brief + the common suffix below); mesh: `meshy-t2` smart topology, `meshy-n1` texture, 5000 triangles. Suffix: `three-quarter top view from front-left, single object centred, plain white background, realistic military, no text, no logos, no people`.

| Id | Final prompt | Image task | Mesh task |
|---|---|---|---|
| `us-hq` | modern US Army forward operating base headquarters, tan prefab buildings, sandbag walls, antenna masts, camouflage netting | `01a20f2e-aac1-7486-860f-53497d17ec5d` | `01a20f2e-e772-75ab-a6ae-ab44e5829d74` |
| `us-power-plant` | compact military power station, tan containerised generators, cooling fans, cable runs, fuel tanks | `01a20f2e-ad67-75e7-a85a-eded59474ccf` | `01a20f2e-eb98-7052-993d-78168a53ab37` |
| `us-supply-center` | military logistics depot, tan warehouse tent, stacked supply crates and pallets, loading ramp | `01a20f2e-b05c-72b5-916a-087edc44aa35` | `01a20f2e-efcd-7543-9f6f-705a19feaa0b` |
| `us-barracks` | US Army barracks, tan modular prefab building with sandbags and a flagless pole | `01a20f2e-b342-75a2-a241-e9042a3608f6` | `01a20f2e-f44a-70d0-aafc-8ce4964a0b51` |
| `us-vehicle-factory` | military vehicle maintenance hangar, large tan hangar with open bay door, crane gantry | `01a20f2e-b62c-76a2-b978-0b35eeee4257` | `01a20f2e-f841-7244-aa5c-d7f64570629d` |
| `us-firebase` | sandbagged artillery fire base with a towed 155 mm howitzer under camouflage netting, gun barrel pointing toward the lower-left | `01a20f2e-b91f-77dc-bd96-dca033b53794` | `01a20f2f-6815-73db-b71e-766abb722b5a` |
| `us-dozer` | armoured military bulldozer, olive drab, armoured cab with slit windows, large front blade (3000 triangles) | `01a20f2e-b811-741d-bb6c-39cb5bdde0bd` | `01a20f2e-f1b9-72f5-b841-18adc610f7aa` |
| `us-supply-truck` | olive drab 8x8 heavy military cargo truck with covered cargo bed (3000 triangles) | `01a20f2e-baca-722c-b6fe-64bcb0dfa48c` | `01a20f2e-f624-7481-8d72-28905a186148` |
| `us-humvee` | olive drab 4x4 light military utility vehicle with a roof gun turret and heavy machine gun, gun pointing forward (3000 triangles) | `01a20f2e-be0d-734a-85a3-aecb51b90e08` | `01a20f2e-f9bd-77ba-9d95-d94389533642` |
| `us-stryker` | olive drab 8x8 wheeled armoured personnel carrier with a remote weapon station turret, gun pointing forward (3000 triangles) | `01a20f2f-f39d-7731-a640-0bd0282bbf3d` | `01a20f30-0d31-74a7-86dd-17c7132a61a4` |
| `us-abrams` | olive drab modern main battle tank, angular turret, long 120 mm gun pointing forward, side skirts, small turret-mounted protection launchers (3000 triangles) | `01a20f2f-f6c4-73e0-bfc3-4e9f12675050` | `01a20f30-21ee-75d7-96b1-4388a6616b6d` |
| `us-paladin` | olive drab tracked self-propelled howitzer, large boxy turret, long 155 mm gun pointing forward (3000 triangles) | `01a20f2f-f99a-7341-8261-f597370b9632` | `01a20f30-1421-7404-8c89-848185d80661` |
| us-ranger | nano-banana a-pose: "US Army infantry soldier in tan-green camouflage uniform, helmet, plate carrier, assault rifle at low ready, A-pose arms, full body, three-quarter top view from front-left, single object centred, plain white background, realistic military, no text, no logos" | image 01a20f2e-d0ba-7683-97bf-c81781775cae; mesh (meshy-t2.5 smart topology, meshy-n1, 3000 tris) 01a20f2f-3f3a-73b5-9865-7ef78bcd380a; rig 01a20f30-74eb-74ed-a630-6da1b6923c8c; combat (action 690) 01a20f30-d23c-75fb-b8a3-63e57e5e66c4 |
| us-javelin-team | nano-banana a-pose: "US Army soldier carrying a shoulder-fired anti-tank missile launcher tube with a command sight resting on the right shoulder, tan-green camouflage, helmet, A-pose, full body, three-quarter top view from front-left, single object centred, plain white background, realistic military, no text, no logos" | image 01a20f2e-d503-7500-bd02-0004b880be2b; mesh 01a20f2f-45ea-729f-bd99-44c5c83aeb72; rig 01a20f30-8a17-7611-9783-7160b45cf6db; combat (action 690) 01a20f30-d3e5-774d-96b9-d462fb2cf313 |

## 7. Balance

Tournaments USA vs Ukraine and USA vs Russia on every map, both
personalities: no side above 70 % (`balance-tuner`, report in
`docs/balance/`).

## 8. Acceptance criteria

* AC-53-01 USA appears in the skirmish army choice and starts with `us-hq` and
  `us-dozer`.
* AC-53-02 Every type of §3 has a model that passes `assets:check --strict`.
* AC-53-03 The computer plays the USA with `usa-balanced` and `usa-rush`.
* AC-53-04 §5.1 behaves as its acceptance line (sim test).
* AC-53-05 Tournament win rates within 30-70 % (§7).
* AC-53-06 Help pages and voice lines exist for every unit.
