# 05 — Phase 3 computer AI and tournaments

Status: proposed for owner review (written for the 2026-10-10 overnight run).
Depends on `03-phase2-core-loop.md` and `04-obstacle-approach-and-separation-settling.md`.
Roadmap: Phase 3. Decisions: `docs/decisions.md` D-04 (balance), D-06
(data-driven RA2-style AI), D-10 (Phase 2 rules the AI plays by).

## 1. Context

Phase 3 adds a computer opponent and headless bot-vs-bot tournaments. Following
D-06 the AI is data-driven like Red Alert 2's `ai.ini`: each **personality** is
a YAML file with a build order, task forces (named unit mixes) and weighted
triggers that pick the next task force. The behaviour code is a small fixed
set of rules that read the personality; balance and style live in data.

The AI plays by the same rules as a human: it only acts through `Command`s
(enqueued with `World::enqueue_as`), it never reads hidden enemy state (only
entities `World::is_entity_visible` reports for its player, its own ghosts, and
the public map start positions), and it never gets extra credits.

**Exit criterion of Phase 3:** every criterion below passes in CI, and the owner
can open the preview build, start a skirmish as Ukraine, and watch the Russian
AI build a base, harvest, produce units and attack; a tournament report for
Ukraine vs Russia across the four builtin personalities is committed under
`docs/balance/`.

## 2. Scope

In:

* `data/`: AI personality schema and four builtin personalities, assembled into
  the generated ruleset.
* `crates/sim`: AI definitions in `Ruleset`, `World::can_construct`, module
  `ai.rs` (economy, build order, production, attack, defense), `step_with_ai`.
* `crates/headless`: `match` and `tournament` subcommands with JSON reports.
* `crates/sim` WASM API v3 and `client/`: AI opponent in skirmish mode.
* A first balance report and data tuning.

Out (later): influence maps (D-06 "improved with influence maps" is Phase 3.5),
difficulty levels (added later, see §9), scouting logic, retreat (§9 adds
it for Hard and Brutal), AI using artillery minimum range
smartly, multiple AIs per team, AI chat/taunts, expansion to remote depots by
building new supply centers.

## 3. Constants

| Name | Value | Location |
|---|---|---|
| `AI_THINK_INTERVAL` | `15` ticks (1 s) | `crates/sim/src/ai.rs` |
| `BASE_RING_MIN` | `3` | `crates/sim/src/ai.rs` |
| `BASE_RING_MAX` | `24` | `crates/sim/src/ai.rs` |
| `API_VERSION` / `EXPECTED_API_VERSION` | `3` | `crates/sim/src/lib.rs`, `client/src/sim/protocol.ts` |
| Ruleset `formatVersion` | stays `1` (`ai` is a new optional field) | |

## 4. Data

### 4.1 Source format (`data/ai/<id>.yaml`)

`data/rules/globals.yaml` gains a required list `ai: [<id>, ...]` (file order of
`data/ai/<id>.yaml`, like `factions` and `maps`). Each file is validated by
`data/schema/ai.schema.json` (draft 2020-12, `additionalProperties: false`):

```yaml
id: ukraine-balanced          # required, equals the file name
faction: ukraine              # required, a faction id
harvesters: 3                 # required, 0..20: supply trucks to keep
defenseRadiusCenti: 2000      # required, 0..12800
buildOrder: [ua-power-plant, ua-supply-center, ua-barracks]   # required, >= 1 item
taskForces:                   # required, >= 1 item
  - id: rifles                # required, unique within the file
    units: { ua-rifleman: 4, ua-stugna-team: 2 }   # required, >= 1 entry, counts 1..20
triggers:                     # required, >= 1 item
  - { taskForce: rifles, weight: 60, minTick: 0 }  # weight 1..1000, minTick >= 0
```

Semantic checks in `scripts/build-data.mjs` (errors name the file and field,
same style as the existing checks): `faction` exists; every `buildOrder` item is
a building type of that faction listed in its dozer's `builds`; every
`taskForces[].units` key is a `unit` type of that faction with a weapon and is
produced by some building of that faction; every `triggers[].taskForce` names a
task force of the file.

### 4.2 Generated ruleset

