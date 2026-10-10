# 03 — Phase 2 core RTS loop

Status: approved for implementation. Depends on `00-vision.md`,
`01-architecture.md` and `02-phase1-tech-slice.md`. Roadmap: Phase 2. Game
design decisions: `docs/decisions.md` D-10.

## 1. Context

Phase 2 turns the tech slice into a playable RTS loop: supply depots and supply
trucks, power, construction by dozers, production queues, ground combat and fog
of war. The first matchup is Ukraine vs Russia with six combat units, a dozer, a
supply truck and six buildings per faction, defined in `data/` YAML validated by
JSON Schema. The design follows C&C Generals (`docs/decisions.md` D-02 allows
studying its GPL-3.0 source; the energy ratio, damage-type × armour
coefficients and supply box model below come from
`Common/RTS/Energy.cpp`, `ThingTemplate::calcTimeToBuild`, `Object/Armor.cpp`
and `DockUpdate/SupplyCenterDockUpdate.cpp`, rewritten in fixed point).

There is no computer AI yet (Phase 3). The second player is controlled by the
same person through a debug-only hot-seat switch.

**Exit criterion of Phase 2:** every acceptance criterion below has a passing
test in CI (AC-03-63 runs locally on the reference machine), and the owner can
open the preview build, build a base as Ukraine (power plant, supply center,
barracks, vehicle factory, defense), harvest, produce units, switch to Russia
with `F2`, build there too, fight, and win by destroying every enemy building.

## 2. Scope

In:

* `data/`: JSON Schemas, YAML sources (globals, two factions, one map), a
  generated canonical `data/generated/ruleset.json`, build and check scripts.
* `crates/sim`: ruleset parsing, entities (units, buildings, depots) with owners,
  players, credits, power, production queues, rally points, construction by
  dozers, harvesting, weapons, damage matrix, projectiles and splash, attack
  orders, powered defenses, per-player visibility, exploration and last-seen
  buildings, deaths, victory, state hash v2, match snapshot, WASM API v2.
* `crates/headless`: match scripts in the `hash` subcommand.
* `client/`: skirmish mode (default) next to the preserved tech-slice mode;
  ruleset module, match snapshot decoding, entity, fog, health bar and tracer
  rendering, entity selection, right-click intents, building placement, command
  panel, resource bar, outcome overlay, hot-seat and reveal debug keys, debug
  API v2, E2E and performance tests.

Out (later phases):

* Computer AI, tournaments and balance reports (Phase 3).
* Air units and drones, anti-air (D-10), unit crushing, directional armour,
  veterancy, upgrades, special powers, garrisons, transports, repair, selling,
  cancelling a placed construction, power sabotage, radar and minimap.
* Formations, waypoints, attack-move, guard, control groups, shift-add.
* Line of sight blocked by terrain, terrain heights, friendly fire.
* Real models, effects, audio, gore filter (Phase 4). Multiplayer (Phase 5).

## 3. Constants

| Name | Value | Location |
|---|---|---|
| `API_VERSION` / `EXPECTED_API_VERSION` | `2` | `crates/sim/src/lib.rs`, `client/src/sim/protocol.ts` |
| `NEUTRAL` / `OBSERVER` | `255` (`PlayerId`) | `crates/sim/src/entity.rs`, `client/src/sim/matchSnapshot.ts` |
| `QUEUE_SLOTS` | `9` (maximum allowed `maxQueue`, D-12) | `crates/sim/src/rules.rs`, `client/src/sim/matchSnapshot.ts` |
| `MATCH_HEADER_LEN` / `ENTITY_STRIDE` / `QUEUE_STRIDE` | `8` / `9` / `12` | `crates/sim/src/snapshot.rs`, `client/src/sim/matchSnapshot.ts` |
| `FORMAT_VERSION` | `1` (generated ruleset) | `scripts/build-data.mjs`, `crates/sim/src/rules.rs` |
| `DEFAULT_MAP` | `"first-line"` | `client/src/app/skirmish.ts` |
| `MAX_SPEED` | `8` (debug `speed` URL parameter, clamped to `1..=8`) | `client/src/app/skirmish.ts` |
| `MAX_DRAW_CALLS_SKIRMISH` | `8` | AC-03-62 |

Units used in data and in the simulation:

* **Distance:** centitiles (1/100 tile), integers. `fx_centi(c) =
  Fx::from_raw((c as i64 * 65536 / 100) as i32)` (truncating division; all data
  values are non-negative). Examples: `fx_centi(500) = 327680`,
  `fx_centi(20) = 13107` (= Phase 1 `UNIT_SPEED`), `fx_centi(8) = 5242`.
* **Speed:** centitiles per tick. **Time:** ticks (15 per second).
* **Money:** credits (`u32`). **Hit points and damage:** `u32`. **Modifiers:**
  integer percent.

## 4. Data (`data/`)

### 4.1 Files

```
data/schema/globals.schema.json   JSON Schema 2020-12 for data/rules/globals.yaml
data/schema/faction.schema.json   JSON Schema 2020-12 for data/factions/<id>.yaml
data/schema/map.schema.json       JSON Schema 2020-12 for data/maps/<id>.yaml
data/rules/globals.yaml           damage types, armour classes, matrix, economy, common types, file order
data/factions/ukraine.yaml        weapons and types of Ukraine
data/factions/russia.yaml         weapons and types of Russia
data/maps/first-line.yaml         the Phase 2 skirmish map
data/generated/ruleset.json       generated, committed, canonical (§4.4); never edited by hand
```

Every schema sets `"additionalProperties": false` on every object, requires the
fields marked required below, uses `"type": "integer"` with `"minimum"` for
every number (non-integers are invalid). Ids of weapons, types, factions and
maps match `^[a-z0-9]+(-[a-z0-9]+)*$`; damage type and armour class ids match
`^[a-z][a-zA-Z0-9]*$` (e.g. `smallArms`).

### 4.2 Source format

`data/rules/globals.yaml`:

```yaml
factions: [ukraine, russia]          # required; file order of data/factions/<id>.yaml
maps: [first-line]                   # required; file order of data/maps/<id>.yaml
damageTypes: [smallArms, autocannon, antiTank, highExplosive, thermobaric]   # required, ids
armorClasses: [infantry, light, armored, structure]                           # required, ids
damageModifiers:                     # required: one entry per damage type, one key per armour class, 0..1000
  smallArms: { infantry: 100, light: 30, armored: 0, structure: 10 }
  # ...
startingCredits: 5000                # required, >= 0
lowPowerMinSpeedPercent: 25          # required, 1..100
lowPowerMaxSpeedPercent: 75          # required, 1..100
maxQueue: 9                          # required, 1..9 (semantic check: <= QUEUE_SLOTS)
dockRangeCenti: 100                  # required, >= 1
commonTypes: [ ... ]                 # required; type objects with no faction (placeholder, depot)
```

`data/factions/<id>.yaml`:

```yaml
id: ukraine                          # required, must equal the file name
hq: ua-hq                            # required, a building type of this file
dozer: ua-dozer                      # required, a unit type of this file
weapons:                             # required
  - id: ua-rifle                     # required, unique across all files
    damageType: smallArms            # required, a damage type id
    damage: 10                       # required, >= 1
    rangeCenti: 450                  # required, >= 1
    cooldownTicks: 15                # required, >= 1
    minRangeCenti: 0                 # optional, default 0
    splashCenti: 0                   # optional, default 0 (0 = single target)
    projectileTicks: 0               # optional, default 0 (0 = instant hit)
types:                               # required
  - id: ua-rifleman                  # required, unique across all files
    category: unit                   # required: unit | building | depot
    # unit:     required armor, hp (>=1), sightCenti, speedCenti (>=1), render.size [w, h, d] (centitiles, >=1)
    #           optional cost, buildTicks, weapon, requires, builds, capacity, loadTicks, unloadTicks
    # building: required armor, hp (>=1), sightCenti, footprint [w, h] (cells, 1..8), render.height (>=1)
    #           optional cost, buildTicks, weapon, requires, produces, power, requiresPower, dropOff, freeUnit
    # depot:    required armor, footprint, render.height; only in globals.commonTypes
```

The schema expresses the per-category required and allowed fields with
`if`/`then` on `category`. `requires`, `produces` and `builds` are lists of type
ids; `weapon` and `freeUnit` are a weapon id and a type id; `power` is an
integer (positive produces, negative consumes); `requiresPower` and `dropOff`
are booleans.

`data/maps/<id>.yaml`:

```yaml
id: first-line                       # required, equals the file name
width: 128                           # required, 16..256
height: 128                          # required, 16..256
blocked: [[62, 0, 65, 27]]           # required; inclusive cell rectangles [x0, y0, x1, y1]
depots: [{ origin: [12, 54], amount: 15000 }]          # required; origin = top-left cell
starts:                              # required, exactly 2 entries; start i is player i
  - { faction: ukraine, hq: [12, 60], dozerCenti: [1850, 6150] }
```

### 4.3 Build script (`scripts/build-data.mjs`)

Root `package.json` gains `devDependencies` `"ajv": "8.17.1"` and
`"yaml": "2.8.1"` (exact versions, committed root `package-lock.json`), scripts
`"install:root": "npm ci"` and `"build:data": "node scripts/build-data.mjs"`.
`.github/workflows/ci.yml` runs `node --run install:root` before
`node --run install:client` and adds `package-lock.json` to
`cache-dependency-path`.

```js
/** @typedef {{ file: string, text: string }} SourceFile */
/** @typedef {{ globals: SourceFile, factions: SourceFile[], maps: SourceFile[] }} Sources */
/** @typedef {"parse"|"schema"|"duplicate-id"|"unknown-reference"|"invalid-value"} DataErrorCode */
/** @typedef {{ file: string, pointer: string, code: DataErrorCode, message: string }} DataError */

/** Reads data/rules/globals.yaml, then data/factions/<id>.yaml and
 *  data/maps/<id>.yaml in the order listed by globals `factions` and `maps`.
 *  `file` values are repository-relative POSIX paths. */
export function readSources(rootDir /* : string */) /* : Sources */;

/** Pure. Parses YAML (code "parse"), validates each file against its schema
 *  with Ajv 2020 (`ajv/dist/2020.js`, allErrors: true; code "schema", pointer =
 *  Ajv instancePath or "/" for the root), then runs semantic checks in source
 *  order: duplicate weapon or type ids across all files ("duplicate-id",
 *  pointer of the later occurrence, e.g. "/types/3/id"); unknown damage type,
 *  armour class, weapon, type or faction ids ("unknown-reference", pointer of
 *  the referencing value, e.g. "/types/2/weapon"); and "invalid-value" for: a
 *  damageModifiers entry missing a damage type or armour class, maxQueue > 9,
 *  lowPowerMinSpeedPercent > lowPowerMaxSpeedPercent, a faction file whose id
 *  differs from its file name, hq not a building of the same faction, dozer
 *  not a unit of the same faction with non-empty builds, a map rectangle,
 *  depot footprint, HQ footprint or dozer position out of bounds, and a depot or
 *  HQ footprint overlapping a blocked cell or another footprint.
 *  On any error returns { ruleset: null, errors } (errors in the order found);
 *  otherwise { ruleset, errors: [] } with ruleset as in §4.4. */
export function buildRuleset(sources /* : Sources */) /* : { ruleset: object | null, errors: DataError[] } */;

/** JSON.stringify(ruleset, null, 2) + "\n" */
export function serializeRuleset(ruleset /* : object */) /* : string */;

/** CLI (when run directly): buildRuleset(readSources(repoRoot)); on errors
 *  prints "<file> <pointer> <code> <message>" per error and exits 1; otherwise
 *  writes data/generated/ruleset.json and exits 0. */
```

`scripts/check-data.mjs` (CLI only, already called by `verify`): builds in
memory; on errors prints them like the build CLI and exits 1; if
`serializeRuleset(ruleset)` differs from the committed
`data/generated/ruleset.json` prints
`data/generated/ruleset.json is stale: run node --run build:data` and exits 1;
otherwise prints `check:data: ok` and exits 0.

### 4.4 Generated ruleset (`data/generated/ruleset.json`)

The only data the simulation and the client read. References are resolved to
indices; every key is present (defaults filled) in exactly this order:

```json
{
  "formatVersion": 1,
  "damageTypes": ["<id>", "..."],
  "armorClasses": ["<id>", "..."],
  "damageModifiers": [[100, 30, 0, 10], "... one row per damage type, one column per armour class"],
  "startingCredits": 5000,
  "lowPowerMinSpeedPercent": 25,
  "lowPowerMaxSpeedPercent": 75,
  "maxQueue": 9,
  "dockRangeCenti": 100,
  "weapons": [
    { "id": "ua-rifle", "damageType": 0, "damage": 10, "rangeCenti": 450, "minRangeCenti": 0,
      "cooldownTicks": 15, "splashCenti": 0, "projectileTicks": 0 }
  ],
  "types": [
    { "id": "ua-rifleman", "faction": 0, "category": "unit", "armor": 0, "hp": 100, "sightCenti": 600,
      "cost": 100, "buildTicks": 75, "speedCenti": 8, "weapon": 0, "requires": [], "produces": [],
      "builds": [], "footprint": [0, 0], "power": 0, "requiresPower": false, "dropOff": false,
      "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [30, 60, 30] } }
  ],
  "factions": [{ "id": "ukraine", "hq": 17, "dozer": 8 }],
  "maps": [
    { "id": "first-line", "width": 128, "height": 128, "blocked": [[62, 0, 65, 27]],
      "depots": [{ "origin": [12, 54], "amount": 15000 }],
      "starts": [{ "faction": 0, "hq": [12, 60], "dozerCenti": [1850, 6150] }] }
  ]
}
```

* Weapon order: faction files in `factions` order, each in file order. Type
  order: `commonTypes`, then each faction file in order. A type's index is its
  position in `types` (`TypeId`); this is the `kind` used everywhere.
* `faction`: faction index, `-1` for common types. `weapon`, `freeUnit`: index
  or `-1`. Absent optional numbers are `0`, lists `[]`, booleans `false`.
  Units get `"footprint": [0, 0]`. Buildings and depots get
  `render.size = [footprint.w * 100, render.height, footprint.h * 100]`.

### 4.5 Builtin content

`globals.yaml` values: `startingCredits 5000`, `lowPowerMinSpeedPercent 25`,
`lowPowerMaxSpeedPercent 75`, `maxQueue 9`, `dockRangeCenti 100`.

Damage modifiers (percent):

| damage \ armour | infantry | light | armored | structure |
|---|---|---|---|---|
| smallArms | 100 | 30 | 0 | 10 |
| autocannon | 75 | 100 | 20 | 40 |
| antiTank | 30 | 100 | 100 | 60 |
| highExplosive | 100 | 80 | 60 | 100 |
| thermobaric | 150 | 70 | 20 | 120 |

Common types (in this order):

| id | category | armor | hp | sight | speed | footprint | render |
|---|---|---|---|---|---|---|---|
| `tech-slice-placeholder` | unit | infantry | 1 | 0 | 20 | — | size `[40, 50, 40]` |
| `supply-depot` | depot | structure | — | — | — | `[2, 2]` | height `60` |

Weapons (`min`, `splash`, `proj` default 0 when blank):

| id | damage type | dmg | range | min | cooldown | splash | proj |
|---|---|---|---|---|---|---|---|
| `ua-rifle` | smallArms | 10 | 450 | | 15 | | |
| `ua-stugna-p` | antiTank | 120 | 900 | 200 | 75 | | |
| `ua-kozak-hmg` | smallArms | 12 | 500 | | 10 | | |
| `ua-bushmaster` | autocannon | 18 | 600 | | 8 | | |
| `ua-rh120` | antiTank | 100 | 700 | | 30 | | |
| `ua-gmlrs` | highExplosive | 250 | 2400 | 600 | 150 | | 30 |
| `ua-stugna-emplacement` | antiTank | 110 | 1000 | | 60 | | |
| `ru-ak74` | smallArms | 9 | 420 | | 15 | | |
| `ru-rpg7` | antiTank | 90 | 450 | | 45 | | |
| `ru-kpvt` | smallArms | 14 | 500 | | 10 | | |
| `ru-2a42` | autocannon | 16 | 600 | | 8 | | |
| `ru-2a46m` | antiTank | 85 | 650 | | 33 | | |
| `ru-tos-thermobaric` | thermobaric | 120 | 1000 | 300 | 180 | 250 | 20 |
| `ru-kornet-emplacement` | antiTank | 120 | 1100 | | 75 | | |

Ukraine units (file order; `ua-` weapons above in the same order):

