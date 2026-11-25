# 56 — New army: China

Status: in progress (issue #486). Built with the faction assembly line
(`.agents/workflows/faction-assembly.md`), stages 0 and 1 done here. Depends on
`50-veterancy.md`, `52-upgrades.md`, `53-faction-choice.md` and
`54-army-usa.md` (the template). Decisions: D-03 (no real people, no official
logos of designated organisations), D-04 (every faction has a unique unit or
ability; balance verified by tournaments), D-05 (numbers in `data/`), D-11
(paid APIs need the owner's confirmation).

## 1. Goal

The player can pick China in a skirmish and play a full game with it: build a
base, harvest, mass cheap infantry and a solid tank line, and bombard from
range with rocket artillery. China is the mass army: cheaper units than every
other faction, strongest in numbers, with a group bonus that rewards keeping
the infantry together (the USA is small and elite, Ukraine mobile and
drone-led, Russia heavy on armour and aviation).

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8` (engine code is
local; `INIZH.big` is not, so roster and numbers are from memory and none are
copied; ours are set relative to the existing data and tuned by tournaments, §7).

* China core: Command Center, Nuke Reactor, Supply Center, Barracks, War
  Factory, Gattling Cannon (base defence), Propaganda Center, Internet Center,
  Dozer, Supply Truck; Red Guard (cheap rifle infantry), Tank Hunter (anti-tank
  infantry), Hacker; Battlemaster (main tank), Overlord (heavy tank with a
  rider), Gattling Tank (also anti-air), Troop Crawler, Inferno Cannon, Nuke
  Cannon, Dragon Tank.
* Signature: the Horde bonus (`HordeUpdate.cpp`, `AIUpdate.cpp`
  `evaluateMoraleBonus`): a unit that has at least `Count - 1` allied units of
  its own kind within `Radius` joins the horde and gets the
  `WEAPONBONUS_HORDE` weapon bonus (higher fire rate); it stays in the horde
  while any member is within `RubOffRadius` (default 20) of it. Nationalism
  and Fanaticism are extra bonuses for units in a horde. Others: Overlord
  riders, Gattling AA, Nuke Cannon, Propaganda Tower healing, hackers.
* Identity: cheap mass infantry and tanks, the group bonus, defence by
  firepower, against the USA's quality and the GLA's swarms.

## 3. Roster (14 types + 2 upgrades)

Real-world equivalents replace the Zero Hour names; no design is shared with
another faction (the USA already has a howitzer, so China's artillery is a
rocket launcher; Russia has the TOS thermobaric launcher, so the PHL-03 is a
long-range high-explosive salvo).

| Id | Role (Zero Hour slot) | Category | Notes |
|---|---|---|---|
| `cn-hq` | Command Center | building | builds the dozer |
| `cn-power-plant` | Nuke Reactor | building | |
| `cn-supply-center` | Supply Center | building | free `cn-supply-truck` |
| `cn-barracks` | Barracks | building | heals infantry; sells Nationalism |
| `cn-vehicle-factory` | War Factory | building | repairs vehicles; sells Composite armor |
| `cn-gattling-nest` | Gattling Cannon (base defence) | building | rotary 30 mm CIWS-style gun, ground and low air, needs power |
| `cn-dozer` | Dozer | unit, tracked | armoured bulldozer |
| `cn-supply-truck` | Supply Truck | unit, wheeled | 6x6 cargo truck |
| `cn-rifle-squad` | Red Guard | unit, foot | QBZ-95 bullpup rifle; cheap; Horde (§5.1) |
| `cn-hj-team` | Tank Hunter | unit, foot | HJ-12 anti-tank missile; crew of two |
| `cn-mengshi` | Humvee-class scout | unit, wheeled | Dongfeng Mengshi 4x4, roof gun, carries 5, fire from inside |
| `cn-zbl-09` | Troop Crawler | unit, wheeled | ZBL-09 8x8 IFV, 30 mm cannon, carries 8 |
| `cn-type-99a` | Battlemaster/Overlord | unit, tracked | Type 99A main battle tank, 125 mm |
| `cn-phl-03` | Inferno/Nuke Cannon (artillery) | unit, wheeled | PHL-03 300 mm 8x8 rocket launcher |
| `cn-nationalism` | upgrade (barracks) | upgrade | infantry damage +15 % |
| `cn-composite-armor` | upgrade (factory) | upgrade | Mengshi, ZBL-09, Type 99A health +20 % |

Assumptions:

* The Overlord rider, the Gattling Tank, the Nuke Cannon, hackers, the
  Propaganda and Internet Centers, aircraft and the Helix come in later slices.
  The Gattling stays a base defence only for now.
* The HJ-12 team is two soldiers (gunner and loader), like the Russian RPG
  team, so it fills its render box. Its missile is a loft (not top-attack)
  shot, a deliberate difference from the USA Javelin.
* The PHL-03 is wheeled, so it moves faster than the USA Paladin but carries
  less health and cannot cross rough ground tracked units can.
* Spec 52 upgrade names: Nationalism follows Zero Hour; it is a flat damage
  upgrade here, not a horde-only bonus.

## 4. Numbers (starting point, D-05)

Relative to Ukraine: infantry and light vehicles 5-10 % cheaper, tanks and
artillery 10 % cheaper, a little less health each, so China fields more.

| Id | HP | Cost | Speed | Weapon |
|---|---|---|---|---|
| `cn-rifle-squad` | 100 | 90 | 8 | rifle 10 dmg, 430 range, 14 cd |
| `cn-hj-team` | 85 | 330 | 6 | antiTank 125, 900 range, min 150, 90 cd, loft |
| `cn-mengshi` | 260 | 400 | 27 | smallArms 11, 520, 10 cd |
| `cn-zbl-09` | 430 | 650 | 25 | autocannon 15, 600, 8 cd |
| `cn-type-99a` | 850 | 1350 | 20 | antiTank 105, 750, 30 cd |
| `cn-phl-03` | 280 | 1300 | 18 | highExplosive 50 x 6 salvo, 2800 range, min 800, 240 cd, splash 170 |
| `cn-gattling-nest` | 1200 | 700 | — | autocannon 9, 800 range, 3 cd, low air |
| `cn-dozer`, `cn-supply-truck`, buildings | as USA | as USA | | barracks 450, hq/plants/centers as USA |

## 5. Unique abilities

### 5.1 Horde bonus (implemented)

Infantry fight better in a crowd. A `cn-rifle-squad` or `cn-hj-team` that has
at least `count - 1` other living infantry of its own type of the same player
within `radiusCenti` is "in a horde" and shoots faster; it stays in the horde
while any other horde member is within `rubOffRadiusCenti` of it. The
`cn-nationalism` upgrade raises the bonus. Zero Hour precedent:
`HordeUpdate::update` and `PartitionFilterHordeMember::allow` (sphere query
over allied same-kind units; the percentages live in the `WeaponBonus` block
of GameData and are not known here).

* Sim: recomputed each tick in unit-id order (deterministic, no hash
  iteration); stored as an entity flag; the weapon cooldown is multiplied by
  `rateOfFirePercent` while the flag is set. Fixed-point, integer percentages.
* Numbers in data (assumed): `horde: { count: 5, radiusCenti: 300,
  rubOffRadiusCenti: 150, rateOfFirePercent: 125 }` on `cn-rifle-squad` and
  `cn-hj-team`; `cn-nationalism` carries `hordePercent: 112`, which multiplies
  the horde rate (125 -> 140). Code: `crates/sim/src/horde.rs`, applied in
  `rank_weapon`; the flag is `Entity::horde` (hashed, saved, snapshot flag
  `FLAG_HORDE` = 2048).
* Client: a faint gold ring under the units of a horde (`hordeRings.ts`) and a
  "Horde bonus" section in both help pages.
* Acceptance: five rifle squads standing together fire 25 % faster than one
  alone; moving one beyond the rub-off radius of all the others removes the
  bonus from it only; a squad of a different type or an enemy next to them does
  not count; same seed, same result (replay hash).

## 6. Assets (stages 2-4)

Meshy confirmed by the owner for new armies (2026-11-24, D-11). Budget: 280
Meshy credits for the 14 types (about 18 per building or vehicle, 26 per
rigged infantry). Modern real-world PLA equipment, tan and green camouflage
(D-03: no official logos or insignia, no real people, no text, no flags).
Briefs (`meshy-modeler`, `unit-animator`; common suffix: `three-quarter top
view from front-left, single object centred, plain white background, realistic
military, no text, no logos, no people`):

| Id | Brief |
|---|---|
| `cn-hq` | modern Chinese military command post compound, grey-green concrete bunker building with a flat roof, antenna masts, satellite dish, camouflage netting |
| `cn-power-plant` | compact military power station, green containerised generators, cooling fans, cable runs, fuel tanks |
| `cn-supply-center` | military logistics depot, green-grey warehouse with a loading ramp, stacked supply crates and pallets |
| `cn-barracks` | Chinese army barracks, two-storey concrete block building painted pale grey with a green roof, sandbags, a flagless pole |
| `cn-vehicle-factory` | military vehicle maintenance hangar, large green-grey hangar with an open bay door, overhead crane |
| `cn-gattling-nest` | sandbagged emplacement with a seven-barrel rotary 30 mm cannon on a turret, ammunition drum, camouflage netting, barrel pointing toward the lower-left |
| `cn-dozer` | armoured military bulldozer, green camouflage, armoured cab with slit windows, large front blade |
| `cn-supply-truck` | green camouflage 6x6 heavy military cargo truck with covered cargo bed |
| `cn-rifle-squad` | People's Liberation Army infantry soldier in woodland digital camouflage uniform, helmet, plate carrier, bullpup assault rifle at low ready, A-pose arms |
| `cn-hj-team` | PLA soldier carrying a shoulder-fired anti-tank missile launcher tube on the shoulder with a sight, woodland digital camouflage, helmet, A-pose arms |
| `cn-mengshi` | green camouflage 4x4 light military utility vehicle with a roof gun turret and heavy machine gun |
| `cn-zbl-09` | green camouflage 8x8 wheeled infantry fighting vehicle with a turret and 30 mm cannon |
| `cn-type-99a` | green and tan camouflage modern main battle tank, flat angular turret, long 125 mm gun, side skirts, reactive armour blocks |
| `cn-phl-03` | green camouflage 8x8 truck carrying a rack of twelve large rocket tubes on top, armoured cab |

Generation log (2026-11-25; image task / image-to-3d task; nano-banana, then
meshy-t2 + meshy-n1, infantry meshy-t2.5 + rig and one combat clip). 268
credits in total:

| Id | Image | Mesh | Credits |
|---|---|---|---|
| `cn-hq` | 01a21040-840b | 01a21040-c184 | 18 |
| `cn-power-plant` | 01a21040-8673 | 01a21040-c6ac | 18 |
| `cn-supply-center` | 01a21041-24c6 | 01a21041-4ee9 | 18 |
| `cn-barracks` | 01a21041-26f8 | 01a21041-5478 | 18 |
| `cn-vehicle-factory` | 01a21041-babe | 01a21042-22c1 | 18 |
| `cn-gattling-nest` | 01a21041-bdfb | 01a21042-26ad | 18 |
| `cn-dozer` | 01a21040-9127 | 01a21040-cccd | 18 |
| `cn-supply-truck` | 01a21040-9364 | 01a21040-d0d4 | 18 |
| `cn-mengshi` | 01a21041-428d | 01a21041-78ae | 18 |
| `cn-zbl-09` | 01a21041-442b | 01a21041-7ca8 | 18 |
| `cn-type-99a` | 01a21042-1c4e | 01a21042-44e8 | 18 |
| `cn-phl-03` | 01a21042-1eaa | 01a21042-49a0 | 18 |
| `cn-rifle-squad` | 01a21043-1c34 | 01a21043-7145 | 26 |
| `cn-hj-team` | 01a21043-205a | 01a21043-7806 | 26 |

Known gap: the Gattling nest model shows a twin barrel, not seven.


Until the models exist the types load in the client without a `.glb`:
`assets:check` only warns "missing" and the renderer draws the type's
`render.size` box (`render.height` for buildings), so the faction is playable
and testable now.

## 7. Balance

Tournaments China vs Ukraine, Russia and USA on every map, both
personalities: no side above 70 % (`balance-tuner`, report in
`docs/balance/`). `china-balanced` and `china-rush` start as the USA
personalities with the roster mapped one to one (the rush opens with ten rifle
squads); expect them to be retuned toward mass infantry.

## 8. Acceptance criteria

* AC-56-01 China appears in the skirmish army choice and starts with `cn-hq`
  and `cn-dozer`.
* AC-56-02 Every type of §3 has a model that passes `assets:check --strict`.
* AC-56-03 The computer plays China with `china-balanced` and `china-rush`.
* AC-56-04 §5.1 behaves as its acceptance line (sim test).
* AC-56-05 Tournament win rates within 30-70 % (§7).
* AC-56-06 Help pages and voice lines exist for every unit.
* AC-56-07 The China flag (red field, five yellow stars) flies over the HQ.