`ruleset.json` gains a top-level `ai` array (after `maps`), one object per file
in `globals.ai` order:

```json
{ "id": "ukraine-balanced", "faction": 0, "harvesters": 3,
  "defenseRadiusCenti": 2000, "buildOrder": [9, 10, 11],
  "taskForces": [{ "id": "rifles", "units": [[0, 4], [1, 2]] }],
  "triggers": [{ "taskForce": 0, "weight": 60, "minTick": 0 }] }
```

Type references become type indices, `faction` the faction index, `taskForce`
the index in `taskForces`; `units` pairs keep YAML key order.

### 4.3 Builtin personalities

| id | faction | style |
|---|---|---|
| `ukraine-balanced` | ukraine | full base, mixed forces, attacks from ~4 min |
| `ukraine-rush` | ukraine | barracks first, small infantry/scout waves from ~2 min |
| `russia-balanced` | russia | full base, mixed forces, attacks from ~4 min |
| `russia-rush` | russia | barracks first, cheap infantry/BRDM waves from ~2 min |

Starting contents for P3-01. The balance issue (P3-09) tunes them; AC-05-01 checks
the assembly against the sources, not these numbers, and AC-05-03 keeps
`ukraine-balanced`'s first build item and first task force.

```yaml
# data/ai/ukraine-balanced.yaml
id: ukraine-balanced
faction: ukraine
harvesters: 3
defenseRadiusCenti: 2000
buildOrder: [ua-power-plant, ua-supply-center, ua-barracks, ua-power-plant, ua-vehicle-factory, ua-defense, ua-power-plant, ua-defense]
taskForces:
  - { id: infantry, units: { ua-rifleman: 4, ua-stugna-team: 2 } }
  - { id: mechanized, units: { ua-bradley: 2, ua-rifleman: 3 } }
  - { id: armor, units: { ua-leopard-2a4: 2, ua-bradley: 1 } }
  - { id: fires, units: { ua-himars: 1, ua-leopard-2a4: 1, ua-stugna-team: 2 } }
triggers:
  - { taskForce: infantry, weight: 50, minTick: 0 }
  - { taskForce: mechanized, weight: 40, minTick: 2700 }
  - { taskForce: armor, weight: 40, minTick: 4500 }
  - { taskForce: fires, weight: 20, minTick: 6300 }
```

```yaml
# data/ai/ukraine-rush.yaml
id: ukraine-rush
faction: ukraine
harvesters: 2
defenseRadiusCenti: 1500
buildOrder: [ua-power-plant, ua-barracks, ua-supply-center, ua-vehicle-factory, ua-power-plant]
taskForces:
  - { id: rifles, units: { ua-rifleman: 5 } }
  - { id: raid, units: { ua-kozak-scout: 2, ua-rifleman: 2 } }
  - { id: hunters, units: { ua-stugna-team: 2, ua-kozak-scout: 1 } }
triggers:
  - { taskForce: rifles, weight: 60, minTick: 0 }
  - { taskForce: raid, weight: 50, minTick: 1800 }
  - { taskForce: hunters, weight: 30, minTick: 2700 }
```

```yaml
# data/ai/russia-balanced.yaml
id: russia-balanced
faction: russia
harvesters: 3
defenseRadiusCenti: 2000
buildOrder: [ru-power-plant, ru-supply-center, ru-barracks, ru-power-plant, ru-vehicle-factory, ru-defense, ru-power-plant, ru-defense]
taskForces:
  - { id: infantry, units: { ru-rifleman: 6, ru-rpg-gunner: 2 } }
  - { id: mechanized, units: { ru-bmp-2: 2, ru-rifleman: 4 } }
  - { id: armor, units: { ru-t-72b3: 3, ru-bmp-2: 1 } }
  - { id: fires, units: { ru-tos-1a: 1, ru-t-72b3: 2 } }
triggers:
  - { taskForce: infantry, weight: 50, minTick: 0 }
  - { taskForce: mechanized, weight: 40, minTick: 2700 }
  - { taskForce: armor, weight: 40, minTick: 4500 }
  - { taskForce: fires, weight: 20, minTick: 6300 }
```