| id | armor | hp | sight | cost | build | speed | weapon | other | render size |
|---|---|---|---|---|---|---|---|---|---|
| `ua-rifleman` | infantry | 100 | 600 | 100 | 75 | 8 | `ua-rifle` | | `[30, 60, 30]` |
| `ua-stugna-team` | infantry | 90 | 650 | 350 | 150 | 6 | `ua-stugna-p` | | `[40, 50, 40]` |
| `ua-kozak-scout` | light | 250 | 1200 | 400 | 150 | 26 | `ua-kozak-hmg` | | `[60, 50, 90]` |
| `ua-bradley` | light | 500 | 700 | 800 | 240 | 22 | `ua-bushmaster` | | `[70, 60, 110]` |
| `ua-leopard-2a4` | armored | 750 | 700 | 1200 | 330 | 17 | `ua-rh120` | | `[80, 55, 130]` |
| `ua-himars` | light | 200 | 600 | 1500 | 360 | 18 | `ua-gmlrs` | | `[60, 70, 120]` |
| `ua-dozer` | light | 300 | 500 | 800 | 200 | 15 | | builds `ua-power-plant, ua-supply-center, ua-barracks, ua-vehicle-factory, ua-defense` | `[80, 60, 100]` |
| `ua-supply-truck` | light | 250 | 500 | 600 | 150 | 20 | | capacity 300, load 45, unload 15 | `[60, 60, 100]` |

Russia units (file order):

| id | armor | hp | sight | cost | build | speed | weapon | other | render size |
|---|---|---|---|---|---|---|---|---|---|
| `ru-rifleman` | infantry | 90 | 550 | 80 | 60 | 8 | `ru-ak74` | | `[30, 60, 30]` |
| `ru-rpg-gunner` | infantry | 90 | 550 | 200 | 90 | 8 | `ru-rpg7` | | `[35, 55, 35]` |
| `ru-brdm-scout` | light | 220 | 1000 | 300 | 120 | 30 | `ru-kpvt` | | `[60, 50, 90]` |
| `ru-bmp-2` | light | 450 | 650 | 600 | 200 | 22 | `ru-2a42` | | `[70, 55, 110]` |
| `ru-t-72b3` | armored | 850 | 650 | 900 | 270 | 17 | `ru-2a46m` | | `[80, 55, 125]` |
| `ru-tos-1a` | armored | 350 | 600 | 1400 | 330 | 16 | `ru-tos-thermobaric` | | `[80, 70, 125]` |
| `ru-dozer` | light | 300 | 500 | 800 | 200 | 15 | | builds `ru-power-plant, ru-supply-center, ru-barracks, ru-vehicle-factory, ru-defense` | `[80, 60, 100]` |
| `ru-supply-truck` | light | 250 | 500 | 600 | 150 | 20 | | capacity 300, load 45, unload 15 | `[60, 60, 100]` |

Buildings of each faction, in this order after its units, with prefix `ua-` or
`ru-` on the id and on every referenced id (all `armor: structure`):

| id suffix | footprint | hp | sight | cost | build | power | produces | requires | other | height |
|---|---|---|---|---|---|---|---|---|---|---|
| `hq` | `[4, 4]` | 3000 | 900 | 0 | 0 | 0 | `dozer` | | | 150 |
| `power-plant` | `[3, 3]` | 1000 | 500 | 600 | 150 | 10 | | | | 120 |
| `supply-center` | `[4, 3]` | 1500 | 500 | 1500 | 225 | -2 | `supply-truck` | | `dropOff: true`, `freeUnit: supply-truck` | 100 |
| `barracks` | `[3, 3]` | 1000 | 500 | 500 | 150 | -2 | Ukraine `rifleman, stugna-team`; Russia `rifleman, rpg-gunner` | `power-plant` | | 90 |
| `vehicle-factory` | `[4, 4]` | 2000 | 500 | 2000 | 300 | -4 | Ukraine `kozak-scout, bradley, leopard-2a4, himars`; Russia `brdm-scout, bmp-2, t-72b3, tos-1a` | `supply-center` | | 110 |
| `defense` | `[2, 2]` | 1200 | 1100 | 800 | 150 | -3 | | `barracks` | `requiresPower: true`, weapon `ua-stugna-emplacement` / `ru-kornet-emplacement` | 80 |

Faction files: `ukraine.yaml` (`hq: ua-hq`, `dozer: ua-dozer`) and
`russia.yaml` (`hq: ru-hq`, `dozer: ru-dozer`).

Map `first-line` (128 x 128, point-symmetric: cell `(x, y)` ↔
`(127 - x, 127 - y)`):

* `blocked` (river with two fords at y 28..=35 and 92..=99, four woods):
  `[62, 0, 65, 27]`, `[62, 36, 65, 91]`, `[62, 100, 65, 127]`,
  `[28, 40, 33, 47]`, `[94, 80, 99, 87]`, `[40, 70, 45, 75]`, `[82, 52, 87, 57]`.
* `depots` (this order, ids 0..=5 in a skirmish): `[12, 54]` 15000,
  `[114, 72]` 15000, `[36, 20]` 10000, `[90, 106]` 10000, `[36, 100]` 10000,
  `[90, 26]` 10000.
* `starts`: `{ faction: ukraine, hq: [12, 60], dozerCenti: [1850, 6150] }`,
  `{ faction: russia, hq: [112, 64], dozerCenti: [10950, 6650] }`.

### 4.6 Test ruleset fixture

`crates/sim/tests/fixtures/test-rules.json` is written by tier S in the RED
commit of P2-03 with exactly this content (generated format, two-space JSON).
All simulation criteria use it, so balance changes to the builtin data never
break them. Types: 0 placeholder, 1 depot, 2 hq, 3 power, 4 center, 5 factory,
6 turret, 7 dozer, 8 truck, 9 soldier, 10 tank, 11 mortar-unit, 12 launcher.

```json
{
  "formatVersion": 1,
  "damageTypes": ["kinetic", "explosive"],
  "armorClasses": ["soft", "hard", "structure"],
  "damageModifiers": [[100, 0, 50], [50, 100, 100]],
  "startingCredits": 1000,
  "lowPowerMinSpeedPercent": 25,
  "lowPowerMaxSpeedPercent": 75,
  "maxQueue": 3,
  "dockRangeCenti": 100,
  "weapons": [
    { "id": "gun", "damageType": 0, "damage": 10, "rangeCenti": 500, "minRangeCenti": 0, "cooldownTicks": 5, "splashCenti": 0, "projectileTicks": 0 },
    { "id": "cannon", "damageType": 1, "damage": 40, "rangeCenti": 600, "minRangeCenti": 0, "cooldownTicks": 10, "splashCenti": 0, "projectileTicks": 0 },
    { "id": "mortar", "damageType": 1, "damage": 30, "rangeCenti": 1000, "minRangeCenti": 300, "cooldownTicks": 20, "splashCenti": 150, "projectileTicks": 4 },
    { "id": "turret-gun", "damageType": 1, "damage": 25, "rangeCenti": 700, "minRangeCenti": 0, "cooldownTicks": 10, "splashCenti": 0, "projectileTicks": 0 },
    { "id": "missile", "damageType": 1, "damage": 20, "rangeCenti": 800, "minRangeCenti": 0, "cooldownTicks": 30, "splashCenti": 0, "projectileTicks": 3 }
  ],
  "types": [
    { "id": "tech-slice-placeholder", "faction": -1, "category": "unit", "armor": 0, "hp": 1, "sightCenti": 0, "cost": 0, "buildTicks": 0, "speedCenti": 20, "weapon": -1, "requires": [], "produces": [], "builds": [], "footprint": [0, 0], "power": 0, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [40, 50, 40] } },
    { "id": "supply-depot", "faction": -1, "category": "depot", "armor": 2, "hp": 0, "sightCenti": 0, "cost": 0, "buildTicks": 0, "speedCenti": 0, "weapon": -1, "requires": [], "produces": [], "builds": [], "footprint": [2, 2], "power": 0, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [200, 60, 200] } },
    { "id": "hq", "faction": 0, "category": "building", "armor": 2, "hp": 1000, "sightCenti": 800, "cost": 0, "buildTicks": 0, "speedCenti": 0, "weapon": -1, "requires": [], "produces": [7], "builds": [], "footprint": [3, 3], "power": 0, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [300, 150, 300] } },
    { "id": "power", "faction": 0, "category": "building", "armor": 2, "hp": 400, "sightCenti": 300, "cost": 300, "buildTicks": 20, "speedCenti": 0, "weapon": -1, "requires": [], "produces": [], "builds": [], "footprint": [2, 2], "power": 10, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [200, 120, 200] } },
    { "id": "center", "faction": 0, "category": "building", "armor": 2, "hp": 500, "sightCenti": 300, "cost": 400, "buildTicks": 30, "speedCenti": 0, "weapon": -1, "requires": [], "produces": [8], "builds": [], "footprint": [3, 2], "power": -4, "requiresPower": false, "dropOff": true, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": 8, "render": { "size": [300, 100, 200] } },
    { "id": "factory", "faction": 0, "category": "building", "armor": 2, "hp": 600, "sightCenti": 300, "cost": 200, "buildTicks": 20, "speedCenti": 0, "weapon": -1, "requires": [3], "produces": [9, 10, 11, 12], "builds": [], "footprint": [3, 3], "power": -4, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [300, 110, 300] } },
    { "id": "turret", "faction": 0, "category": "building", "armor": 2, "hp": 300, "sightCenti": 500, "cost": 150, "buildTicks": 10, "speedCenti": 0, "weapon": 3, "requires": [3], "produces": [], "builds": [], "footprint": [1, 1], "power": -6, "requiresPower": true, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [100, 80, 100] } },
    { "id": "dozer", "faction": 0, "category": "unit", "armor": 1, "hp": 100, "sightCenti": 600, "cost": 200, "buildTicks": 10, "speedCenti": 20, "weapon": -1, "requires": [], "produces": [], "builds": [3, 4, 5, 6], "footprint": [0, 0], "power": 0, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [80, 60, 100] } },
    { "id": "truck", "faction": 0, "category": "unit", "armor": 1, "hp": 100, "sightCenti": 300, "cost": 100, "buildTicks": 10, "speedCenti": 20, "weapon": -1, "requires": [], "produces": [], "builds": [], "footprint": [0, 0], "power": 0, "requiresPower": false, "dropOff": false, "capacity": 100, "loadTicks": 3, "unloadTicks": 2, "freeUnit": -1, "render": { "size": [60, 60, 100] } },
    { "id": "soldier", "faction": 0, "category": "unit", "armor": 0, "hp": 50, "sightCenti": 600, "cost": 50, "buildTicks": 10, "speedCenti": 10, "weapon": 0, "requires": [], "produces": [], "builds": [], "footprint": [0, 0], "power": 0, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [30, 60, 30] } },
    { "id": "tank", "faction": 0, "category": "unit", "armor": 1, "hp": 200, "sightCenti": 600, "cost": 150, "buildTicks": 20, "speedCenti": 15, "weapon": 1, "requires": [4], "produces": [], "builds": [], "footprint": [0, 0], "power": 0, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [80, 55, 130] } },
    { "id": "mortar-unit", "faction": 0, "category": "unit", "armor": 0, "hp": 60, "sightCenti": 1100, "cost": 100, "buildTicks": 15, "speedCenti": 10, "weapon": 2, "requires": [], "produces": [], "builds": [], "footprint": [0, 0], "power": 0, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [40, 50, 40] } },
    { "id": "launcher", "faction": 0, "category": "unit", "armor": 1, "hp": 80, "sightCenti": 900, "cost": 100, "buildTicks": 10, "speedCenti": 10, "weapon": 4, "requires": [], "produces": [], "builds": [], "footprint": [0, 0], "power": 0, "requiresPower": false, "dropOff": false, "capacity": 0, "loadTicks": 0, "unloadTicks": 0, "freeUnit": -1, "render": { "size": [60, 70, 120] } }
  ],
  "factions": [{ "id": "alpha", "hq": 2, "dozer": 7 }],
  "maps": [
    {
      "id": "test-field", "width": 40, "height": 24, "blocked": [[19, 6, 20, 17]],
      "depots": [{ "origin": [8, 4], "amount": 300 }, { "origin": [30, 18], "amount": 300 }],
      "starts": [
        { "faction": 0, "hq": [2, 10], "dozerCenti": [650, 1150] },
        { "faction": 0, "hq": [35, 11], "dozerCenti": [3350, 1250] }
      ]
    }
  ]
}
```

## 5. Simulation design (`crates/sim`)

### 5.1 Module layout

`crates/sim/src/lib.rs` declares `pub mod` for `combat`, `economy`, `entity`,
`fixed`, `flow`, `hash`, `map`, `nav`, `player`, `rng`, `rules`, `snapshot`,
`vision`, `wasm_api`, `world`, and sets `pub const API_VERSION: u32 = 2;`.
`crates/sim/Cargo.toml` adds `serde` and `serde_json` (`{ workspace = true }`;
both are pure computation). `World` fields are `pub(crate)` so the phase
modules (`economy`, `combat`, `vision`, `nav`) operate on them; the public API
is the methods listed here.

### 5.2 Ruleset (`rules.rs`)

```rust
pub type TypeId = u16;
pub type WeaponId = u16;
pub type FactionId = u8;
pub const FORMAT_VERSION: u32 = 1;
pub const QUEUE_SLOTS: usize = 9;
/// Fx::from_raw((c as i64 * 65536 / 100) as i32)
pub fn fx_centi(c: u32) -> Fx;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category { Unit, Building, Depot }

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponDef { pub id: String, pub damage_type: u8, pub damage: u32, pub range_centi: u32,
    pub min_range_centi: u32, pub cooldown_ticks: u32, pub splash_centi: u32, pub projectile_ticks: u32 }

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeDef { pub id: String, pub faction: i32, pub category: Category, pub armor: u8, pub hp: u32,
    pub sight_centi: u32, pub cost: u32, pub build_ticks: u32, pub speed_centi: u32, pub weapon: i32,
    pub requires: Vec<TypeId>, pub produces: Vec<TypeId>, pub builds: Vec<TypeId>, pub footprint: [u16; 2],
    pub power: i32, pub requires_power: bool, pub drop_off: bool, pub capacity: u32, pub load_ticks: u32,
    pub unload_ticks: u32, pub free_unit: i32 }   // `render` is ignored by the sim

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct FactionDef { pub id: String, pub hq: TypeId, pub dozer: TypeId }
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct DepotDef { pub origin: [i32; 2], pub amount: u32 }
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDef { pub faction: FactionId, pub hq: [i32; 2], pub dozer_centi: [u32; 2] }
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct MapDef { pub id: String, pub width: u16, pub height: u16, pub blocked: Vec<[i32; 4]>,
    pub depots: Vec<DepotDef>, pub starts: Vec<StartDef> }

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ruleset { pub format_version: u32, pub damage_types: Vec<String>, pub armor_classes: Vec<String>,
    pub damage_modifiers: Vec<Vec<u32>>, pub starting_credits: u32, pub low_power_min_speed_percent: u32,
    pub low_power_max_speed_percent: u32, pub max_queue: u32, pub dock_range_centi: u32,
    pub weapons: Vec<WeaponDef>, pub types: Vec<TypeDef>, pub factions: Vec<FactionDef>, pub maps: Vec<MapDef> }

impl Ruleset {
    /// serde_json parse, then validate: format_version == FORMAT_VERSION; damage_modifiers is
    /// damage_types.len() rows of armor_classes.len() entries; max_queue in 1..=QUEUE_SLOTS;
    /// every weapon damage_type, type armor, weapon, requires/produces/builds/free_unit,
    /// faction (-1 or < factions.len()), faction hq/dozer and start faction index is in range.
    /// Err(message) names the offending camelCase field (e.g. "types[3].weapon out of range").
    pub fn from_json(text: &str) -> Result<Ruleset, String>;
    /// from_json(include_str!("../../../data/generated/ruleset.json")); panics if invalid.
    pub fn builtin() -> Ruleset;
    pub fn type_index(&self, id: &str) -> Option<TypeId>;      // first match in `types`
    pub fn map(&self, id: &str) -> Option<&MapDef>;
    pub fn ty(&self, kind: TypeId) -> &TypeDef;                // panics out of range
    pub fn weapon_of(&self, kind: TypeId) -> Option<&WeaponDef>;
    pub fn modifier(&self, damage_type: u8, armor: u8) -> u32;
    /// First type with category Depot (panics if none).
    pub fn depot_type(&self) -> TypeId;
}
```

### 5.3 Entities and players (`entity.rs`, `player.rs`)

```rust
pub type EntityId = u32;
pub type PlayerId = u8;
pub const NEUTRAL: PlayerId = 255;
pub const OBSERVER: PlayerId = 255;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HarvestPhase { ToDepot, Loading, ToCenter, Unloading }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Order {
    Idle { last_order_id: u32 },
    Move { order_id: u32, target: FxVec2, goal: Cell },
    Attack { order_id: u32, target: EntityId },
    Harvest { order_id: u32, depot: EntityId, center: Option<EntityId>, phase: HarvestPhase, timer: u32 },
    Build { order_id: u32, building: EntityId },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct QueueItem { pub kind: TypeId, pub progress: u32 }

/// Buildings and depots. `progress` counts speed-percent points; the site is
/// complete at build_ticks * 100. Depots are created complete.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Site { pub origin: Cell, pub progress: u32, pub complete: bool,
    pub queue: Vec<QueueItem>, pub rally: Option<FxVec2> }

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entity {
    pub id: EntityId,
    pub owner: PlayerId,               // NEUTRAL for depots
    pub kind: TypeId,
    pub pos: FxVec2,                   // buildings and depots: footprint centre
    pub hp: u32,                       // depots: remaining supply
    pub order: Order,                  // buildings and depots: always Idle { last_order_id: 0 }
    pub cooldown: u32,
    pub cargo: u32,
    pub last_target: Option<EntityId>, // entity fired at during this tick's combat phase
    pub site: Option<Site>,            // Some for buildings and depots
}
pub type Unit = Entity;                // Phase 1 name, kept for the Phase 1 tests

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ghost { pub kind: TypeId, pub owner: PlayerId, pub origin: Cell }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Projectile { pub owner: PlayerId, pub weapon: WeaponId, pub target: EntityId,
    pub impact: FxVec2, pub impact_tick: u32 }

pub struct Player {
    pub id: PlayerId,
    pub faction: FactionId,
    pub credits: u32,
    pub defeated: bool,
    pub(crate) power_produced: u32,                 // derived each economy phase, not hashed
    pub(crate) power_consumed: u32,
    pub(crate) explored: Vec<bool>,                 // per cell, row-major
    pub(crate) visible: Vec<bool>,                  // derived each vision phase, not hashed
    pub(crate) ghosts: std::collections::BTreeMap<EntityId, Ghost>,
}
impl Player {
    pub fn power(&self) -> (u32, u32);              // (produced, consumed)
    pub fn ghosts(&self) -> &std::collections::BTreeMap<EntityId, Ghost>;
}
```

`world.rs` re-exports `Order`, `Unit`, `EntityId` and `UnitId` (`= EntityId`) so
the Phase 1 imports keep compiling.