```yaml
# data/ai/russia-rush.yaml
id: russia-rush
faction: russia
harvesters: 2
defenseRadiusCenti: 1500
buildOrder: [ru-power-plant, ru-barracks, ru-supply-center, ru-vehicle-factory, ru-power-plant]
taskForces:
  - { id: rifles, units: { ru-rifleman: 6 } }
  - { id: raid, units: { ru-brdm-scout: 2, ru-rifleman: 3 } }
  - { id: hunters, units: { ru-rpg-gunner: 3, ru-brdm-scout: 1 } }
triggers:
  - { taskForce: rifles, weight: 60, minTick: 0 }
  - { taskForce: raid, weight: 50, minTick: 1800 }
  - { taskForce: hunters, weight: 30, minTick: 2700 }
```

## 5. Simulation (`crates/sim`)

### 5.1 Ruleset (`rules.rs`)

```rust
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskForceDef { pub id: String, pub units: Vec<(TypeId, u32)> }

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TriggerDef { pub task_force: u16, pub weight: u32, pub min_tick: u32 }

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiDef {
    pub id: String,
    pub faction: FactionId,
    pub harvesters: u32,
    pub defense_radius_centi: u32,
    pub build_order: Vec<TypeId>,
    pub task_forces: Vec<TaskForceDef>,
    pub triggers: Vec<TriggerDef>,
}
```

`Ruleset` gains `#[serde(default)] pub ai: Vec<AiDef>` and
`pub fn ai_index(&self, id: &str) -> Option<usize>` (first match). Validation
errors (exact strings, `i`/`j` are indices): `ai[i].faction out of range`,
`ai[i].buildOrder[j] out of range` (index out of range or not a building),
`ai[i].taskForces[j].units out of range` (a kind out of range or not a unit, or
a count of 0), `ai[i].triggers[j].taskForce out of range`,
`ai[i].triggers[j].weight out of range` (0).

### 5.2 `World::can_construct`

```rust
/// True when `player` could place `kind` at `origin` right now: `kind` is a
/// building, the player exists and has `credits >= cost`, its `requires` are
/// met, the footprint is free (`footprint_free`) and fully explored by `player`.
pub fn can_construct(&self, player: PlayerId, kind: TypeId, origin: Cell) -> bool
```

`apply_construct` must call it for those checks (behaviour unchanged).

### 5.3 Module `ai.rs`

```rust
pub const AI_THINK_INTERVAL: u32 = 15;
pub const BASE_RING_MIN: i32 = 3;
pub const BASE_RING_MAX: i32 = 24;

pub struct Ai { /* private: player, personality index, rng, force, attackers */ }

impl Ai {
    /// Errors: `unknown personality <id>`, `unknown player <p>`,
    /// `personality <id> is for faction <f>, player <p> plays <g>` (faction ids
    /// as strings). The rng is `SplitMix64::new(seed ^ u64::from(player))`.
    pub fn new(world: &World, player: PlayerId, personality: &str, seed: u64) -> Result<Ai, String>;
    pub fn player(&self) -> PlayerId;
    /// One decision pass; returns commands in the order of §5.4. Returns no
    /// commands when the player is defeated or the outcome is not `Ongoing`.
    pub fn think(&mut self, world: &World) -> Vec<Command>;
}

/// When `world.tick() % AI_THINK_INTERVAL == 0`, each AI in slice order thinks
/// and its commands are enqueued with `enqueue_as(ai.player(), ..)`; then
/// `world.step()` runs once.
pub fn step_with_ai(world: &mut World, ais: &mut [Ai]);
```

Definitions used below (all for the AI's player `p`, faction `f`):

* *own* entity: `owner == p`. *Complete* building: `site.complete`.
* *dozer kind*: `factions[f].dozer`. *Truck kind*: first type of faction `f`
  (ruleset order) with `capacity > 0`. *Power kind*: first building type of
  faction `f` with `power > 0`. *HQ*: lowest-id own complete building of kind
  `factions[f].hq`; *anchor* = its `site.origin`, or, with no HQ, the origin of
  the lowest-id own building; with no own building the AI does nothing.
* *Combat unit*: own entity of category `Unit` with a weapon whose kind is not
  the dozer or truck kind.
* *queued(k)*: number of queue items of kind `k` over all own buildings.
* *producer of k*: own complete building whose type `produces` contains `k`
  and whose queue has fewer than `rules.max_queue` items; when several, the one
  with the shortest queue, ties lowest id.
* *budget*: starts at the player's credits; every `Produce`/`Construct` the
  pass emits subtracts the cost, and a command is emitted only when
  `budget >= cost`.
* *dist²*: squared fixed-point distance; ties always go to the lowest id.
* *pool*: combat units not in `attackers`. `attackers` is pruned of ids that no
  longer exist at the start of each pass.

### 5.4 Decision pass (in this order)

1. **Harvest.** For each own truck (id order) whose order is `Idle`:
   `Harvest { units: [truck], depot }` with the depot (category `Depot`,
   `hp > 0`) of least dist² from the truck. No depot left: nothing.
2. **Trucks.** If `count(truck kind) + queued(truck kind) < harvesters` and a
   producer of the truck kind exists: one `Produce` of the truck kind there.
3. **Dozer.** If `count(dozer kind) + queued(dozer kind) == 0` and a producer
   exists: one `Produce` of the dozer kind.
4. **Build.** Let `dozer` be the lowest-id own dozer whose order is `Idle`; if
   none, skip.
   * If an own incomplete building exists that no own dozer has an
     `Order::Build` for: `Resume { units: [dozer], building }` for the lowest-id
     one, and skip the rest of this step.
   * Else if an own incomplete building exists, skip (one site at a time).
   * Next entry: the first index `i` of `build_order` such that the number of
     own buildings (complete or not) of kind `build_order[i]` is lower than the
     number of occurrences of that kind in `build_order[0..=i]`. None: skip.
   * Power substitution: if the entry's `power < 0` and
     `produced - consumed + power < 0` (`Player::power()`, signed), build the
     power kind instead.
   * If `budget >= cost`: find the site (§5.5); if found emit
     `Construct { dozer, kind, origin }`.
5. **Defense.** *Threats*: enemy (owner not `p`, not `NEUTRAL`) entities of
   category `Unit` visible to `p` whose dist² to the footprint center of some
   own building is `<= defenseRadiusCenti²` (in fixed point,
   `fx_centi(radius)`). If any: let `t` be the threat of least dist² to the
   anchor's footprint center; emit `Attack { units, target: t }` with every pool
   unit whose order is not `Attack` (ascending ids, omit when empty), and skip
   steps 6–7.
6. **Production.** If `force` is `None`: eligible triggers have
   `min_tick <= tick`; `W` = sum of their weights; if `W > 0`, roll
   `r = rng.next_u64() % W` and take the first eligible trigger (file order)
   whose cumulative weight exceeds `r`; `force = Some(its task force)`. Then for
   each `(kind, count)` of the force in order: `missing = count − (pool units of
   kind + queued(kind))`, saturating; emit up to `missing` `Produce` at the
   producer of `kind` (re-evaluating the producer after each one), stopping the
   whole step at the first one the budget or producers cannot cover.
7. **Launch.** If `force` is `Some` and for every `(kind, count)` the pool holds
   at least `count` units of `kind`: take the `count` lowest-id pool units of
   each kind, add them to `attackers`, emit the order of §5.6 for them from
   their centroid, and set `force = None`.
8. **Retarget.** Attackers whose order is `Idle` (ascending ids, one group):
   emit the order of §5.6 for them from their centroid.

### 5.5 Site search

For `r` in `BASE_RING_MIN..=BASE_RING_MAX`, candidate origins are the cells at
Chebyshev distance exactly `r` from the anchor, in `y` ascending then `x`
ascending order. The first candidate `o` with `world.can_construct(p, kind, o)`
whose margin (cells at Chebyshev distance 1 around the footprint) has every
in-bounds cell passable in `world.map()` and contains no unit is the site.

### 5.6 Attack order from a centroid `c`

The centroid is the integer mean of the positions (raw `i64` sums divided by the
count, truncated). In order of preference:

1. the visible enemy building of least dist² to `c`: `Attack`;
2. else the own ghost (`Player::ghosts`) of least dist² from its footprint
   center to `c`: `Move` to that footprint center;
3. else the visible enemy unit of least dist² to `c`: `Attack`;
4. else `Move` to the footprint center of the HQ of the first map start whose
   index is not `p` (`footprint_center(start.hq, hq footprint)`).

Units fire automatically at anything in range while moving (spec 03 §5.11), so
a `Move` toward a ghost or start position turns into a fight on arrival.

### 5.7 WASM API v3

`API_VERSION = 3`. `Sim` gains:

```rust
/// Attaches an AI with the given personality to `player` (seed = the Sim seed).
/// Errors with `Ai::new`'s message. A player may have at most one AI; attaching
/// again replaces it.
pub fn attach_ai(&mut self, player: u8, personality: &str) -> Result<(), String>;
```

`step` and `step_n` run through `step_with_ai` with the attached AIs (ascending
player order). With no AI attached behaviour is identical to v2.

## 6. Headless (`crates/headless`)

* `headless match <map> <seed> <max_ticks> <ai0> <ai1>`: builds
  `World::skirmish(builtin, map, seed)`, attaches `Ai::new(.., player, aiN, seed)`
  unless `aiN` is `none`, steps with `step_with_ai` until the outcome is not
  `Ongoing` or `max_ticks` is reached, and prints one JSON line:
  `{"winner":0,"ticks":8123,"lost":[1200,15400],"hash":"<016x state hash>"}`
  (`winner` is `null` for a draw or timeout). `lost[i]` is the summed `cost` of
  player `i`'s entities that disappeared during the match (ids present after a
  step but absent after a later one).