### 5.4 World API (`world.rs`)

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    Move { units: Vec<EntityId>, target: FxVec2 },          // Phase 1 shape
    Attack { units: Vec<EntityId>, target: EntityId },
    Harvest { units: Vec<EntityId>, depot: EntityId },
    Construct { dozer: EntityId, kind: TypeId, origin: Cell },
    Resume { units: Vec<EntityId>, building: EntityId },
    Produce { building: EntityId, kind: TypeId },
    Cancel { building: EntityId },
    Rally { building: EntityId, target: FxVec2 },
    Stop { units: Vec<EntityId> },
    DebugSpawn { kind: TypeId, pos: FxVec2 },
    DebugSetHp { entity: EntityId, hp: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SimError { TooManyUnits { requested: u32, max: u32 }, UnknownMap { id: String } }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome { Ongoing, Winner(PlayerId), Draw }

pub struct World {
    pub(crate) tick: u32,
    pub(crate) rules: Ruleset,
    pub(crate) terrain: MapGrid,
    pub(crate) nav: MapGrid,                        // terrain + building/depot footprints (derived)
    pub(crate) players: Vec<Player>,
    pub(crate) entities: Vec<Entity>,               // ascending id; removed entities leave gaps
    pub(crate) next_entity_id: u32,                 // starts at 0, never reused
    pub(crate) next_order_id: u32,                  // starts at 1
    pub(crate) projectiles: Vec<Projectile>,        // creation order
    pub(crate) pending: Vec<(PlayerId, Command)>,
    pub(crate) fields: BTreeMap<CellIndex, FlowField>,
    pub(crate) outcome: Outcome,
    pub(crate) victory_enabled: bool,
    pub(crate) debug_commands: bool,
}

impl World {
    // Phase 1 (unchanged behaviour): builtin rules, one player (id 0, faction 0,
    // credits 0), victory disabled. spawn_unit_at spawns a `tech-slice-placeholder`
    // owned by player 0. tech_slice keeps its exact Phase 1 spawn rules.
    pub fn new(map: MapGrid) -> World;
    pub fn tech_slice(seed: u64, unit_count: u32) -> Result<World, SimError>;
    pub fn spawn_unit_at(&mut self, pos: FxVec2) -> EntityId;
    pub fn enqueue(&mut self, command: Command);                       // == enqueue_as(0, command)

    // Phase 2 constructors and setup helpers (used by tests and by `skirmish`).
    /// Players 0..factions.len() with credits = rules.starting_credits; victory and
    /// debug commands disabled; nothing explored.
    pub fn sandbox(rules: Ruleset, map: MapGrid, factions: &[FactionId]) -> World;
    /// §5.6. `seed` is reserved for later phases and does not affect Phase 2 state.
    pub fn skirmish(rules: Ruleset, map_id: &str, seed: u64) -> Result<World, SimError>;
    /// Unit of `kind` (category Unit), order Idle { last_order_id: 0 }, hp = type hp.
    /// Panics if not a unit type, the cell is not nav-passable, or MAX_UNITS entities exist.
    pub fn spawn(&mut self, owner: PlayerId, kind: TypeId, pos: FxVec2) -> EntityId;
    /// Building (category Building). complete: hp = type hp, progress = build_ticks * 100;
    /// else hp = max(1, type hp / 10), progress 0. Panics unless footprint_free (§5.5).
    /// Rebuilds the nav grid (§5.5).
    pub fn place_building(&mut self, owner: PlayerId, kind: TypeId, origin: Cell, complete: bool) -> EntityId;
    /// Depot of rules.depot_type(), owner NEUTRAL, hp = amount, complete. Panics unless footprint_free.
    pub fn place_depot(&mut self, origin: Cell, amount: u32) -> EntityId;
    pub fn set_credits(&mut self, player: PlayerId, credits: u32);
    pub fn set_hp(&mut self, id: EntityId, hp: u32);                   // removal happens in the next deaths phase
    pub fn explore_all(&mut self, player: PlayerId);
    pub fn refresh_visibility(&mut self);                              // runs the vision phase now
    pub fn enable_victory(&mut self);
    pub fn enable_debug_commands(&mut self);

    pub fn enqueue_as(&mut self, player: PlayerId, command: Command);  // applied at the start of the next step
    pub fn step(&mut self);

    // Queries
    pub fn tick(&self) -> u32;
    pub fn rules(&self) -> &Ruleset;
    pub fn map(&self) -> &MapGrid;                 // navigation grid (terrain + footprints)
    pub fn terrain(&self) -> &MapGrid;
    pub fn players(&self) -> &[Player];
    pub fn player(&self, id: PlayerId) -> Option<&Player>;
    pub fn entities(&self) -> &[Entity];
    pub fn units(&self) -> &[Entity];              // == entities(); Phase 1 name
    pub fn entity(&self, id: EntityId) -> Option<&Entity>;   // binary search
    pub fn unit(&self, id: EntityId) -> Option<&Entity>;     // == entity(id)
    pub fn projectiles(&self) -> &[Projectile];
    pub fn outcome(&self) -> Outcome;
    pub fn next_entity_id(&self) -> u32;
    pub fn next_order_id(&self) -> u32;
    pub fn flow_field_count(&self) -> usize;
    /// 0 unexplored, 1 explored but not visible, 2 visible; OBSERVER (or any id
    /// without a player) -> 2. Out of bounds -> 0.
    pub fn fog(&self, player: PlayerId, cell: Cell) -> u8;
    /// Own entities and depots: true. OBSERVER: true. Units: their cell is visible.
    /// Buildings: any footprint cell visible.
    pub fn is_entity_visible(&self, player: PlayerId, id: EntityId) -> bool;
}
```

Phase 1 constants (`TICK_RATE_HZ`, `MAX_UNITS` = 2000 entities in total,
`UNIT_SPEED`, `SEPARATION_DISTANCE`, `MAX_SEPARATION_PUSH`, `ARRIVAL_CONTACT`)
stay in `world.rs`. A unit's speed is `fx_centi(type.speed_centi)`; the
placeholder speed 20 equals `UNIT_SPEED`.

### 5.5 Footprints and navigation (`nav.rs`)

```rust
/// Cells of the footprint in row-major order.
pub fn footprint_cells(origin: Cell, size: [u16; 2]) -> Vec<Cell>;
/// (origin.x * 65536 + w * 32768, origin.y * 65536 + h * 32768) raw.
pub fn footprint_center(origin: Cell, size: [u16; 2]) -> FxVec2;
/// Distance from pos to the rectangle [ox, ox + w] x [oy, oy + h] (tiles): the
/// clamped nearest point, then (pos - nearest).length(). Zero inside.
pub fn footprint_distance(pos: FxVec2, origin: Cell, size: [u16; 2]) -> Fx;
/// nav.nearest_passable(Cell { x: ox + w / 2, y: oy + h / 2 }) (integer division).
pub fn approach_cell(nav: &MapGrid, origin: Cell, size: [u16; 2]) -> Option<Cell>;
/// nav.nearest_passable(Cell { x: ox + w / 2, y: oy + h }).
pub fn exit_cell(nav: &MapGrid, origin: Cell, size: [u16; 2]) -> Option<Cell>;
```

* **Entity distance** (weapon range, splash, docking): to a unit,
  `(from - unit.pos).length()`; to a building or depot,
  `footprint_distance(from, origin, size)`.
* **footprint_free(origin, size)** (world-internal): every cell is in bounds and
  nav-passable, and no unit (any owner) has `cell_of(pos)` inside the footprint.
* **Nav rebuild:** `nav = terrain.clone()`, then every building and depot
  footprint cell is set blocked; `fields.clear()`; then every `Move` order whose
  `goal` is now blocked is remapped exactly like Phase 1 command step 2
  (`nearest_passable(goal)`; `None` makes the unit `Idle { last_order_id:
  order_id }`; otherwise `target = cell_center(found)`, `goal = found`). It runs
  right after each accepted `Construct` (so later commands of the same step see
  the site), in `place_building` / `place_depot`, and at the end of the deaths
  phase if a building was removed.
* **Goal of a moving order** (computed each tick in the movement phase):
  `Attack` on a unit → `cell_of(target.pos)`; `Attack` on a building, `Build`,
  `Harvest` in `ToDepot` / `ToCenter` → `approach_cell` of that footprint.
  Fields are computed on demand (`fields.entry(goal).or_insert_with(...)`).

### 5.6 Skirmish setup

`World::skirmish(rules, map_id, seed)`:

1. `rules.map(map_id)` or `Err(SimError::UnknownMap { id })`.
2. `terrain = MapGrid::open(width, height)`; every cell of every `blocked`
   rectangle (inclusive) is set blocked.
3. Player `i` for each `starts[i]`: faction `start.faction`, credits
   `starting_credits`.
4. Entities, ids from 0 in this order: every depot in map order
   (`place_depot`); then for each start in order: its faction's `hq` with
   `place_building(i, hq, start.hq, true)` and its faction's `dozer` with
   `spawn(i, dozer, (fx_centi(dozer_centi[0]), fx_centi(dozer_centi[1])))`.
5. `victory_enabled = true`, then `refresh_visibility()`.

### 5.7 Step

`World::step()` runs these phases in order, then `tick += 1`:

1. **Commands** (§5.8). If `outcome != Ongoing`, every pending command is
   discarded instead.
2. **Economy** (§5.9): power, construction, production, harvesting.
3. **Movement** (§5.10).
4. **Separation**: Phase 1 rule, applied to units only (buildings and depots
   neither push nor are pushed), against the nav grid.
5. **Contact arrival**: Phase 1 rule, `Move` orders only.
6. **Vision** (§5.12).
7. **Combat** (§5.11).
8. **Deaths**: remove every unit and building with `hp == 0` (depots with
   `hp == 0` stay as empty depots); rebuild nav if a building was removed.
9. **Memory**: last-seen buildings (§5.12).
10. **Victory** (§5.13).
11. **Cleanup**: drop flow fields whose goal was not used by any order during
    this step's movement phase and is not the goal of any `Move` order.

Entities are always processed in ascending id order; players in ascending id
order; projectiles in creation order. A command or order naming an id that
does not exist, or an entity of the wrong owner or category, is ignored.

### 5.8 Commands (issued by player `p`)

* `Move`: Phase 1 algorithm. Only units owned by `p` receive the order;
  buildings, depots and other players' entities are skipped.
* `Attack { units, target }`: valid if `target` exists, `hp > 0`, its owner is
  neither `p` nor `NEUTRAL`, and `is_entity_visible(p, target)`; consumes one
  order id; every listed unit owned by `p` with a weapon gets
  `Attack { order_id, target }`.
* `Harvest { units, depot }`: valid if `depot` is a depot; consumes one order
  id; every listed unit of `p` with `capacity > 0` gets `Harvest { order_id,
  depot, center: None, phase: ToDepot, timer: 0 }` (cargo kept).
* `Construct { dozer, kind, origin }`: valid iff `dozer` is a unit of `p` whose
  type `builds` contains `kind`; `kind` is a building whose `requires` are all
  met (p owns a complete building of each listed kind); `credits >= cost`;
  `footprint_free(origin, size)`; and every footprint cell is explored by `p`.
  Then `credits -= cost`, the building is created as
  `place_building(p, kind, origin, false)` (new id), nav is rebuilt, one order
  id is consumed and the dozer gets `Build { order_id, building }`.
* `Resume { units, building }`: valid if `building` is an incomplete building of
  `p`; consumes one order id; every listed unit of `p` whose type has non-empty
  `builds` gets `Build { order_id, building }`.
* `Produce { building, kind }`: valid iff `building` is a complete building of
  `p` whose `produces` contains `kind`, `kind`'s `requires` are met, the queue
  length is below `max_queue` and `credits >= cost`. Then `credits -= cost` and
  `QueueItem { kind, progress: 0 }` is appended.
* `Cancel { building }`: if `building` is a building of `p` with a non-empty
  queue, its last item is removed and its cost refunded.
* `Rally { building, target }`: if `building` is a building of `p` with
  non-empty `produces`, `rally = Some(target)` clamped like Phase 1 move step 1.
* `Stop { units }`: every listed unit of `p` becomes `Idle { last_order_id }`
  with the id of its current order (unchanged if already idle).
* `DebugSpawn { kind, pos }` and `DebugSetHp { entity, hp }`: ignored unless
  `debug_commands`. `DebugSpawn` spawns a unit of `kind` for `p` at `pos` if
  `kind` is a unit type, the cell is nav-passable and fewer than `MAX_UNITS`
  entities exist (ignores credits, prerequisites and fog). `DebugSetHp` sets the
  entity's hp (any owner).

### 5.9 Economy

For each player (ascending), `produced` = sum of positive `power` of its
complete buildings, `consumed` = sum of the absolute negative `power` of its
complete buildings; stored in the player. Its speed is
`production_speed_percent(produced, consumed, min, max)` (`economy.rs`):

```rust
/// 100 if produced >= consumed (including consumed == 0); otherwise
/// clamp(produced * 100 / consumed, min, max) with integer division.
pub fn production_speed_percent(produced: u32, consumed: u32, min: u32, max: u32) -> u32;
```

A player has a **power deficit** when `produced < consumed`.

* **Construction.** For each incomplete building `b`: if at least one unit of
  `b.owner` with `Build { building: b.id, .. }` is within `fx_centi(dock_range)`
  (entity distance, positions at the start of this phase), then
  `old = progress`, `progress = min(progress + speed, total)` with `total =
  build_ticks * 100`, and `hp += gain(progress) - gain(old)` where `gain(p) =
  (type hp - initial_hp) * p / total` (u64 intermediate) and `initial_hp =
  max(1, type hp / 10)`. At most one increment per building per tick. When
  `progress == total`: `complete = true`; every unit with `Build` on `b` becomes
  `Idle { last_order_id: order_id }`; if `free_unit >= 0`, a unit of that kind is
  spawned for the owner at the centre of `exit_cell` (skipped at `MAX_UNITS`);
  if it has `capacity > 0` and a depot with `hp > 0` exists, it gets
  `Harvest { new order_id, nearest depot, None, ToDepot, 0 }`.
* **Production.** For each complete building with a non-empty queue: the head
  gets `progress = min(progress + speed, total)`. When `progress == total` and
  fewer than `MAX_UNITS` entities exist and `exit_cell` is `Some`: pop the head,
  spawn the unit at the exit cell centre; if `rally` is `Some(t)`, the new unit
  immediately gets a `Move` to `t` (the Phase 1 command algorithm applied to that
  unit alone, consuming one order id); else if it has `capacity > 0`, it
  harvests the nearest depot as above. Otherwise the
  head waits at `total`.
* **Harvesting.** For each unit with a `Harvest` order (dock range = entity
  distance `<= fx_centi(dock_range)`):
  * `ToDepot`: if `depot` is gone or has `hp == 0`, set `depot` to the nearest
    depot with `hp > 0` (distance from the truck to the depot centre, ties
    lowest id); if none, `Idle { last_order_id: order_id }`. Else if docked at
    the depot: `phase = Loading`, `timer = load_ticks`.
  * `Loading`: `timer -= 1` (saturating); when it is 0: `take = min(capacity -
    cargo, depot.hp)` (0 if the depot is gone), `depot.hp -= take`, `cargo +=
    take`; then if `cargo > 0`, `phase = ToCenter`, `center = None`, else
    `phase = ToDepot`.
  * `ToCenter`: if `center` is `None` or not a complete drop-off building of the
    owner, set it to the nearest such building (distance to its centre, ties
    lowest id); if none exists, wait. Else if docked at the center:
    `phase = Unloading`, `timer = unload_ticks`.
  * `Unloading`: `timer -= 1`; when 0: `owner.credits += cargo` (saturating),
    `cargo = 0`, `phase = ToDepot`.

### 5.10 Movement

For each unit (ascending id), by order:

* `Idle`: nothing. `Move`: Phase 1 rule at the type's speed.
* `Attack`: if the target is gone, has `hp == 0` or `!is_entity_visible(owner,
  target)`: `Idle { last_order_id: order_id }`. Else if the entity distance to
  the target is `<=` the weapon range: no move. Else step toward the goal.
* `Build`: if the building is gone or complete: `Idle`. Else if docked (§5.9):
  no move. Else step toward the goal.
* `Harvest`: in `ToDepot` toward the depot and in `ToCenter` toward the center
  when it is `Some` and not docked; no move in `Loading` / `Unloading` or while
  waiting.

"Step toward the goal": if `cell_of(pos) == goal`, move toward
`cell_center(goal)` by `min(speed, distance)` (`pos = center` when within
`speed`); else follow `field.direction(cell)` at the type speed; if the
direction is `None`, the unit stays in place this tick (the order is kept).

### 5.11 Combat (`combat.rs`)

```rust
/// 0 if modifier_percent == 0; else max(1, base * modifier_percent / 100) (u64 intermediate).
pub fn damage_dealt(base: u32, modifier_percent: u32) -> u32;
```

1. `last_target = None` for every entity.
2. For each entity `a` with a weapon `w` (ascending id), skipping entities with
   `hp == 0`, incomplete buildings, and `requires_power` buildings whose owner
   has a power deficit:
   * if `cooldown > 0`, `cooldown -= 1`; if `cooldown` is still `> 0`, skip.
   * **Target.** If `a.order` is `Attack { target }` and `target` is a valid
     target in range, it is chosen. Otherwise the valid target in range with the
     smallest entity distance from `a.pos`, ties lowest id. A valid target exists,
     has `hp > 0`, an owner other than `a.owner` and `NEUTRAL`, is visible to
     `a.owner`, and `modifier(w.damage_type, target armor) > 0`; in range means
     `fx_centi(min_range) <= distance <= fx_centi(range)`.
   * **Fire.** If `projectile_ticks == 0`, apply the hit now. Else push
     `Projectile { owner, weapon, target, impact: target pos (buildings:
     footprint centre), impact_tick: tick + projectile_ticks }`. Then
     `cooldown = cooldown_ticks` and `last_target = Some(target)`.
3. Projectiles with `impact_tick == tick` (creation order) hit, then are
   removed.
4. **Hit.** `splash_centi == 0`: the target (if it still exists with
   `hp > 0`) loses `damage_dealt(damage, modifier)` (saturating). Else every
   entity with `hp > 0` whose owner is neither the shooter's owner nor `NEUTRAL`
   and whose entity distance from the impact point is `<= fx_centi(splash)`
   loses `damage_dealt(damage, modifier)` (no friendly fire). Instant splash
   uses the target's position as the impact point.

### 5.12 Vision and memory (`vision.rs`)

* **Vision phase.** For each player: `visible` is cleared; for every entity it
  owns with `sight_centi > 0`, every in-bounds cell whose centre `c` satisfies
  `(c - pos).x² + (c - pos).y² <= fx_centi(sight)²` (raw values squared in
  `i64`) becomes visible; then `explored |= visible`.
* **Memory phase.** For each player `p`: every building (not depot) owned by
  another player with a visible footprint cell is recorded as
  `ghosts[id] = Ghost { kind, owner, origin }`; then every ghost whose id no
  longer exists and which has a visible footprint cell is removed.

### 5.13 Victory

Only when `victory_enabled` and `outcome == Ongoing`: every non-defeated player
that owns no building (complete or not) becomes `defeated`. Then if exactly one
player is not defeated, `outcome = Winner(id)`; if none, `outcome = Draw`.

### 5.14 State hash v2 (`hash.rs`)

FNV-1a 64 (unchanged function) over this little-endian stream:

1. `tick: u32`, `next_order_id: u32`, `next_entity_id: u32`, outcome tag `u8`
   (0 Ongoing, 1 Winner, 2 Draw), winner `u8` (player id, 255 otherwise),
   `player_count: u32`.
2. Per player (ascending): `id: u8`, `faction: u8`, `credits: u32`,
   `defeated: u8`, `explored` packed as `ceil(cells / 8)` bytes (bit `i % 8`
   of byte `i / 8` is cell `i`), `ghost_count: u32`, then per ghost
   (ascending id): `id: u32`, `kind: u16`, `owner: u8`, `origin.x: i32`,
   `origin.y: i32`.
3. `entity_count: u32`, per entity (ascending): `id: u32`, `owner: u8`,
   `kind: u16`, `pos.x: i32`, `pos.y: i32`, `hp: u32`, `cooldown: u32`,
   `cargo: u32`, `last_target: u32` (`u32::MAX` if none), order, site.
   * Order: `Idle` → `0u8, last_order_id: u32`; `Move` → `1u8, order_id,
     target.x: i32, target.y: i32`; `Attack` → `2u8, order_id, target: u32`;
     `Harvest` → `3u8, order_id, depot: u32, center: u32 (u32::MAX if None),
     phase: u8 (0 ToDepot, 1 Loading, 2 ToCenter, 3 Unloading), timer: u32`;
     `Build` → `4u8, order_id, building: u32`.
   * Site: `0u8` if none; else `1u8, origin.x: i32, origin.y: i32,
     progress: u32, complete: u8, rally tag u8 (0 none / 1 then x: i32,
     y: i32), queue_len: u8`, then per item `kind: u16, progress: u32`.
4. `projectile_count: u32`, per projectile: `owner: u8`, `weapon: u16`,
   `target: u32`, `impact.x: i32`, `impact.y: i32`, `impact_tick: u32`.

Derived data (nav grid, flow fields, `visible`, power totals) and pending
commands are not hashed.

### 5.15 Match snapshot (`snapshot.rs`)

`encode_snapshot` (Phase 1 layout) is unchanged and lists every entity.

```rust
pub const MATCH_HEADER_LEN: usize = 8;
pub const ENTITY_STRIDE: usize = 9;
pub const QUEUE_STRIDE: usize = 12;    // 3 + QUEUE_SLOTS
pub const FLAG_MOVING: i32 = 1;               // unit with a non-Idle order
pub const FLAG_UNDER_CONSTRUCTION: i32 = 2;
pub const FLAG_GHOST: i32 = 4;
pub const FLAG_FIRED: i32 = 8;                // last_target is Some
pub const FLAG_POWERED_OFF: i32 = 16;         // requires_power and owner has a power deficit
pub fn encode_match_snapshot(world: &World, viewer: PlayerId) -> Vec<i32>;
pub fn encode_fog(world: &World, viewer: PlayerId) -> Vec<u8>;   // row-major World::fog values
```

A viewer that is not a player id is the observer. Layout:

* Header: `tick, viewer, credits, power_produced, power_consumed, outcome tag,
  winner (-1 if none), entity_count`. Observer: credits and power are 0.
* Entities, ascending id: every entity visible to the viewer
  (`is_entity_visible`), plus, for a player viewer, every ghost of that player
  whose id is not an existing visible entity. Per entity: `id, owner, kind,
  pos.x raw, pos.y raw, hp, flags, progress, target`. `progress`: incomplete
  building `progress * 1000 / total`, complete building or depot `1000`, unit
  `0`. `target`: `last_target` or `-1`. Ghost: owner, kind and footprint
  centre from the ghost, `hp -1`, `flags FLAG_GHOST`, `progress 0`, `target -1`.
* Queues: `queue_count`, then per building owned by the viewer with a
  non-empty queue (ascending id): `building_id, head progress * 1000 / total,
  queue_len, kind_0 .. kind_8` (missing slots `-1`). Observer: `0`.

### 5.16 WASM API v2 (`wasm_api.rs`)

Every Phase 1 method keeps its signature and behaviour. Additions:

```rust
#[wasm_bindgen]
impl Sim {
    /// World::skirmish(Ruleset::builtin(), map_id, u64::from(seed)); Err contains "unknown map".
    pub fn skirmish(seed: u32, map_id: &str) -> Result<Sim, String>;
    pub fn enable_debug_commands(&mut self);
    pub fn player_count(&self) -> u32;
    pub fn command_move_as(&mut self, player: u8, unit_ids: &[u32], x_raw: i32, y_raw: i32);
    pub fn command_attack(&mut self, player: u8, unit_ids: &[u32], target: u32);
    pub fn command_harvest(&mut self, player: u8, unit_ids: &[u32], depot: u32);
    pub fn command_construct(&mut self, player: u8, dozer: u32, kind: u16, origin_x: i32, origin_y: i32);
    pub fn command_resume(&mut self, player: u8, unit_ids: &[u32], building: u32);
    pub fn command_produce(&mut self, player: u8, building: u32, kind: u16);
    pub fn command_cancel(&mut self, player: u8, building: u32);
    pub fn command_rally(&mut self, player: u8, building: u32, x_raw: i32, y_raw: i32);
    pub fn command_stop(&mut self, player: u8, unit_ids: &[u32]);
    pub fn debug_spawn(&mut self, player: u8, kind: u16, x_raw: i32, y_raw: i32);
    pub fn debug_set_hp(&mut self, entity: u32, hp: u32);
    pub fn snapshot_for(&self, viewer: u8) -> Vec<i32>;     // encode_match_snapshot
    pub fn fog_for(&self, viewer: u8) -> Vec<u8>;           // encode_fog
}
```

Each `command_*` enqueues the matching `Command` for `player`; `debug_*`
enqueue `DebugSpawn` / `DebugSetHp` (`player` is ignored by `DebugSetHp`;
`debug_set_hp` enqueues it as player 0).

### 5.17 Headless match scripts (`crates/headless`)

`script.rs` gains:

```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchScript { pub seed: u32, pub map: String, pub ticks: u32, pub commands: Vec<MatchScriptCommand> }

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchScriptCommand { pub tick: u32, pub player: u8, pub command: ScriptOrder }

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ScriptOrder {
    Move { units: Vec<u32>, target: [i32; 2] },
    Attack { units: Vec<u32>, target: u32 },
    Harvest { units: Vec<u32>, depot: u32 },
    Construct { dozer: u32, kind: String, origin: [i32; 2] },
    Resume { units: Vec<u32>, building: u32 },
    Produce { building: u32, kind: String },
    Cancel { building: u32 },
    Rally { building: u32, target: [i32; 2] },
    Stop { units: Vec<u32> },
}

/// World::skirmish(Ruleset::builtin(), &map, seed); for t in 0..ticks: enqueue_as
/// (in file order) every command with tick == t, then step(). Returns the world.
/// Err("unknown type <id>") for an unknown kind, Err("unknown map: <id>").
pub fn run_match(script: &MatchScript) -> Result<sim::world::World, String>;
pub fn run_match_script(script: &MatchScript) -> Result<u64, String>;   // state_hash of run_match
```

`headless hash <path>`: the file is parsed as `serde_json::Value`; an object
with a `"map"` key is a `MatchScript`, otherwise a Phase 1 `Script`. Output and
exit codes are unchanged (errors exit 2).

Fixture `crates/sim/tests/fixtures/skirmish-script.json` (exact content; ids
follow §5.6 and creation order: depots 0..=5, HQs 6 and 8, dozers 7 and 9,
power plants 10 and 11, supply centers 12 and 13, free trucks 14 and 15,
barracks 16 and 17; ford target `(64.0, 32.0)`):

```json
{
  "seed": 7,
  "map": "first-line",
  "ticks": 3000,
  "commands": [
    { "tick": 0, "player": 0, "command": { "type": "construct", "dozer": 7, "kind": "ua-power-plant", "origin": [18, 64] } },
    { "tick": 0, "player": 1, "command": { "type": "construct", "dozer": 9, "kind": "ru-power-plant", "origin": [107, 61] } },
    { "tick": 200, "player": 0, "command": { "type": "construct", "dozer": 7, "kind": "ua-supply-center", "origin": [15, 55] } },
    { "tick": 200, "player": 1, "command": { "type": "construct", "dozer": 9, "kind": "ru-supply-center", "origin": [109, 70] } },
    { "tick": 600, "player": 0, "command": { "type": "construct", "dozer": 7, "kind": "ua-barracks", "origin": [12, 65] } },
    { "tick": 600, "player": 1, "command": { "type": "construct", "dozer": 9, "kind": "ru-barracks", "origin": [113, 60] } },
    { "tick": 900, "player": 0, "command": { "type": "rally", "building": 16, "target": [4194304, 2097152] } },
    { "tick": 900, "player": 1, "command": { "type": "rally", "building": 17, "target": [4194304, 2097152] } },
    { "tick": 900, "player": 0, "command": { "type": "produce", "building": 16, "kind": "ua-rifleman" } },
    { "tick": 900, "player": 0, "command": { "type": "produce", "building": 16, "kind": "ua-rifleman" } },
    { "tick": 900, "player": 0, "command": { "type": "produce", "building": 16, "kind": "ua-rifleman" } },
    { "tick": 900, "player": 1, "command": { "type": "produce", "building": 17, "kind": "ru-rifleman" } },
    { "tick": 900, "player": 1, "command": { "type": "produce", "building": 17, "kind": "ru-rifleman" } },
    { "tick": 900, "player": 1, "command": { "type": "produce", "building": 17, "kind": "ru-rifleman" } }
  ]
}
```

## 6. Client design (`client/`)

Code rules unchanged: no `switch`, no `enum`, dictionaries keyed by
discriminant, player-facing strings through `t()`.

### 6.1 Build wiring and ruleset (`client/src/rules.ts`)

* Alias `@data` → `../data/generated` in `client/vite.config.ts` and
  `client/vitest.config.ts`; `"@data/*": ["../data/generated/*"]` in
  `client/tsconfig.json` paths.

```ts
export interface TypeDef { id: string; faction: number; category: "unit" | "building" | "depot";
  armor: number; hp: number; sightCenti: number; cost: number; buildTicks: number; speedCenti: number;
  weapon: number; requires: number[]; produces: number[]; builds: number[]; footprint: [number, number];
  power: number; requiresPower: boolean; dropOff: boolean; capacity: number; loadTicks: number;
  unloadTicks: number; freeUnit: number; render: { size: [number, number, number] } }
export interface FactionDef { id: string; hq: number; dozer: number }
export interface Ruleset { maxQueue: number; types: TypeDef[]; factions: FactionDef[] /* other keys unused */ }
export const RULES: Ruleset;                       // the imported @data/ruleset.json
export function typeIndex(id: string): number;     // -1 if absent
export function typeDef(kind: number): TypeDef;    // throws RangeError out of range
export function typeName(kind: number): string;    // t(`type.${id}`)
export function factionName(faction: number): string;   // t(`faction.${id}`)
```

`client/src/i18n/en.json` adds `faction.ukraine` "Ukraine", `faction.russia`
"Russia", the UI keys of §6.6 and one `type.<id>` key per type:

| id | name | id | name |
|---|---|---|---|
| `tech-slice-placeholder` | Placeholder | `supply-depot` | Supply depot |
| `ua-rifleman` | Territorial Defense rifleman | `ru-rifleman` | Motor rifleman |
| `ua-stugna-team` | Stugna-P team | `ru-rpg-gunner` | RPG-7 gunner |
| `ua-kozak-scout` | Kozak-2 scout | `ru-brdm-scout` | BRDM-2 scout |
| `ua-bradley` | M2 Bradley | `ru-bmp-2` | BMP-2 |
| `ua-leopard-2a4` | Leopard 2A4 | `ru-t-72b3` | T-72B3 |
| `ua-himars` | HIMARS | `ru-tos-1a` | TOS-1A |
| `ua-dozer` | Engineering vehicle | `ru-dozer` | Engineering vehicle |
| `ua-supply-truck` | Supply truck | `ru-supply-truck` | Supply truck |
| `ua-hq` | Headquarters | `ru-hq` | Headquarters |
| `ua-power-plant` | Power plant | `ru-power-plant` | Power plant |
| `ua-supply-center` | Supply center | `ru-supply-center` | Supply center |
| `ua-barracks` | Barracks | `ru-barracks` | Barracks |
| `ua-vehicle-factory` | Vehicle factory | `ru-vehicle-factory` | Vehicle factory |
| `ua-defense` | Stugna-P emplacement | `ru-defense` | Kornet emplacement |

### 6.2 Match snapshot (`client/src/sim/matchSnapshot.ts`)

```ts
export const MATCH_HEADER_LEN = 8; export const ENTITY_STRIDE = 9;
export const QUEUE_SLOTS = 9; export const QUEUE_STRIDE = 12;
export const NEUTRAL = 255; export const OBSERVER = 255;
export const ENTITY_FLAGS = { moving: 1, underConstruction: 2, ghost: 4, fired: 8, poweredOff: 16 } as const;
export const OUTCOMES = ["ongoing", "winner", "draw"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export interface EntityState { id: number; owner: number; kind: number; x: number; y: number;  // tiles
  hp: number; flags: number; progress: number; target: number | null }                       // target -1 -> null
export interface QueueState { building: number; headPermille: number; items: number[] }      // -1 slots dropped
export interface MatchSnapshot { tick: number; viewer: number; credits: number; powerProduced: number;
  powerConsumed: number; outcome: Outcome; winner: number | null; entities: EntityState[]; queues: QueueState[] }
export function decodeMatchSnapshot(data: Int32Array): MatchSnapshot;
export function hasFlag(entity: EntityState, flag: number): boolean;
/** alpha clamped to [0, 1]; entities of `next` in order; an entity whose id is
 *  in `prev` gets its x/y interpolated, otherwise next's values; all other
 *  fields from next. */
export function interpolateEntities(prev: MatchSnapshot, next: MatchSnapshot, alpha: number): EntityState[];
```

### 6.3 Protocol, worker and skirmish client

`client/src/sim/protocol.ts` (Phase 1 messages unchanged, version 2):

```ts
export type SimCommand =
  | { kind: "move"; player: number; units: number[]; xRaw: number; yRaw: number }
  | { kind: "attack"; player: number; units: number[]; target: number }
  | { kind: "harvest"; player: number; units: number[]; depot: number }
  | { kind: "construct"; player: number; dozer: number; typeIndex: number; originX: number; originY: number }
  | { kind: "resume"; player: number; units: number[]; building: number }
  | { kind: "produce"; player: number; building: number; typeIndex: number }
  | { kind: "cancel"; player: number; building: number }
  | { kind: "rally"; player: number; building: number; xRaw: number; yRaw: number }
  | { kind: "stop"; player: number; units: number[] }
  | { kind: "debugSpawn"; player: number; typeIndex: number; xRaw: number; yRaw: number }
  | { kind: "debugSetHp"; entity: number; hp: number };
export type InitSkirmishMessage = { type: "initSkirmish"; seed: number; mapId: string; viewer: number; speed: number; debug: boolean };
export type CommandMessage = { type: "command"; command: SimCommand };
export type SetViewerMessage = { type: "setViewer"; viewer: number };
export type MainToWorker = InitMessage | MoveMessage | HashRequestMessage | InitSkirmishMessage | CommandMessage | SetViewerMessage;
export type SnapshotMessage = { type: "snapshot"; data: Int32Array; fog?: Uint8Array };
```

`client/src/sim/workerHandler.ts`:

```ts
export interface SkirmishSimLike {
  map_width(): number; map_height(): number; map_tiles(): Uint8Array; tick(): number; step(): void;
  state_hash_hex(): string; enable_debug_commands(): void;
  snapshot_for(viewer: number): Int32Array; fog_for(viewer: number): Uint8Array;
  command_move(unitIds: Uint32Array, xRaw: number, yRaw: number): void;
  command_move_as(player: number, unitIds: Uint32Array, xRaw: number, yRaw: number): void;
  command_attack(player: number, unitIds: Uint32Array, target: number): void;
  command_harvest(player: number, unitIds: Uint32Array, depot: number): void;
  command_construct(player: number, dozer: number, kind: number, originX: number, originY: number): void;
  command_resume(player: number, unitIds: Uint32Array, building: number): void;
  command_produce(player: number, building: number, kind: number): void;
  command_cancel(player: number, building: number): void;
  command_rally(player: number, building: number, xRaw: number, yRaw: number): void;
  command_stop(player: number, unitIds: Uint32Array): void;
  debug_spawn(player: number, kind: number, xRaw: number, yRaw: number): void;
  debug_set_hp(entity: number, hp: number): void;
}
export type SkirmishFactory = (seed: number, mapId: string) => SkirmishSimLike;
export function createWorkerHandler(factory: SimFactory, apiVersion: number, post: Post,
  skirmishFactory?: SkirmishFactory): WorkerHandler;
```

* `initSkirmish`: `skirmishFactory(seed, mapId)` (an absent factory or a throw
  posts `{ type: "error", detail }`); if `debug`, `enable_debug_commands()`;
  stores `viewer` and `speed` (clamped to `1..=8`, default 1); posts `ready`
  (`apiVersion`, size, `map_tiles()`) then one snapshot.
* Snapshots in skirmish mode: `{ type: "snapshot", data: snapshot_for(viewer),
  fog: fog_for(viewer) }` with both buffers in the transfer list.
* `command`: a constant dictionary keyed by `command.kind` calls the matching
  sim method (`move` → `command_move_as`, `debugSpawn` → `debug_spawn`, ...;
  unit lists as `Uint32Array.from`). Ignored before `initSkirmish`.
* `setViewer`: stores the viewer and posts one snapshot.
* `advance(nowMs)`: as Phase 1, but the accumulator grows by
  `max(0, nowMs - last) * speed` (speed 1 in tech-slice mode).
* `sim.worker.ts` passes `(seed, mapId) => Sim.skirmish(seed, mapId)` as the
  fourth argument.

`client/src/sim/skirmishClient.ts`:

```ts
export interface SkirmishClient {
  readonly ready: Promise<ReadyMessage>;           // same version check and errors as SimClient
  command(command: SimCommand): void;              // posts { type: "command", command }
  setViewer(viewer: number): void;                 // posts { type: "setViewer", viewer }
  requestHash(): Promise<string>;
  onSnapshot(listener: (snapshot: MatchSnapshot, fog: Uint8Array, receivedAtMs: number) => void): () => void;
}
export function createSkirmishClient(worker: WorkerLike,
  options: { seed: number; mapId: string; viewer: number; speed: number; debug: boolean },
  now?: () => number): SkirmishClient;            // posts initSkirmish immediately
```

`client/src/sim/matchScript.ts` (TypeScript twin of `run_match_script`):

```ts
export interface MatchScript { seed: number; map: string; ticks: number;
  commands: { tick: number; player: number; command: Record<string, unknown> & { type: string } }[] }
/** Same semantics as headless run_match_script on a sim created with
 *  Sim.skirmish(seed, map); kinds resolved with typeIndex; returns state_hash_hex(). */
export function runMatchScript(sim: SkirmishSimLike, script: MatchScript): string;
```

### 6.4 Rendering

`client/src/render/entities.ts`:

```ts
export const OWNER_COLORS = [0x2563eb, 0xdc2626] as const;
export const NEUTRAL_COLOR = 0x8b5a2b;
export const SELECTED_COLOR = 0xfacc15;
export const HEALTH_COLORS = { high: 0x22c55e, mid: 0xeab308, low: 0xef4444 } as const;  // > 50 %, > 25 %, else
export interface EntityRenderer {
  readonly group: Group;            // children: units, buildings, ghosts, bars (InstancedMesh), tracers (LineSegments)
  readonly units: InstancedMesh; readonly buildings: InstancedMesh; readonly ghosts: InstancedMesh;
  readonly bars: InstancedMesh; readonly tracers: LineSegments;
  update(entities: readonly EntityState[], selected: ReadonlySet<number>): void;
}
export function createEntityRenderer(capacity: number): EntityRenderer;
```

* All three body meshes use one `BoxGeometry(1, 1, 1)`; instance `i` of a mesh
  is the `i`-th entity of that group in input order. Units: scale
  `size / 100` (w, h, d), translation `(x, h / 2, y)`. Buildings and depots
  (non-ghost): scale `(w, h * f, d)` with `f = 0.2 + 0.8 * progress / 1000`
  when under construction, else `1`; translation `(x, h * f / 2, y)`. Ghosts:
  scale `(w, h, d)`, material `transparent: true, opacity: 0.4`.
* Colour: `SELECTED_COLOR` if selected, else `OWNER_COLORS[owner]`, depots
  `NEUTRAL_COLOR`.
* Bars: one `PlaneGeometry(1, 0.12)` instance per non-ghost, non-depot entity
  that is selected or has `hp < type hp`, above it at `y = h + 0.3`, x-scale
  `max(0.05, hp / type hp)`, colour from `HEALTH_COLORS`.
* Tracers: one segment from the shooter (height 0.5) to the target (height 0.5)
  for every entity with `fired` whose target is in the input.

`client/src/render/fog.ts`:

```ts
export const FOG_ALPHA = [255, 140, 0] as const;    // unexplored, explored, visible
/** 4 bytes per cell: 0, 0, 0, FOG_ALPHA[value]. */
export function fogRgba(fog: Uint8Array): Uint8Array;
/** One plane at y = 0.02 covering the map, DataTexture (NearestFilter),
 *  transparent, depthWrite false; update() uploads fogRgba(fog). */
export function createFogOverlay(width: number, height: number): { mesh: Mesh; update(fog: Uint8Array): void };
```

Draw calls in skirmish: terrain, units, buildings, ghosts, bars, tracers, fog,
placement ghost: at most 8.

Placement ghost (`app/skirmish.ts`): a unit `BoxGeometry` scaled to the
footprint, `MeshBasicMaterial` transparent at opacity `0.6`, white `0xffffff`
over a legal site and red `0xef4444` over an illegal one, so it stands out
from the green terrain (#136).

### 6.5 Input (`client/src/input/`)

`entitySelection.ts`:

```ts
/** Units (category unit) within CLICK_PICK_RADIUS_TILES first (nearest, ties
 *  lowest id); otherwise the lowest-id building, depot or ghost whose
 *  footprint rectangle [x - w/2, x + w/2] x [y - h/2, y + h/2] contains the
 *  point; otherwise null. */
export function pickEntity(entities: readonly EntityState[], x: number, y: number): number | null;
/** [id] if the picked entity is owned by player and not a ghost, else []. */
export function clickSelect(entities: readonly EntityState[], x: number, y: number, player: number): number[];
/** Ascending ids of units owned by player whose projected point is inside rect (edges inclusive). */
export function boxSelect(entities: readonly EntityState[], rect: ScreenRect,
  project: (x: number, y: number) => ScreenPoint, player: number): number[];
export function selectAllOwnUnits(entities: readonly EntityState[], player: number): number[];
```

`intent.ts`:

```ts
/** Commands for a right click at ground (x, y) tiles; xRaw/yRaw = toRaw. */
export function resolveRightClick(args: { player: number; selected: readonly number[];
  entities: readonly EntityState[]; x: number; y: number }): SimCommand[];
```

Rules, in order (selected ids not owned by `player` or missing are dropped
first):

1. Empty selection → `[]`.
2. A single building → `[rally]` if its type has `produces`, else `[]`.
3. Units (ascending). `t = pickEntity(entities, x, y)`, ignoring ghosts:
   * `t` owned by another player (not `NEUTRAL`): armed units (`weapon >= 0`)
     → `attack`; the rest → `move`.
   * `t` is a depot: units with `capacity > 0` → `harvest`; the rest → `move`.
   * `t` is an own building under construction: units with non-empty `builds`
     → `resume`; the rest → `move`.
   * Otherwise all → `move`.
   The special command comes first, then `move`; empty unit lists produce no
   command.

`placement.ts`:

```ts
/** Footprint centred on the cursor: { x: floor(gx - w / 2 + 0.5), y: floor(gy - h / 2 + 0.5) }. */
export function footprintOrigin(kind: number, gx: number, gy: number): { x: number; y: number };
/** Client-side prediction of the sim's Construct check (credits and prerequisites
 *  are handled by the command panel): in bounds, every tile passable (tiles 0),
 *  no overlap with any building, depot or ghost footprint in entities, no unit
 *  cell inside, every fog value >= 1. */
export function canPlace(args: { kind: number; origin: { x: number; y: number }; width: number;
  height: number; tiles: Uint8Array; fog: Uint8Array; entities: readonly EntityState[] }): boolean;
```

`skirmishController.ts` (E2E-covered): like the Phase 1 controller (pointer and
key wiring, pan, clamp) plus: left click → placement mode ? (`canPlace` →
`construct` with the lowest-id selected own dozer, then leave placement) :
`clickSelect`; left drag → `boxSelect`; right click → placement mode ?
leave placement : send `resolveRightClick`; `Escape` leaves placement;
`Ctrl/Meta+A` → `selectAllOwnUnits`; with `debug` only, `F2` toggles the
controlled player 0 ↔ 1 (clears selection, viewer follows unless revealed) and
`F3` toggles reveal (viewer `OBSERVER` ↔ controlled player); both call
`preventDefault`.

### 6.6 UI (`client/src/ui/`)

`commandPanel.ts`:

```ts
export interface CommandButton { typeIndex: number; label: string; cost: number; enabled: boolean;
  action: "construct" | "produce" }
/** selected: own entities currently selected. If any is a unit with non-empty
 *  builds, use the lowest-id one: its builds, action construct. Else if exactly
 *  one complete own building with non-empty produces is selected: its produces,
 *  action produce. Else []. enabled = credits >= cost && every requires kind is
 *  an own complete building in ownEntities && (produce: queue length <
 *  RULES.maxQueue). label = t("ui.buttonLabel", { name: typeName, cost }). */
export function commandButtons(args: { selected: readonly EntityState[]; ownEntities: readonly EntityState[];
  credits: number; queue: QueueState | null }): CommandButton[];
/** <div id="command-panel"> with one <button class="cmd" data-type="<type id>">
 *  per button (disabled attribute when not enabled), and, for a production
 *  building, <div id="queue"> with <span class="queue-item" data-type> per item
 *  and <progress id="queue-progress" max="1000">. Click → onConstruct /
 *  onProduce(typeIndex); contextmenu on a produce button → onCancel()
 *  (default prevented). */
export function createCommandPanel(root: HTMLElement, handlers: { onConstruct(kind: number): void;
  onProduce(kind: number): void; onCancel(): void }): { render(buttons: CommandButton[], queue: QueueState | null,
  placing?: number | null): void };
/** The construct button whose typeIndex equals placing (default null) has
 *  class "active" and aria-pressed="true"; every other button has no "active"
 *  class and aria-pressed="false". render runs every frame and only touches
 *  what changed: re-rendering the same input performs no DOM mutation, so a
 *  button is never detached or rewritten while the player presses it (#138). */
```

`placementHint.ts` (#136):

```ts
export type PlacementHintState = "hidden" | "legal" | "illegal";
/** <div id="placement-hint" role="status">, hidden for "hidden"; text
 *  t("ui.placementHint") for "legal" and t("ui.placementIllegal") for
 *  "illegal". The app renders "illegal" when the placement preview is
 *  illegal, "legal" in placement mode otherwise (also before the pointer
 *  reaches the map), "hidden" outside placement mode. */
export function createPlacementHint(root: HTMLElement): { render(state: PlacementHintState): void };
```

`resourceBar.ts`:

```ts
/** { credits: t("ui.credits", { credits }), power: t("ui.power", { produced, consumed }), low: produced < consumed } */
export function resourceText(snapshot: MatchSnapshot): { credits: string; power: string; low: boolean };
/** <div id="resource-bar"> with <span id="res-credits"> and <span id="res-power"> (class power-low when low). */
export function createResourceBar(root: HTMLElement): { render(snapshot: MatchSnapshot): void };
```

`outcome.ts`:

```ts
/** "Victory" if winner === player, "Defeat" if another winner, "Draw" for a draw, null while ongoing (via t()). */
export function outcomeText(snapshot: MatchSnapshot, player: number): string | null;
/** <div id="outcome" role="status">, hidden while null. */
export function createOutcomeOverlay(root: HTMLElement): { render(text: string | null): void };
```

i18n keys: `ui.credits` "Credits {credits}", `ui.power` "Power
{produced}/{consumed}", `ui.buttonLabel` "{name} ({cost})", `ui.victory`
"Victory", `ui.defeat` "Defeat", `ui.draw` "Draw", `hud.player` "Player
{player}: {faction}" (`player` 1-based), `ui.placementHint` "Left click on
the ground to build · right click or Esc to cancel", `ui.placementIllegal`
"Cannot build here".

`client/index.html` styles: `#resource-bar` fixed top centre; `#command-panel`
fixed bottom centre; `.cmd.active` highlighted (outline and background);
`#placement-hint` fixed top centre, below the resource bar; `#outcome` fixed centre, large text; `.cmd[disabled]`
dimmed; `.power-low` red. The HUD stays top-left and the perf panel top-right;
none overlap.

### 6.7 App, modes and debug API

* `client/src/main.ts` only dispatches on the `mode` URL parameter through
  `const modes = { "tech-slice": startTechSlice, skirmish: startSkirmish } as const`
  (absent or unknown → `skirmish`). `client/src/app/techSlice.ts` contains the
  Phase 1 app unchanged in behaviour (its debug API, perf panel and HUD).
* `client/src/app/skirmish.ts`: parameters `seed` (default 1), `map` (default
  `DEFAULT_MAP`), `debug=1`, `speed` (debug only, `1..=MAX_SPEED`); creates the
  worker and the skirmish client (viewer 0, controlled player 0), terrain, fog
  overlay, entity renderer, placement ghost, HUD (`#hud-selected`, `#hud-tick`,
  `#hud-player`), resource bar, command panel and outcome overlay; centres the
  camera on the controlled player's HQ from the first snapshot; renders
  `interpolateEntities` every frame; the perf panel as in Phase 1 when
  `debug=1`.
* `client/src/debug.ts` adds:

```ts
export interface SkirmishDebug {
  isReady(): boolean; mode(): "skirmish"; tick(): number;
  controlledPlayer(): number; viewer(): number;
  entities(): EntityState[];                       // latest snapshot, not interpolated
  entity(id: number): EntityState | null;
  typeIndex(id: string): number;
  fogAt(x: number, y: number): number;            // cell, latest fog
  credits(): number; power(): { produced: number; consumed: number };
  outcome(): { outcome: Outcome; winner: number | null };
  selectedIds(): number[];
  worldToScreen(x: number, y: number): { x: number; y: number };
  cameraTarget(): { x: number; y: number }; setCameraTarget(x: number, y: number): void;
  command(command: SimCommand): void;
  stateHash(): Promise<string>;
  drawCalls(): number; resetFrameStats(): void; frameStats(): { frames: number; p95FrameMs: number };
  injectFrameTimes(frameTimesMs: number[]): void; resumeFrameTimes(): void;
}
export function installSkirmishDebugApi(target: { __redline?: SkirmishDebug }, api: SkirmishDebug): void;
```

* Phase 1 E2E and perf tests now open `/?mode=tech-slice&debug=1...` (and
  `/?mode=tech-slice` for the no-debug check); their assertions are unchanged.

## 7. Acceptance criteria

"Test rules" means `Ruleset::from_json` of the fixture in §4.6. Unless stated,
sandbox worlds are `World::sandbox(test_rules, MapGrid::open(40, 24), &[0, 0])`
(players 0 and 1), positions are given in tiles (raw = tiles × 65536) and "after
step n" counts steps from the setup.

### Data

**AC-03-01 Builtin data is valid and current.** Given the repository, when
`buildRuleset(readSources(root))` runs, then `errors` is `[]` and
`serializeRuleset(ruleset)` equals the content of `data/generated/ruleset.json`;
and `node scripts/check-data.mjs` exits 0.

**AC-03-02 Schema violations.** Given in-memory sources equal to the builtin
ones except one change each, when `buildRuleset` runs, then `ruleset` is `null`
and `errors` contains an entry with `code "schema"`, the changed file and the
pointer: `hp: 0` on the first type of `data/factions/ukraine.yaml` →
`/types/0/hp`; `speedCenti: 1.5` there → `/types/0/speedCenti`; an extra key
`color: red` there → `/types/0`; a missing `startingCredits` in globals → `/`;
invalid YAML (`"id: [unclosed"`) → `code "parse"`.

**AC-03-03 Reference and semantic errors.** Same approach: weapon `nope` on
`ua-rifleman` → `unknown-reference` at `/types/0/weapon`; a second type with id
`ua-rifleman` in `russia.yaml` → `duplicate-id` at `/types/<index>/id`;
`requires: [ua-nope]` on `ua-barracks` → `unknown-reference`; `maxQueue: 10` →
`invalid-value` (or `schema`, either code accepted for this one); a depot at
`[127, 0]` in `first-line` (out of bounds) → `invalid-value`; a depot at
`[63, 10]` (river) → `invalid-value`.

**AC-03-04 Roster and map content.** Given the generated ruleset, then for each
of `ukraine` and `russia`: exactly 6 unit types with a weapon, 1 unit type with
non-empty `builds` (the faction dozer), 1 unit type with `capacity > 0`, and 6
building types: the faction HQ (produces the dozer), one with `power > 0`, one
with `dropOff` and `freeUnit` = the truck, one producing 2 infantry types, one
producing 4 vehicle types, and one with `requiresPower` and a weapon; every
`requires`, `produces` and `builds` entry stays inside the faction; and map
`first-line` is point-symmetric: for every cell `blocked(x, y) ==
blocked(127 - x, 127 - y)`, the depot set maps onto itself under origin
`(126 - ox, 126 - oy)` with equal amounts, and start 1 equals the mirror of
start 0 (HQ origin `(124 - ox, 124 - oy)`, dozer `(12800 - x, 12800 - y)`)
with the other faction.

### Ruleset in the simulation

**AC-03-05 Ruleset parsing.** Given the test rules, then they parse with 5
weapons, 13 types, 1 faction and 1 map; `type_index("tank") == Some(10)`,
`type_index("nope") == None`; `modifier(1, 0) == 50`; `depot_type() == 1`;
`fx_centi(500).raw() == 327680`, `fx_centi(150).raw() == 98304`,
`fx_centi(8).raw() == 5242`; `from_json("not json")` is `Err`; the fixture with
type 9 `"weapon": 9` is `Err` containing `weapon`; with `"maxQueue": 10` is
`Err` containing `maxQueue`; and `Ruleset::builtin()` has factions `ukraine`,
`russia`, map `first-line` and `type_index("ua-leopard-2a4").is_some()`.

**AC-03-06 Phase 1 compatibility.** Given `World::new(MapGrid::open(4, 4))`,
then it has one player (id 0, credits 0), `rules().ty(t).speed_centi == 20` for
`t = type_index("tech-slice-placeholder")`, `fx_centi(20) == UNIT_SPEED`, and a
unit from `spawn_unit_at` has that kind and owner 0. (Every Phase 1 test keeps
passing; AC-02-20's empty-world bytes are superseded by AC-03-08.)

### World core

**AC-03-07 Sandbox, ownership and per-type speed.** Given a sandbox on
`MapGrid::open(16, 16)` with `spawn(0, 9, (2.5, 2.5))` (id 0),
`spawn(1, 9, (12.5, 2.5))` (id 1) and `place_building(0, 3, (5, 5), true)`
(id 2), when `enqueue_as(1, Move { units: [0, 1, 2], target: (12.5, 12.5) })`
and one step run, then entity 0 is `Idle { last_order_id: 0 }`, entity 2 is
`Idle { last_order_id: 0 }`, entity 1 has a `Move` order with `order_id 1` and
raw position `(819200, 170393)` (soldier speed `fx_centi(10)` = 6553); entity 2
has hp 400 and a complete site at origin `(5, 5)` with position `(6.0, 6.0)`;
`next_entity_id() == 3`; and `enqueue(Move { units: [0], .. })` moves entity 0
(player 0).

**AC-03-08 State hash v2.** Given `World::new(MapGrid::open(4, 4))`, then
`state_hash` equals `fnv1a64` of these 39 bytes: `0,0,0,0, 1,0,0,0, 0,0,0,0, 0,
255, 1,0,0,0, 0, 0, 0,0,0,0, 0, 0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0`; and given the
same world with a unit from `spawn_unit_at((2.5, 2.5))` (owned by player 0),
the hash changes after one step with a pending `Move`, and two such worlds,
each built fresh and fed the same commands, have equal hashes after 100 steps
each.

**AC-03-09 Skirmish setup.** Given `World::skirmish(test_rules, "test-field",
1)`, then there are 2 players with credits 1000 and faction 0; entities are:
id 0 depot (kind 1, owner 255, hp 300, pos raw `(589824, 327680)`), id 1 depot
(pos raw `(2031616, 1245184)`), id 2 HQ of player 0 (kind 2, complete, hp 1000,
pos raw `(229376, 753664)`), id 3 dozer of player 0 (kind 7, pos raw
`(425984, 753664)`), id 4 HQ of player 1 (origin `(35, 11)`, pos raw
`(2392064, 819200)`), id 5 dozer of player 1 (pos raw `(2195456, 819200)`);
`next_entity_id() == 6`; `map()` blocks `(2, 10)`, `(4, 12)`, `(8, 4)`, `(9, 5)`
and `(19, 6)`, while `terrain()` blocks `(19, 6)` but not `(2, 10)` or `(8, 4)`;
`outcome() == Ongoing`; `fog(0, (3, 11)) == 2` and `fog(0, (36, 12)) == 0`; and
`World::skirmish(test_rules, "nope", 1)` is
`Err(SimError::UnknownMap { id: "nope".into() })`.

**AC-03-10 Footprint geometry.** `footprint_center((10, 10), [3, 2])` is raw
`(753664, 720896)`; `footprint_distance((9.5, 6.5), (10, 6), [2, 2])` is raw
`32768`, at `(13.0, 9.0)` raw `92681`, at `(11.0, 7.0)` `0`;
`footprint_cells((4, 4), [2, 2])` is `(4,4), (5,4), (4,5), (5,5)`; on
`MapGrid::open(16, 16)` with cells `x 4..=5, y 4..=5` blocked,
`approach_cell(nav, (4, 4), [2, 2]) == Some((6, 4))` and
`exit_cell(nav, (4, 4), [2, 2]) == Some((5, 6))`; with cells `x 10..=12,
y 10..=11` blocked on `MapGrid::open(32, 32)`,
`approach_cell(nav, (10, 10), [3, 2]) == Some((10, 12))`.

### Vision

**AC-03-11 Visibility and exploration.** Given
`World::sandbox(test_rules, MapGrid::open(40, 24), &[0, 0])` with
`spawn(0, 9, (10.5, 10.5))` (sight 6), when one step runs, then for player 0
cells `(16, 10)` and `(14, 14)` have fog 2, `(17, 10)` and `(15, 15)` fog 0,
`fog(OBSERVER, (0, 0)) == 2`; and after a move to `(30.5, 10.5)` and 220 more
steps, `fog(0, (5, 10)) == 1`, `fog(0, (30, 10)) == 2`, `fog(0, (0, 0)) == 0`.

**AC-03-12 Entity visibility.** Given the same sandbox
(`MapGrid::open(40, 24)`, factions `[0, 0]`) with `spawn(0, 9, (10.5, 10.5))`, player 1 dozers at `(14.5, 10.5)` (id 1) and `(25.5, 20.5)` (id 2) and
`place_building(1, 3, (30, 2), true)` (id 3), when one step runs, then
`is_entity_visible(0, 1)` is true, `(0, 2)` and `(0, 3)` are false,
`(1, 0)` is true (dozer 1 is 4 tiles from the soldier, sight 6),
`(OBSERVER, 2)` is true, and every entity is visible to its owner.

### Economy

**AC-03-13 Production speed.** `production_speed_percent(p, c, 25, 75)` is 100
for `(0, 0)`, `(10, 0)`, `(10, 10)`; 50 for `(10, 20)`; 25 for `(5, 20)`,
`(1, 20)` and `(0, 4)`; 75 for `(19, 20)`.

**AC-03-14 Power totals.** Given a sandbox with complete `power` (3) at
`(0, 0)`, complete `center` (4) at `(4, 0)`, complete `factory` (5) at
`(8, 0)` and an incomplete `turret` (6) at `(12, 0)` for player 0, when one step
runs, then `player(0).power() == (10, 8)` and `player(1).power() == (0, 0)`.

**AC-03-15 Production timing, payment and exit.** Given a sandbox with
complete `power` at `(0, 0)` and `factory` at `(10, 10)` for player 0 (credits
1000), when `Produce { factory, kind 9 }` is enqueued before step 1, then after
step 1 credits are 950 and the queue holds one item with progress 100; after
step 9 no soldier exists; after step 10 the queue is empty and a new entity
(id `next_entity_id` before the step) of kind 9, owner 0, hp 50,
`Idle { last_order_id: 0 }` is at raw `(753664, 884736)` (`exit_cell` `(11, 13)`).

**AC-03-16 Queue rules.** Same setup (`maxQueue` 3): four `Produce` soldier in
one step → queue length 3, credits 850; then `Cancel` → length 2, credits 900;
`Produce` of kind 7 (not produced there) is ignored; `Produce` on an incomplete
factory is ignored; `Produce` by player 1 on player 0's factory is ignored;
with credits set to 40 a soldier `Produce` is ignored; `Produce` tank (kind 10,
requires `center`) is ignored until a complete `center` of player 0 exists,
then accepted.

**AC-03-17 Low power slows production.** Given a sandbox with only a complete
`factory` at `(10, 10)` for player 0 (power 0/4 → speed 25), when a soldier is
produced from step 1, then no soldier exists after step 39 and one exists after
step 40.

**AC-03-18 Rally point.** Given the AC-03-15 setup with
`Rally { factory, (15.5, 20.5) }` and the `Produce` enqueued before step 1,
then after step 10 the soldier's order is `Move { order_id: 1, target: raw
(1015808, 1343488), goal: (15, 20) }`; and `Rally` on the `power` building
leaves its `site.rally` as `None`.

### Construction

**AC-03-19 Construction progress and hit points.** Given a sandbox where
player 0 has `explore_all`, a dozer (kind 7) at `(9.5, 6.5)`, when
`Construct { dozer, kind 3, origin (10, 6) }` is enqueued before step 1, then
after step 1 credits are 700, a new building of kind 3 exists, incomplete, with
progress 100 and hp 58, `map().is_passable((10, 6))` is false and the dozer is
`Build { order_id: 1, .. }`; after step 10 hp is 220; after step 19 it is still
incomplete; after step 20 it is complete with hp 400 and the dozer is
`Idle { last_order_id: 1 }`; and its power only counts from step 21
(`player(0).power()` is `(0, 0)` after step 20 and `(10, 0)` after step 21).

**AC-03-20 Placement validation.** Given the AC-03-19 setup on a map with cell
`(30, 5)` blocked, each of these single commands leaves credits at 1000, the
entity count unchanged and the dozer idle after one step: origin `(39, 5)` (out
of bounds); `(29, 4)` (covers `(30, 5)`); overlapping a complete `power`
placed at `(14, 6)` (origin `(15, 7)`); a soldier at `(25.5, 6.5)` and origin
`(25, 6)`; credits set to 299 (then credits stay 299); kind 2 (not in
`builds`); kind 5 (`factory`, requires `power`) with no `power`, and with only an
incomplete `power`; no `explore_all` (unexplored); the dozer owned by player 1
while player 0 commands; a soldier as builder. Two `Construct` commands of
player 0 in the same step, from the dozer and from a second dozer at
`(9.5, 8.5)`, at overlapping origins `(10, 6)` and `(11, 7)`: only the first is
accepted (credits 700).

**AC-03-21 Dozer travels to the site; sites block paths.** Given the AC-03-19
setup with the dozer at `(6.5, 6.5)` and origin `(20, 10)`, then the building is
complete within 200 steps; and a player 0 soldier spawned at `(15.5, 11.5)`
and ordered at step 2 to `(27.5, 11.5)` never has its cell inside `x 20..=21,
y 10..=11` and is idle within 400 steps.

**AC-03-22 Stop and resume.** Given the AC-03-19 setup plus a second dozer at
`(9.5, 7.5)`: after step 5 progress is 500; `Stop { [first dozer] }` before
step 6 keeps progress at 500 after step 10 (first dozer
`Idle { last_order_id: 1 }`); `Resume { [both dozers], building }` before
step 11 gives progress 600 after step 11 (one increment per tick), both dozers
`Build { order_id: 2, .. }`; the building is complete after step 25.
`Resume` on a complete building or on another player's building is ignored.

**AC-03-23 Free unit on completion.** Given the AC-03-19 setup followed by
`place_depot((20, 2), 300)` and `Construct` kind 4 (`center`) at origin `(10, 6)`,
then after step 30 the center is complete, credits are 600 and a truck (kind 8)
of player 0 exists at raw `(766771, 557056)` (spawned at the `exit_cell` `(11, 8)`
centre `(753664, 557056)` in the economy phase, then one step of speed 20 east
toward the depot in the same tick's movement phase) with
`Harvest { order_id: 2, depot: <depot id>, center: None, phase: ToDepot,
timer: 0 }`.

### Harvesting

**AC-03-24 Truck cycle.** Given a sandbox with a complete `center` of player 0
at `(10, 10)`, a depot at `(10, 13)` amount 250 and a truck of player 0 at
`(10.5, 12.5)` (docked at both), when `Harvest { [truck], depot }` is enqueued
before step 1, then: after step 1 the phase is `Loading` with timer 3; after
step 4 the truck carries 100 in `ToCenter` and the depot holds 150; after
step 5 `Unloading` with timer 2; after step 7 credits are 1100 and cargo 0;
after step 14 credits are 1200; after step 21 credits are 1250 and the depot
holds 0; after step 22 the truck is `Idle { last_order_id: 1 }`.

**AC-03-25 Depot exhaustion and sharing.** Given the AC-03-24 setup with the
depot amount 100 and a second depot at `(20, 13)` amount 500: after step 7
credits are 1100; after step 8 the order's depot is the second one; within 300
steps credits reach 1200 and the second depot holds 400. Given instead two
trucks at `(10.5, 12.5)` (lower id) and `(11.5, 12.5)` and a depot amount 150:
after step 4 they carry 100 and 50 and the depot is empty; after step 7 credits
are 1150.

### Combat

**AC-03-26 Damage formula.** `damage_dealt` gives 10 for `(10, 100)`, 0 for
`(10, 0)`, 5 for `(10, 50)`, 1 for `(1, 50)` and `(3, 33)`, 60 for `(40, 150)`.

**AC-03-27 Auto-targeting, cooldown and id order.** Given a sandbox with soldier
A of player 0 at `(10.5, 10.5)` (id 0) and soldier B of player 1 at
`(14.5, 10.5)` (id 1), when stepping, then after step 1 both have hp 40 and
`last_target` set to each other; after step 5 both still have hp 40; after
step 6 both have 30; after step 21 B is gone and A has hp 10 (A fires first in
id order and B, at hp 0, does not fire); after step 22 A's `last_target` is
`None`.

**AC-03-28 Zero modifiers are never targeted.** Given a player 0 soldier at
`(10.5, 10.5)` and a player 1 tank (kind 10) at `(14.5, 10.5)`, then after 21
steps the tank still has hp 200 and the soldier is gone (tank damage 20 at
steps 1, 11 and 21).

**AC-03-29 Range, minimum range and shared vision.** Soldiers of players 0 and
1 at `(10.5, 10.5)` and `(15.5, 10.5)` (exactly 5.0 tiles apart) both have hp 40
after step 1; with the second one at raw x `15.5 * 65536 + 1` both keep hp 50. A
player 0 mortar-unit (kind 11) at `(5.5, 10.5)` and a player 1 soldier at
`(7.5, 10.5)` (2.0 < min 3.0): no projectile after step 1; at `(8.5, 10.5)`
(exactly 3.0): one projectile after step 1. A complete player 0 `turret` at
`(10, 10)` with a complete `power` at `(0, 0)`, and a player 1 soldier at
`(16.5, 10.5)` (distance 6 ≤ range 7, beyond turret sight 5): hp 50 after 20
steps; with a player 0 dozer added at `(17.5, 10.5)`: hp 38 after step 1.

**AC-03-30 Attack order.** Given a player 0 tank at `(5.5, 5.5)` (id 0), a
player 0 dozer at `(22.5, 5.5)` (id 1, spotter) and a player 1 soldier at
`(25.5, 5.5)` (id 2), after `refresh_visibility()`, when
`enqueue_as(0, Attack { [0], 2 })` runs before step 1, then the tank has
`Attack { order_id: 1, target: 2 }` and moves east; after step 93 the soldier
has hp 50 and after step 94 hp 30 (tank x raw `1284468`); the tank's position
is unchanged between steps 95 and 100; after step 114 the soldier is gone;
after step 115 the tank is `Idle { last_order_id: 1 }`. An `Attack` on a
target not visible to the issuer, on an own entity or on a depot is ignored
(`next_order_id` unchanged).

**AC-03-31 Area projectiles.** Given a player 0 mortar-unit at `(5.5, 10.5)`,
player 1 soldiers B1 `(13.5, 10.5)`, B2 `(14.5, 10.5)`, B3 `(13.5, 12.5)` and a
player 0 dozer at `(13.5, 9.5)`, then after step 1 there is one projectile with
`impact_tick 4` and impact at B1's position; after step 4 all soldiers have hp
50; after step 5 B1 and B2 have hp 35, B3 50, the dozer 100, and there is no
projectile.

**AC-03-32 Guided projectiles.** Given a player 0 launcher (kind 12) at
`(5.5, 5.5)` and a player 1 soldier at `(11.5, 5.5)` ordered by player 1 to
`(11.5, 20.5)` before step 1, then after step 3 one projectile exists and the
soldier has hp 50; after step 4 it has hp 40 and no projectile exists. If the
soldier's hp is set to 0 after step 1, then after step 4 no entity was damaged
and no projectile exists.

**AC-03-33 Powered defenses.** Given complete `power` at `(0, 0)` and `turret`
at `(10, 10)` of player 0 and a player 1 soldier at `(14.5, 10.5)`, then after
step 1 the soldier has hp 38; with two more complete player 0 factories at
`(20, 0)` and `(24, 0)` (power 10/14), the soldier has hp 50 after 20 steps and
`player(0).power() == (10, 14)`.

### Deaths and victory

**AC-03-34 Deaths release cells; ids are not reused.** Given a sandbox with a
complete player 0 `power` at `(10, 6)` (id 0) and a soldier (id 1), when both
get hp 0 and one step runs, then `entities()` is empty, `map().is_passable((10,
6))` is true and the next `spawn` returns id 2.

**AC-03-35 Last-seen buildings.** Given a sandbox with a complete player 1
`power` at `(20, 10)` (id 0) and a player 0 dozer at `(16.5, 11.5)` (id 1),
then after step 1 `is_entity_visible(0, 0)` is true and `player(0).ghosts()`
holds entity 0 as `Ghost { kind: 3, owner: 1, origin: (20, 10) }`; after the
dozer moves to `(2.5, 11.5)` (80 steps) the entity is not visible and the ghost
remains; after `set_hp(0, 0)` and one step the entity is gone and the ghost
remains; after the dozer returns to `(16.5, 11.5)` (80 steps)
`player(0).ghosts()` is empty.

**AC-03-36 Victory and draw.** Given the test-field skirmish, when the player 1
HQ (id 4) gets hp 0 and one step runs, then player 1 is defeated (its dozer
still exists) and `outcome() == Winner(0)`; a later `Move` of player 0 is
discarded (`next_order_id` unchanged after the step). When instead both HQs get
hp 0 in the same step, `outcome() == Draw`. A sandbox world never changes its
outcome without `enable_victory()`.

### Snapshot, API and headless

**AC-03-37 Match snapshot layout.** Given `World::sandbox(test_rules,
MapGrid::open(8, 8), &[0])` with `place_building(0, 3, (0, 0), true)` (id 0) and
`spawn(0, 9, (5.5, 5.5))` (id 1), when one step runs, then
`encode_match_snapshot(world, 0)` is `[1, 0, 1000, 10, 0, 0, -1, 2, 0, 0, 3,
65536, 65536, 400, 0, 1000, -1, 1, 0, 9, 360448, 360448, 50, 0, 0, -1, 0]`.
In a second such world that also has a complete `factory` at `(4, 0)` (id 2)
and two soldier `Produce` commands before step 1, the last 9 values after
step 1 are `[1, 2, 100, 2, 9, 9, -1, -1, -1]`. In the AC-03-33 world with power
10/14, the turret's flags are `FLAG_POWERED_OFF`.

**AC-03-38 Fog encoding and filtering.** Given the AC-03-12 world, then
`encode_fog(world, 0)` has length 960 with value 2 at index `10 * 40 + 16`;
`encode_fog(world, OBSERVER)` is all 2; the player 0 snapshot lists entities
0 and 1 only; the observer snapshot lists all four with credits 0 and queue
count 0. In the AC-03-35 world after the dozer moved away, the player 0
snapshot lists entity 0 as `[0, 1, 3, 1376256, 720896, -1, 4, 0, -1]`.

**AC-03-39 WASM API v2 natively.** `Sim::skirmish(1, "first-line")` is `Ok`
with `player_count() == 2`, `unit_count() == 10`, `map_width() == 128`,
`snapshot_for(0)[1] == 0`, `snapshot_for(0)[2] == 5000`, `fog_for(0).len() ==
16384`; `Sim::skirmish(1, "nope")` is `Err` containing `unknown map`; after
`command_construct(0, 7, <ua-power-plant>, 18, 64)` and `step()`,
`snapshot_for(0)[2] == 4400`; `debug_spawn(0, <ua-rifleman>, ..)` has no effect
before `enable_debug_commands()` and spawns one entity after it;
`debug_set_hp(8, 0)` with debug enabled and one step makes
`snapshot_for(0)[5] == 1` and `[6] == 0` (winner player 0).

**AC-03-40 Headless match script CLI.** Given the built `headless` binary, when
run as `headless hash crates/sim/tests/fixtures/skirmish-script.json` twice,
then both runs exit 0 and print the same `^[0-9a-f]{16}\n$` line; and the Phase
1 fixture still prints its hash (unchanged CLI behaviour).

**AC-03-41 Skirmish fixture plays a short game.** Given the fixture, when
`run_match` executes it, then player 0 owns complete `ua-power-plant`,
`ua-supply-center` and `ua-barracks` and at least one `ua-supply-truck`;
player 1 owns the `ru-` equivalents; player 0 credits are at least 2400 and
player 1 credits at least 2460 (at least one delivery each); fewer than 6
riflemen of both sides remain (they fought at the ford); and `outcome()` is
`Ongoing`.

**AC-03-42 Native vs WASM skirmish parity.** Given the fixture, when run through
the WASM build (`runMatchScript` in Node) and through `headless hash`, then both
hashes are identical.

### Client units

**AC-03-43 Client ruleset and names.** `typeIndex("ua-rifleman")` equals the
index of that id in `RULES.types`; `typeIndex("nope") === -1`;
`typeDef(-1)` throws `RangeError`; `typeName(typeIndex("ru-t-72b3")) ===
"T-72B3"`; every type id has a `type.<id>` key and every faction a
`faction.<id>` key in `en.json` with a non-empty value.

**AC-03-44 Match snapshot decoding.** Given the AC-03-37 vector,
`decodeMatchSnapshot` returns `{ tick: 1, viewer: 0, credits: 1000,
powerProduced: 10, powerConsumed: 0, outcome: "ongoing", winner: null, entities:
[{ id: 0, owner: 0, kind: 3, x: 1, y: 1, hp: 400, flags: 0, progress: 1000,
target: null }, { id: 1, owner: 0, kind: 9, x: 5.5, y: 5.5, hp: 50, flags: 0,
progress: 0, target: null }], queues: [] }`; a header with outcome 1 and winner
1 decodes to `"winner"` / `1`; the queue section `[1, 7, 100, 2, 9, 9, -1, -1,
-1]` decodes to `[{ building: 7, headPermille: 100, items: [9, 9] }]`;
`hasFlag` reads `ENTITY_FLAGS`.

**AC-03-45 Entity interpolation.** Given prev entities id 1 `(0, 0)` and id 4
`(2, 2)` and next entities id 4 `(4, 2)` and id 7 `(1, 1)`, then
`interpolateEntities` with alpha `0.5` yields id 4 at `(3, 2)` then id 7 at
`(1, 1)`; alpha `-1` yields id 4 at `(2, 2)`; alpha `3` yields id 4 at `(4, 2)`.

**AC-03-46 Worker skirmish handling.** Given a fake `SkirmishSimLike`
(map 2x2), when `handle({ type: "initSkirmish", seed: 3, mapId: "m", viewer: 1,
speed: 2, debug: true })`, then the skirmish factory got `(3, "m")`,
`enable_debug_commands` was called once, and `post` received `ready` then a
snapshot whose `data` and `fog` come from `snapshot_for(1)` / `fog_for(1)`
with both buffers transferred; `advance(0)` steps 0 times, `advance(50)` once
and `advance(90)` once more (speed 2); a `command` message of each `kind` calls
the matching method with the documented arguments (`units` as `Uint32Array`);
`setViewer(0)` posts one snapshot from `snapshot_for(0)`; without a skirmish
factory `initSkirmish` posts an `error` message; a `command` before init does
nothing.

**AC-03-47 Skirmish client.** Given a fake `WorkerLike`, `createSkirmishClient`
posts `initSkirmish` with the options; `ready` resolves on a version-2 `ready`
and rejects with `api version mismatch: expected 2, got 3` otherwise;
`command(c)` posts `{ type: "command", command: c }`; `setViewer(1)` posts
`{ type: "setViewer", viewer: 1 }`; snapshot listeners receive the decoded
`MatchSnapshot`, the fog bytes and `now()`.

**AC-03-48 Entity picking and selection.** Given entities: own rifleman id 2 at
`(1, 1)`, enemy rifleman id 3 at `(1.3, 1)`, own `ua-power-plant` id 5 at
`(10.5, 10.5)` and a depot id 0 at `(20, 20)`: `pickEntity(e, 1.1, 1)` is 2,
`(1.25, 1)` is 3, `(9.2, 9.2)` is 5, `(20.9, 20.9)` is 0, `(5, 5)` is null;
`clickSelect` at `(1.1, 1)` for player 0 is `[2]`, at `(1.25, 1)` is `[]`, at
`(10, 10)` is `[5]`; `boxSelect` with an identity projection over
`[0, 0]–[30, 30]` for player 0 is `[2]`; `selectAllOwnUnits(e, 0)` is `[2]`.

**AC-03-49 Right-click intents.** Given own `ua-dozer` 7 at `(5, 5)`, `ua-rifleman` 20
at `(6, 5)` and `ua-supply-truck` 21 at `(7, 5)` selected by player 0, an enemy
`ru-rifleman` 30 at `(40, 40)`, a depot 0 centred at `(13, 55)`, and an own
incomplete `ua-barracks` 16 centred at `(13.5, 66.5)`: right click on 30 →
`[attack { units [20], target 30 }, move { units [7, 21] }]`; on the depot →
`[harvest { units [21], depot 0 }, move { units [7, 20] }]`; on 16 →
`[resume { units [7], building 16 }, move { units [20, 21] }]`; on empty ground
`(30, 30)` → `[move { units [7, 20, 21], xRaw: 1966080, yRaw: 1966080 }]`; with
only a complete own `ua-barracks` selected → `[rally]`; only an own
`ua-power-plant` → `[]`; an enemy ghost under the cursor → plain `move`; an
empty selection → `[]`. Every command carries `player: 0`.

**AC-03-50 Placement predictor.** `footprintOrigin(<ua-power-plant>, 19.5,
65.5)` is `(18, 64)` and `footprintOrigin(<ua-defense>, 10.7, 4.2)` is
`(10, 3)`. On an 8 x 8 map with tile `(6, 6)` blocked, fog 2 everywhere except
`(0, 0)` = 0, and `ua-defense` (2 x 2): origin `(2, 2)` is placeable; `(7, 2)`
(out of bounds), `(5, 5)` (blocked tile), `(0, 0)` (unexplored), an origin
overlapping an entity building or ghost footprint, and an origin containing a
unit's cell are not.

**AC-03-51 Command buttons.** With the builtin rules: a selected own `ua-dozer`,
credits 700 and an own complete `ua-power-plant` give buttons
`ua-power-plant, ua-supply-center, ua-barracks, ua-vehicle-factory, ua-defense`
(action `construct`) with `enabled` `true, false, true, false, false` and label
`"Power plant (600)"` first; a selected own complete `ua-barracks` with credits
5000 gives `ua-rifleman, ua-stugna-team` (action `produce`) enabled, and both
disabled with a queue of length 9; an under-construction barracks or an enemy
entity gives `[]`.

**AC-03-52 Resource bar and outcome text.** `resourceText` for credits 4400 and
power 10/8 is `{ credits: "Credits 4400", power: "Power 10/8", low: false }`
and for 10/12 has `low: true`; `outcomeText` is `"Victory"` for winner 0 /
player 0, `"Defeat"` for winner 0 / player 1, `"Draw"` for a draw and `null`
while ongoing.

**AC-03-53 Fog texture.** `fogRgba(Uint8Array [0, 1, 2])` is
`[0, 0, 0, 255, 0, 0, 0, 140, 0, 0, 0, 0]`; `createFogOverlay(4, 2)` returns a
mesh whose texture is 4 x 2.

**AC-03-54 Entity renderer.** `createEntityRenderer(100)` after `update` with
an own `ua-rifleman` at `(1, 2)`, a selected enemy `ru-rifleman` at `(3, 4)`
(`fired`, target the first), an own complete `ua-power-plant`, an own
`ua-barracks` under construction at progress 500 and hp 10, a `ru-hq` ghost and
a depot (all other hp at the type maximum) gives: `units.count === 2` with instance 0 coloured `OWNER_COLORS[0]`,
instance 1 `SELECTED_COLOR`, instance 0 translation `(1, 0.3, 2)` and scale
`(0.3, 0.6, 0.3)`; `buildings.count === 3` with the barracks scale y
`0.9 * 0.6`; `ghosts.count === 1`; `bars.count === 2` (the selected enemy and
the damaged barracks); `tracers` has 2 vertices.

### End to end (Playwright, skirmish)

`client/tests/e2e/skirmish.spec.ts`; "boot" means opening the URL and waiting
for `isReady()` (10 s).

**AC-03-55 Skirmish boot.** Given `/?debug=1`, then `mode()` is `"skirmish"`,
`entities()` contains an owner-0 `ua-hq` and `ua-dozer` and no owner-1
entity, `fogAt(14, 62) === 2`, `fogAt(113, 65) === 0`, `#res-credits` reads
`Credits 5000`, `#res-power` reads `Power 0/0`, `#hud-player` reads
`Player 1: Ukraine`, and `tick()` increases over 1 s.

**AC-03-56 Build through the UI.** Given `/?debug=1&speed=4`, when the user
clicks the dozer, then `#command-panel button[data-type="ua-power-plant"]` is
enabled; when they click it and then click the ground at `worldToScreen(19.5,
65.5)`, then within 2 s an owner-0 `ua-power-plant` with `underConstruction`
exists and `#res-credits` reads `Credits 4400`; within 30 s it is complete and
`#res-power` reads `Power 10/0`. Right click while placing cancels placement
(no second building after another ground click).

**AC-03-57 Produce and cancel through the UI.** Given `/?debug=1&speed=1` and,
via `command`, a power plant at `(18, 64)` then (once complete) a barracks at
`(12, 65)`, once the barracks is complete, when the user clicks it, then the
panel shows `ua-rifleman` and `ua-stugna-team`; two clicks on `ua-rifleman`
make `#queue .queue-item` count 2 and credits 3700; a right click on that button
makes the count 1 and credits 3800; within 20 s an owner-0 `ua-rifleman` exists.
Speed 1, unlike the other UI criteria: a `ua-rifleman` takes 75 ticks
(1.25 s at speed 4), and production advances on the worker clock while the
test drives the page, so at speed 4 the queue head could finish between the
produce clicks and the right click.

**AC-03-58 Harvest.** Given `/?debug=1&speed=4` and, via `command`, a
`ua-supply-center` at `(15, 55)`, then within 30 s an owner-0 `ua-supply-truck`
exists, and within 30 s after that `credits()` exceeds its value at that
moment.

**AC-03-59 Attack through right click.** Given `/?debug=1&speed=4` and, via
`debugSpawn`, an owner-0 `ua-kozak-scout` at `(30.5, 62.5)`, an owner-0
`ua-leopard-2a4` at `(30.5, 64.5)` and an owner-1 `ru-t-72b3` at
`(40.5, 62.5)`, when the user selects the Leopard by clicking it and right
clicks the T-72, then within 2 s the Leopard has the `moving` flag, and within
30 s the T-72 no longer exists while the Leopard does.

**AC-03-60 Hot-seat and reveal.** Given `/?debug=1`, when the user presses
`F2`, then `controlledPlayer()` is 1, `#hud-player` reads `Player 2: Russia`,
`#res-credits` reads `Credits 5000` and `entities()` contains an owner-1
`ru-hq` and no owner-0 entity; when they press `F3`, `viewer()` is 255 and
`entities()` contains both HQs; `F3` again makes `viewer()` 1. Without
`debug=1`, `F2` does nothing.

**AC-03-61 Victory overlay.** Given `/?debug=1`, when `command({ kind:
"debugSetHp", entity: 8, hp: 0 })` is sent, then within 5 s `#outcome` reads
`Victory`; after `F2` it reads `Defeat`.

**AC-03-62 Draw calls.** Given `/?debug=1` with 150 owner-0 and 150 owner-1
riflemen spawned (owner 0 on `x 20..=34, y 20..=29`, owner 1 on `x 93..=107,
y 98..=107`, cell centres) and `F3` pressed, then `drawCalls()` is between 1
and `MAX_DRAW_CALLS_SKIRMISH` (8) inclusive.

**AC-03-63 Skirmish frame time (`@perf`, reference machine only).** Given
`/?debug=1` in the `perf` project with 200 owner-0 `ua-rifleman` on
`x 40..=59, y 2..=11` and 200 owner-1 `ru-rifleman` on `x 40..=59, y 14..=23`
(cell centres), every owner-0 unit ordered to `(50.5, 18.5)` and every owner-1
unit to `(50.5, 6.5)`, `F3` pressed and the camera centred on `(50, 12)`, when
`resetFrameStats()` is called, then after 300 frames `frameStats().p95FrameMs
<= 19`.

**AC-03-64 Placement feedback (#136).** Given `/?debug=1&speed=4` with the
owner-0 `ua-dozer` selected by a click, when the `ua-power-plant` button is
clicked, then it has `aria-pressed="true"` and class `active` and
`#placement-hint` is visible, and with the pointer over the legal site
`(19.5, 65.5)` its text is `ui.placementHint`; with the pointer
over the HQ centre, `#placement-hint` shows `ui.placementIllegal`; after
`Escape`, `#placement-hint` is hidden and the button has
`aria-pressed="false"`.

**AC-03-65 Stable command panel (#138).** Given `/?debug=1&speed=4` with the
owner-0 `ua-dozer` selected by a click, when a `MutationObserver` watches
`#command-panel` (child list, subtree, attributes, character data) for 500 ms,
then it records 0 mutations; and when the mouse is pressed on the
`ua-power-plant` button, held for 200 ms and released, then the button has
`aria-pressed="true"`.

### Updated Phase 1 criteria

* AC-01-05: the API version is now `2` (`ac_01_05_api_version_is_one` asserts
  `2`; the client mismatch test uses versions 2 and 3; the headless banner and
  the `lib.rs` skeleton test read `v2` / `2`).
* AC-02-20: the empty-world byte vector is superseded by AC-03-08; the FNV
  reference values and "the hash changes after a step" remain.
* AC-02-38..46: the URLs gain `mode=tech-slice`; nothing else changes.

These test edits are part of the RED commits of P2-05 and P2-23 (tier S).

## 8. Traceability

| Criterion | Test file | Test name |
|---|---|---|
| AC-03-01 | `scripts/build-data.test.mjs` | `AC-03-01: builtin data is valid and the generated ruleset is current` |
| AC-03-02 | `scripts/build-data.test.mjs` | `AC-03-02: reports schema violations with file and pointer` |
| AC-03-03 | `scripts/build-data.test.mjs` | `AC-03-03: reports reference and semantic errors` |
| AC-03-04 | `scripts/build-data.test.mjs` | `AC-03-04: rosters and the first-line map follow the design` |
| AC-03-05 | `crates/sim/tests/rules.rs` | `ac_03_05_ruleset_parsing` |
| AC-03-06 | `crates/sim/tests/rules.rs` | `ac_03_06_phase1_compatibility` |
| AC-03-07 | `crates/sim/tests/world.rs` | `ac_03_07_sandbox_ownership_and_speed` |
| AC-03-08 | `crates/sim/tests/determinism.rs` | `ac_03_08_state_hash_v2` |
| AC-03-09 | `crates/sim/tests/world.rs` | `ac_03_09_skirmish_setup` |
| AC-03-10 | `crates/sim/tests/nav.rs` | `ac_03_10_footprint_geometry` |
| AC-03-11 | `crates/sim/tests/vision.rs` | `ac_03_11_visibility_and_exploration` |
| AC-03-12 | `crates/sim/tests/vision.rs` | `ac_03_12_entity_visibility` |
| AC-03-13 | `crates/sim/tests/economy.rs` | `ac_03_13_production_speed` |
| AC-03-14 | `crates/sim/tests/economy.rs` | `ac_03_14_power_totals` |
| AC-03-15 | `crates/sim/tests/economy.rs` | `ac_03_15_production_timing_payment_and_exit` |
| AC-03-16 | `crates/sim/tests/economy.rs` | `ac_03_16_queue_rules` |
| AC-03-17 | `crates/sim/tests/economy.rs` | `ac_03_17_low_power_slows_production` |
| AC-03-18 | `crates/sim/tests/economy.rs` | `ac_03_18_rally_point` |
| AC-03-19 | `crates/sim/tests/construction.rs` | `ac_03_19_construction_progress_and_hit_points` |
| AC-03-20 | `crates/sim/tests/construction.rs` | `ac_03_20_placement_validation` |
| AC-03-21 | `crates/sim/tests/construction.rs` | `ac_03_21_dozer_travels_to_the_site_and_sites_block_paths` |
| AC-03-22 | `crates/sim/tests/construction.rs` | `ac_03_22_stop_and_resume` |
| AC-03-23 | `crates/sim/tests/construction.rs` | `ac_03_23_free_unit_on_completion` |
| AC-03-24 | `crates/sim/tests/harvest.rs` | `ac_03_24_truck_cycle` |
| AC-03-25 | `crates/sim/tests/harvest.rs` | `ac_03_25_depot_exhaustion_and_sharing` |
| AC-03-26 | `crates/sim/tests/combat.rs` | `ac_03_26_damage_formula` |
| AC-03-27 | `crates/sim/tests/combat.rs` | `ac_03_27_auto_targeting_cooldown_and_id_order` |
| AC-03-28 | `crates/sim/tests/combat.rs` | `ac_03_28_zero_modifiers_are_never_targeted` |
| AC-03-29 | `crates/sim/tests/combat.rs` | `ac_03_29_range_min_range_and_shared_vision` |
| AC-03-30 | `crates/sim/tests/combat.rs` | `ac_03_30_attack_order` |
| AC-03-31 | `crates/sim/tests/combat.rs` | `ac_03_31_area_projectiles` |
| AC-03-32 | `crates/sim/tests/combat.rs` | `ac_03_32_guided_projectiles` |
| AC-03-33 | `crates/sim/tests/combat.rs` | `ac_03_33_powered_defenses` |
| AC-03-34 | `crates/sim/tests/world.rs` | `ac_03_34_deaths_release_cells` |
| AC-03-35 | `crates/sim/tests/vision.rs` | `ac_03_35_last_seen_buildings` |
| AC-03-36 | `crates/sim/tests/world.rs` | `ac_03_36_victory_and_draw` |
| AC-03-37 | `crates/sim/tests/determinism.rs` | `ac_03_37_match_snapshot_layout` |
| AC-03-38 | `crates/sim/tests/vision.rs` | `ac_03_38_fog_encoding_and_filtering` |
| AC-03-39 | `crates/sim/tests/wasm_api.rs` | `ac_03_39_wasm_api_v2_natively` |
| AC-03-40 | `crates/headless/tests/cli.rs` | `ac_03_40_match_script_cli` |
| AC-03-41 | `crates/headless/tests/match_script.rs` | `ac_03_41_skirmish_fixture_plays_a_short_game` |
| AC-03-42 | `client/src/sim/matchParity.test.ts` | `AC-03-42: native and WASM skirmish hashes are identical` |
| AC-03-43 | `client/src/rules.test.ts` | `AC-03-43: exposes the ruleset and type names` |
| AC-03-44 | `client/src/sim/matchSnapshot.test.ts` | `AC-03-44: decodes a match snapshot` |
| AC-03-45 | `client/src/sim/matchSnapshot.test.ts` | `AC-03-45: interpolates entities by id` |
| AC-03-46 | `client/src/sim/workerHandler.test.ts` | `AC-03-46: runs a skirmish, commands and speed` |
| AC-03-47 | `client/src/sim/skirmishClient.test.ts` | `AC-03-47: wraps the skirmish protocol` |
| AC-03-48 | `client/src/input/entitySelection.test.ts` | `AC-03-48: picks entities and selects own units` |
| AC-03-49 | `client/src/input/intent.test.ts` | `AC-03-49: resolves right-click intents` |
| AC-03-50 | `client/src/input/placement.test.ts` | `AC-03-50: predicts building placement` |
| AC-03-51 | `client/src/ui/commandPanel.test.ts` | `AC-03-51: lists construct and produce buttons` |
| AC-03-52 | `client/src/ui/resourceBar.test.ts` | `AC-03-52: formats resources and the outcome` |
| AC-03-53 | `client/src/render/fog.test.ts` | `AC-03-53: builds the fog texture` |
| AC-03-54 | `client/src/render/entities.test.ts` | `AC-03-54: renders entities, bars and tracers` |
| AC-03-55 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-55: boots a skirmish with fog` |
| AC-03-56 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-56: builds a power plant through the UI` |
| AC-03-57 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-57: produces and cancels through the UI` |
| AC-03-58 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-58: harvests supplies` |
| AC-03-59 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-59: attacks with a right click` |
| AC-03-60 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-60: switches player and reveals the map` |
| AC-03-61 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-61: shows victory and defeat` |
| AC-03-62 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-62: renders a skirmish in at most 8 draw calls` |
| AC-03-63 | `client/tests/e2e/perf.spec.ts` | `AC-03-63: keeps 60 fps in a 400-unit skirmish @perf` |
| AC-03-64 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-64: shows placement feedback` |
| AC-03-65 | `client/tests/e2e/skirmish.spec.ts` | `AC-03-65: keeps the command panel stable under a held click` |

## 9. Issue breakdown (Phase 2 queue)

Opened as issues #55..#79 (label `phase:2` plus tier and area, blocked-by
relationships set in GitHub). For each issue, the tier S author first
commits the failing tests listed in §8 for its criteria (RED, D-08); the
implementer then makes them pass without touching them. Estimated sizes exclude
those tests.

| ID | Issue | Title | Criteria | Files allowed (production) | Est. lines | Tier | Area | Depends on |
|---|---|---|---|---|---|---|---|
| P2-01 | #55 | Data schemas and build/check scripts | AC-03-02, 03 | `data/schema/*.schema.json`, `scripts/{build-data,check-data}.mjs`, `package.json`, `package-lock.json`, `.github/workflows/ci.yml` | 280 | ready-pro | area:data | — |
| P2-02 | #56 | Builtin rules and the first-line map | AC-03-01, 04 | `data/rules/globals.yaml`, `data/factions/{ukraine,russia}.yaml`, `data/maps/first-line.yaml`, `data/generated/ruleset.json` | 300 (data) | ready-local | area:data | P2-01 |
| P2-03 | #57 | Ruleset parsing in the simulation | AC-03-05 | `crates/sim/src/{rules,lib}.rs`, `crates/sim/Cargo.toml`, `Cargo.lock` | 200 | ready-local | area:sim | P2-02 |
| P2-04 | #58 | Entities, players and Phase 1 compatibility | AC-03-06 | `crates/sim/src/{entity,player,world,lib,hash,snapshot,wasm_api}.rs` | 300 | ready-pro | area:sim | P2-03 |
| P2-05 | #59 | State hash v2 and API version 2 | AC-03-08, AC-01-05 | `crates/sim/src/{hash,lib}.rs`, `crates/headless/src/main.rs`, `client/src/sim/protocol.ts` | 150 | ready-local | area:sim | P2-04 |
| P2-06 | #60 | Footprints, navigation grid, sandbox buildings and ownership | AC-03-07, 10 | `crates/sim/src/{nav,world,lib}.rs` | 200 | ready-local | area:sim | P2-05 |
| P2-07 | #61 | Visibility and exploration | AC-03-11, 12 | `crates/sim/src/{vision,world,player,lib}.rs` | 180 | ready-local | area:sim | P2-06 |
| P2-08 | #62 | Skirmish setup | AC-03-09 | `crates/sim/src/world.rs` | 120 | ready-local | area:sim | P2-07 |
| P2-09 | #63 | Power and production | AC-03-13..18 | `crates/sim/src/{economy,world,lib}.rs` | 280 | ready-pro | area:sim | P2-08 |
| P2-10 | #64 | Construction by dozers | AC-03-19..23 | `crates/sim/src/{economy,world}.rs` | 290 | ready-pro | area:sim | P2-09 |
| P2-11 | #65 | Harvesting | AC-03-24, 25 | `crates/sim/src/{economy,world}.rs` | 220 | ready-pro | area:sim | P2-10 |
| P2-12 | #66 | Weapons, targeting and attack orders | AC-03-26..30 | `crates/sim/src/{combat,world,lib}.rs` | 290 | ready-pro | area:sim | P2-11 |
| P2-13 | #67 | Projectiles, splash and powered defenses | AC-03-31..33 | `crates/sim/src/combat.rs` | 180 | ready-pro | area:sim | P2-12 |
| P2-14 | #68 | Deaths, last-seen buildings and victory | AC-03-34..36 | `crates/sim/src/{world,vision}.rs` | 200 | ready-pro | area:sim | P2-13 |
| P2-15 | #69 | Match snapshot and fog encoding | AC-03-37, 38 | `crates/sim/src/snapshot.rs` | 150 | ready-local | area:sim | P2-14 |
| P2-16 | #70 | WASM API v2 | AC-03-39 | `crates/sim/src/wasm_api.rs` | 200 | ready-local | area:sim | P2-15 |
| P2-17 | #71 | Headless match scripts and the skirmish fixture | AC-03-40, 41 | `crates/headless/src/{main,script}.rs` | 180 | ready-pro | area:sim | P2-16 |
| P2-18 | #72 | Client ruleset, type names and match snapshots | AC-03-43..45 | `client/src/rules.ts`, `client/src/sim/matchSnapshot.ts`, `client/src/i18n/en.json`, `client/{vite,vitest}.config.ts`, `client/tsconfig.json` | 220 | ready-local | area:client | P2-02 |
| P2-19 | #73 | Skirmish worker protocol, client and WASM parity | AC-03-46, 47, 42 | `client/src/sim/{protocol,workerHandler,sim.worker,skirmishClient,matchScript}.ts` | 290 | ready-pro | area:client | P2-17, P2-18 |
| P2-20 | #74 | Entity and fog renderers | AC-03-53, 54 | `client/src/render/{entities,fog}.ts` | 280 | ready-pro | area:client | P2-18 |
| P2-21 | #75 | Entity selection, right-click intents and placement predictor | AC-03-48..50 | `client/src/input/{entitySelection,intent,placement}.ts` | 220 | ready-local | area:client | P2-19 |
| P2-22 | #76 | Command panel, resource bar and outcome overlay | AC-03-51, 52 | `client/src/ui/{commandPanel,resourceBar,outcome}.ts`, `client/src/i18n/en.json` | 220 | ready-local | area:client | P2-18 |
| P2-23 | #77 | Skirmish app, debug API, hot-seat and victory | AC-03-55, 60, 61, AC-02-38..46 URL update | `client/src/main.ts`, `client/src/app/{techSlice,skirmish}.ts`, `client/src/{debug,hud}.ts`, `client/index.html`, `client/src/i18n/en.json` | 300 | ready-pro | area:client | P2-19, P2-20, P2-22 |
| P2-24 | #78 | Skirmish controller, placement and panel wiring | AC-03-56..59 | `client/src/input/skirmishController.ts`, `client/src/app/skirmish.ts`, `client/index.html` | 280 | ready-pro | area:client | P2-21, P2-23 |
| P2-25 | #79 | Skirmish performance | AC-03-62, 63 | `client/src/app/skirmish.ts`, `client/src/render/{entities,fog}.ts` | 60 | ready-pro | area:client | P2-24 |

Every issue's "Done when" is `node --run verify` green (P2-25 additionally
`node --run test:perf` green on the reference machine, reported in the PR).
Files forbidden in every issue: tests and fixtures written in the spec phase,
`AGENTS.md`, `.agents/skills/`, `specs/`, `docs/decisions.md`.