* `headless tournament <config.json>` with
  `{"map":"first-line","maxTicks":27000,"seeds":[1,2],"ai0":["ukraine-balanced","ukraine-rush"],"ai1":["russia-balanced","russia-rush"]}`
  plays every `ai0 × ai1 × seeds` match (that nesting order) and prints a JSON
  report: `{"matches":[{"ai0":..,"ai1":..,"seed":..,"winner":..,"ticks":..,"lost":[..]}],"summary":[{"ai0":..,"ai1":..,"games":n,"wins0":..,"wins1":..,"draws":..,"avgTicks":..,"lost0":..,"lost1":..}]}`
  (`summary` in the same pair order, `avgTicks` integer division, `lost*` sums).
* Exit code 2 with a message on bad arguments, unknown map or personality.

## 7. Client (`client/`)

* `client/src/sim/protocol.ts`: `EXPECTED_API_VERSION = 3`.
* Skirmish mode attaches an AI to player 1 by default with `russia-balanced`.
  URL parameter `?ai=<personality>` selects another one; `?ai=off` attaches
  none (Phase 2 hot-seat behaviour, still behind `?debug=1` for `F2`).
* An unknown personality shows the existing error overlay with the `attach_ai`
  message.
* No new UI; the AI's units render through the existing fog-filtered snapshot.

## 8. Acceptance criteria

### Data

**AC-05-01 Personality sources build.** `node --run build:data` emits an `ai`
array with the four builtin personalities in `globals.ai` order, with type
indices and task-force indices as in §4.2, equal to what the YAML sources
say; `ruleset.json` is regenerated.

**AC-05-02 Personality semantic checks.** Given a source set where a
personality's `buildOrder` names a unit, a task force names a type of the other
faction, or a trigger names an unknown task force, `buildRuleset` reports an
error naming the file and field for each.

### Ruleset in the simulation

**AC-05-03 AI definitions parse.** `Ruleset::builtin().ai` has the four
personalities; `ai_index("russia-rush") == Some(3)`; `ukraine-balanced`'s first
build-order item is `ua-power-plant` and its first task force is
`[(ua-rifleman, 4), (ua-stugna-team, 2)]`.

**AC-05-04 AI definitions validate.** A builtin ruleset JSON mutated to a
build-order index of a unit, a trigger task force out of range, a zero weight or
a zero unit count fails with the matching §5.1 message.

### World

**AC-05-05 can_construct.** In the first-line skirmish at tick 0, player 0 can
construct `ua-power-plant` at `(18, 64)` (clear of the starting dozer at cell `(18, 61)`), cannot at the HQ origin `(12, 60)`
(occupied), cannot construct `ua-barracks` (requires power plant), and cannot
construct anything at an unexplored cell `(100, 60)`; with credits set to 0 it
cannot construct the power plant.

### AI

All AI tests use `World::skirmish(Ruleset::builtin(), "first-line", 1)` and
`Ai::new(&world, p, <personality>, 1)` unless stated.

**AC-05-06 Ai::new errors.** Unknown personality, unknown player 5, and
`ukraine-balanced` for player 1 fail with the §5.3 messages.

**AC-05-07 Idle trucks harvest the nearest depot.** With a player 0 truck
spawned at the HQ dozer position, the first pass of `ukraine-balanced` contains
`Harvest { units: [truck], depot: 0 }` (depot 0 at `(12, 54)` is nearest).

**AC-05-08 Trucks are produced up to `harvesters`.** With a complete player 0
supply center placed by the test and enough credits, the pass contains exactly
one `Produce` of the truck kind at it; with `harvesters` trucks already present,
none.

**AC-05-09 Build order with site search.** At tick 0 the first pass of
`ukraine-balanced` contains `Construct { dozer: <the dozer>, kind:
ua-power-plant, origin }` where `origin` is the first §5.5 site (computed by
the test independently: ring 3 around `(12, 60)`); after stepping the world
until the plant completes (repeatedly calling `step_with_ai`), the next
construct is `ua-supply-center`.

**AC-05-10 Power substitution.** With the player's power at
`produced == consumed` (test places complete buildings), the next build entry
`ua-barracks` (power −2) is replaced by `ua-power-plant`.

**AC-05-11 Resume orphan sites.** With an own incomplete barracks site and an
idle dozer, the pass contains `Resume { units: [dozer], building: site }` and no
`Construct`.

**AC-05-12 Task force production.** With complete barracks and plenty of
credits, at tick 0 `ukraine-balanced` picks `infantry` (the only eligible
trigger) and emits 4 `Produce ua-rifleman` and 2 `Produce ua-stugna-team`; a
second pass after the queue holds them emits none.

**AC-05-13 Launch attack.** With 4 riflemen and 2 Stugna teams idle near the
HQ and the `infantry` force selected, the pass emits one command for exactly
those 6 units toward the enemy start HQ (no enemy known: `Move` to the
footprint center of `(112, 64)`), and the next pass does not command them
unless they are idle.

**AC-05-14 Defense.** With an enemy rifleman visible within the defense radius
of the player's HQ and idle pool units, the pass emits `Attack` on it with all
pool units and no launch.

**AC-05-15 AI beats a passive opponent.** `ukraine-balanced` vs no AI and
`russia-balanced` vs no AI (the AI on its own start) each win before tick
27000 through `step_with_ai`.

**AC-05-16 AI vs AI is deterministic.** Two runs of `ukraine-balanced` vs
`russia-balanced` with seed 7 reach identical `state_hash` at tick 9000; seed 8
differs from seed 7 at tick 9000.

**AC-05-17 Think cadence.** `step_with_ai` enqueues AI commands only on ticks
that are multiples of `AI_THINK_INTERVAL` (observed through `next_order_id`
not changing on other ticks while units are idle).

### Headless

**AC-05-18 match subcommand.** `headless match first-line 1 27000
ukraine-balanced none` exits 0 and prints JSON with `winner` 0, `ticks < 27000`
and two `lost` values; an unknown personality exits 2.

**AC-05-19 tournament subcommand.** A config with one seed, `ai0:
[ukraine-rush]`, `ai1: [russia-rush]`, `maxTicks: 27000` prints a report with
one match and one summary row whose `games == 1` and `wins0 + wins1 + draws == 1`.

### WASM and client

**AC-05-20 WASM API v3.** `api_version() == 3`; `attach_ai(1, "russia-balanced")`
is `Ok`; `attach_ai(1, "ukraine-balanced")` is `Err`; after `step_n(900)` with
the AI attached, player 1 owns more than one building.

**AC-05-21 Skirmish against the AI (Playwright).** Opening the skirmish with
`?debug=1&seed=1`, after advancing 1800 ticks through the debug API, the enemy
(player 1) owns at least two buildings (read through the debug API with
reveal); with `?ai=off` it owns exactly one.

### Balance

**AC-05-22 Balance report.** `docs/balance/phase3-first-line.md` contains the
tournament command, config, and summary table for 10 seeds over all four
personality pairs; no pair has a side winning more than 70 % (non-draws).
Tuning rules (amended 2026-10-11 by the owner after the first attempt):
personalities are tuned first; a unit or weapon field changes by at most
±25 % of its Phase 2 value; the D-10 identity holds (Ukraine units cost more
and outrange or out-damage their Russian counterparts; Russia units are cheaper
with equal or more hit points per credit; a scout never has more hit points
than its faction's IFV); every stat change is listed in the report with its
reason. This criterion is checked by review, not CI.

## 9. Difficulty levels (issue #451)

Status: built (owner request 2026-11-05, issue #451: "the AI is quite stupid
and easy to beat; let me play against different difficulty levels, like Zero
Hour").

### 9.1 Precedent (`generals-precedent` method, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; data: INIZH.big
(Zero Hour 1.04) and `Data/Scripts/SkirmishScripts.scb` of the owner's copy.

* The skirmish lobby offers three AI slots, Easy / Medium / Hard army; the
  Hard slot is internally `SLOT_BRUTAL_AI` and maps to `DIFFICULTY_HARD`
  (`GameLogic/System/GameLogic.cpp:1429-1431`). The difficulty is stored per
  AI player (`Common/RTS/Player.cpp:908-916`, `AI/AIPlayer.cpp:104,3201`) and
  saved with it (`AIPlayer.cpp:3453`). [fact]
* Engine code barely reads it: only the supply gatherers per side
  (`AIPlayer.cpp:203-212`, `AIData.ini` `ResourceGatherersEasy/Normal/Hard`,
  all equal: 2 for USA/China, 5 for GLA, INIZH.big:Data\INI\Default\AIData.ini:68-70,96-98,123-125).
  Build and team timers (`StructureSeconds = 0`, `TeamSeconds = 10`,
  wealthy/poor rates, AIData.ini:7-15) are the same for every level. [fact]
* The difference lives in the skirmish scripts: per side and level there are
  separate "Build Conditions - Easy/Normal/Hard" and "Base Building -
  Easy/Normal/Hard" script groups; Easy plans 3 attack waves, Normal 4, Hard 5
  (`_USA_1ST_WAVE_E` .. `_5TH_WAVE_H`); only Hard has "Hard Base Expander" 1-4
  (taking extra supply), and a script note says Hard fires its superweapon
  "right when the attack starts, a smarter way to use the power". Easy waves
  wait on the escalation flag, Hard waves are allowed to build at once. [fact
  from the script strings; exact per-team counts are not readable without a
  .scb parser]
* No resource cheat exists in skirmish: the `SOLO_AI_EASY/NORMAL/HARD`
  rate-of-fire bonus (80 / 100 / 120 %, GameData.ini:346-348) and the human
  health bonus apply only to single-player campaign games
  (`Player.cpp:3370-3399`, `isInSinglePlayerGame`). [fact]

Red Line recommendation followed: keep one AI with the level as a per-player,
saved setting; express the levels as data that changes how much the AI builds
and how well it uses it (more gatherers, better wave choice) rather than new
code paths per level. Brutal is a Red Line addition (the owner asked for it;
Zero Hour's "brutal" is only the internal name of Hard) and is the one level
that bends the economy, as Brutal AIs of later C&C games do.

### 9.2 Behaviour

`data/rules/globals.yaml` `aiDifficulties` lists the levels, easiest first.
Each AI player plays at one level; Medium is the default and is exactly the AI
of §5 (`AiDifficultyDef::default()` equals the `medium` entry, so every old
save, test and tournament plays as before).

| field | meaning | easy | medium | hard | brutal |
|---|---|---|---|---|---|
| `thinkTicks` | ticks between decision passes | 15 | 15 | 15 | 10 |
| `incomePercent` | credits paid per delivered cargo | 75 | 100 | 100 | 125 |
| `extraHarvesters` | trucks kept on top of the personality's | 0 | 0 | 1 | 2 |
| `buildableForcesOnly` | choose only task forces the base can build now; drop one whose factory is lost | no | no | yes | yes |
| `retreatHpPercent` | attackers below this share of hit points dock at an own repair factory (spec 39) | 0 | 0 | 30 | 35 |
| `forcePercent` | task-force unit counts (rounded up, >= 1) | 100 | 100 | 100 | 100 |
| `triggerDelayPercent` | trigger `minTick`s | 100 | 100 | 100 | 100 |

* `buildableForcesOnly` fixes the main reason the Medium AI felt stupid: it
  rolls a task force that needs a vehicle factory before it has one and then
  sits on its infantry and credits waiting for it. Opening (`once`) triggers
  that are not buildable yet stay pending, not spent.
* Retreat only applies to units a factory accepts (`can_repair_vehicle_at`);
  infantry and anything else keep fighting, so nothing shuttles between the
  front and a base that cannot mend it. A docked unit leaves the attack and
  the pool until repaired, then rejoins the pool for the next task force.
* `incomePercent` is a `Player` field (`income_percent`, default 100) applied
  when a truck unloads; it is saved as `incomePercent` (omitted at 100) and
  not hashed separately (it only shows through `credits`).
* `forcePercent` and `triggerDelayPercent` stay at 100: bigger forces and
  earlier triggers made the AI weaker in the runs of §9.4 (it waits longer
  before launching), so they are kept only as tunables.

### 9.3 Setup, saves and UI

* Sim: `Ai::set_difficulty(rules, id)` and `Ai::difficulty()`; unknown ids
  error `unknown difficulty <id>`. `World::set_income_percent(player, pct)`.
  `step_with_ai` lets each AI think when `tick % thinkTicks == 0`.
* Saves: `AiState.difficulty` and setup `ai[].difficulty` (both omitted for
  `medium`, defaulting to it), so existing saves load unchanged.
* WASM: `Sim::set_ai_difficulty(player, id)` (sets the AI's level and the
  player's income). `attach_ai` resets the player to Medium.
* Client: the main menu's Skirmish button opens an "Opponent" page with Easy
  army / Medium army / Hard army / Brutal army (strings in `client/src/i18n`);
  each opens `?mode=skirmish&difficulty=<id>`. A missing or unknown
  `difficulty` plays Medium. The level follows the AI if it changes side.
* Campaign missions and tutorials keep their authored AI (Medium unless a
  save names a level); no campaign difficulty choice yet.

### 9.4 Tuning record

`first-line`, `ukraine-balanced` (p0) against `russia-balanced` (p1), seeds
1-6, 27 000-tick cap, each candidate on both sides (wins/losses, the rest
draws). Before this change Medium vs Medium was 2-0 for Russia with 4 draws.

* Medium vs Easy: Medium 2W/0L as Ukraine, 4W/0L as Russia.
* Hard vs Medium: Hard 4W/0L as Ukraine, 4W/1L as Russia.
* Brutal vs Hard: Brutal 2W/0L as Ukraine, 5W/0L as Russia.

Re-run with the ignored `ladder` test in `crates/sim/tests/ai_difficulty.rs`.

### 9.5 Assumptions

* Four levels rather than Zero Hour's three: the owner's brief named Brutal.
* Medium keeps today's AI byte for byte; making today's AI "Easy" was
  rejected because Zero Hour's Easy is weaker than its default and saves and
  tests rely on today's behaviour.
* The level is chosen per match from the main menu (one AI opponent); there is
  no per-slot lobby yet, as there is no multi-AI skirmish.

### 9.6 Acceptance criteria

**AC-05-23 Levels in data.** The ruleset lists `easy, medium, hard, brutal`;
`medium` equals the built-in default; a new AI plays Medium; an unknown id is
refused.

**AC-05-24 Stronger levels build more.** Against a passive opponent for 3600
ticks, Easy owns less than Medium, Brutal more than Medium, and Hard keeps
more trucks than Medium.

**AC-05-25 Determinism and saves.** Two Hard-vs-Brutal runs reach the same
hash; a save keeps each AI's level and income, and the loaded match continues
with the same hash as the original.
