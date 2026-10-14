# 17 — Projectiles and combat readability

Status: accepted (owner request 2026-10-14, issue #266).
Depends on `03-phase2-core-loop.md` (§5.11 combat, §5.14 hash, §5.15
snapshot), `07-phase4b-combat-effects.md` (effect pool, death effects).
Amends spec 03 §5.11 and spec 07 AC-07-02 (see §9). Roadmap: Phase 4.
Decisions: D-02 (deterministic fixed-point simulation), D-05.

## 1. Context

Owner playtest 2026-10-14: combat is unreadable. Shots are one-frame coloured
lines (`client/src/render/entities.ts`, tracers), so the player cannot tell who
attacks whom, what weapon it is, or who killed whom.

Today only the TOS-1A and HIMARS weapons create simulation projectiles
(`projectileTicks`), and the client never sees them: `World::projectiles()`
is not part of any snapshot. Every other weapon (RPG-7, Stugna-P, Kornet,
tank guns) hits in the tick it fires.

### 1.1 Precedent (C&C Generals / Zero Hour)

`generals-precedent` note, 2026-10-14, source
`electronicarts/CnC_Generals_Zero_Hour@0a05454`:

* `Weapon::fireWeaponTemplate` (`Weapon.cpp:1022`) has two paths. Weapons
  without `ProjectileObject` deal damage to the victim after
  `distance / WeaponSpeed` frames (`Weapon.cpp:1028-1066`). The client draws
  only a tracer (`W3DTracerDraw`) and `FireFX` at the muzzle bone
  (`W3DModelDraw.cpp:3696`).
* Weapons with `ProjectileObject` spawn a simulation object
  (`Weapon.cpp:1151-1158`). Missiles (`MissileAIUpdate`) track their victim,
  toss `ProjectileExhaust` and credit the kill to the launcher
  (`MissileAIUpdate.cpp:357`). Dumb projectiles (`DumbProjectileBehavior`)
  fly a Bezier with `FirstHeight` and `SecondHeight` to a ground point
  (`DumbProjectileBehavior.cpp:413-455`), so a moving unit can dodge them.
* Scatter (`ScatterRadius`) uses the logic RNG (`Weapon.cpp:1004-1010`).
* FX are cosmetic and driven by logic events (`FireFX`,
  `ProjectileDetonationFX`). Deaths carry `DeathType` and the damage source
  (`Damage.h:172-196`, `FXListDie.cpp:65-96`).

### 1.2 Owner decisions (2026-10-14)

1. Unguided projectiles fall where they were aimed and can be dodged, as in
   Generals. Guided weapons (Stugna-P, Kornet, Javelin) track their target.
2. Scatter for area weapons, from the simulation's deterministic randomness.
3. RPGs show a rear backblast with dust raised around the gunner, and the
   rocket accelerates as it leaves the tube.
4. Javelin-style missiles and HIMARS rockets climb and then dive at full
   speed onto the target.

**Exit criterion:** in a skirmish the owner sees bullets travel as tracers,
shells, RPG rockets and missiles fly as 3D objects with smoke trails, HIMARS
rockets climb and dive, TOS rockets land scattered, explosions happen where the
projectile lands, and a death is attributed to its killer.

## 2. Scope

In:

* Simulation: flight time from weapon speed, two delivery kinds (`homing`,
  `ballistic`), scatter, salvos, combat events (detonations, deaths with killer)
  and a combat snapshot `Sim::combat_for(viewer)`.
* Data: new weapon fields and a `render` block for projectile visuals.
* Client: projectile renderer with procedural 3D models, flight profiles,
  launch effects (muzzle, cannon, backblast with dust, rocket launch smoke),
  smoke trails, detonations at the real impact point, and deaths from events.

Out: audio, screen shake, terrain scorch marks, countermeasures and
interception, projectile collision with terrain or buildings in flight, a kill
feed UI, the tracer lines in `entities.ts` beyond removing them (§7.6),
movement and turret aim (spec 11).

## 3. Data (`data/factions/*.yaml`, `data/schema/faction.schema.json`)

### 3.1 New weapon fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `speedCenti` | count | 0 | Ground speed in centi-tiles per tick. `> 0` gives the flight time (§4.2). |
| `delivery` | `"homing"` or `"ballistic"` | `homing` if `splashCenti == 0`, else `ballistic` | §4.3. The default keeps the spec 03 behaviour. |
| `scatterCenti` | count | 0 | Scatter radius for `ballistic` projectiles (§4.4). |
| `salvo` | positive | 1 | Projectiles per shot. |
| `salvoIntervalTicks` | count | 0 | Ticks between launches inside one salvo. |
| `render` | object | see §3.2 | Visuals only. The simulation ignores it. |

`speedCenti` and `projectileTicks` are mutually exclusive: the schema rejects
a weapon with both above 0. `scatterCenti > 0` with `delivery: homing` is
rejected. `scripts/build-data.mjs` writes every field into
`data/generated/ruleset.json` with its default filled in (`delivery` as
`0` homing / `1` ballistic). `render` is copied as written, with the defaults
of §3.2.

### 3.2 `render` block

```yaml
render:
  model: tracer        # tracer | tracerHeavy | shell | rpg | atgm | rocket
  flight: straight     # straight | boost | loft | ballistic | topAttack
  apexCenti: 0         # flight apex for loft, ballistic and topAttack
  launch: muzzle       # muzzle | cannon | backblast | softLaunch | rocketLaunch
  trail: none          # none | smoke
```

Defaults: `{ model: tracer, flight: straight, apexCenti: 0, launch: muzzle,
trail: none }`.

### 3.3 Builtin weapons

The balance values are first guesses. A salvo weapon's damage is divided so that
the total damage of a salvo stays as it is today.

| Weapon | speedCenti | delivery | scatterCenti | salvo / interval | damage | model | flight | apexCenti | launch | trail |
|---|---|---|---|---|---|---|---|---|---|---|
| `ua-rifle`, `ru-ak74` | 400 | homing | 0 | 1 | unchanged | tracer | straight | 0 | muzzle | none |
| `ua-kozak-hmg`, `ru-kpvt` | 450 | homing | 0 | 1 | unchanged | tracer | straight | 0 | muzzle | none |
| `ua-bushmaster`, `ru-2a42` | 500 | homing | 0 | 1 | unchanged | tracerHeavy | straight | 0 | muzzle | none |
| `ua-rh120`, `ru-2a46m` | 900 | ballistic | 0 | 1 | unchanged | shell | straight | 0 | cannon | none |
| `ru-rpg7` | 60 | ballistic | 25 | 1 | unchanged | rpg | boost | 0 | backblast | smoke |
| `ua-stugna-p`, `ua-stugna-emplacement`, `ru-kornet-emplacement` | 45 | homing | 0 | 1 | unchanged | atgm | loft | 40 | softLaunch | smoke |
| `ua-gmlrs` | 40 | ballistic | 0 | 2 / 8 | 125 | rocket | topAttack | 600 | rocketLaunch | smoke |
| `ru-tos-thermobaric` | 30 | ballistic | 150 | 4 / 3 | 30 | rocket | ballistic | 0 | rocketLaunch | smoke |

`projectileTicks` is removed from the builtin data. It stays in the schema and
the simulation for the test fixture (§4.2).

`topAttack` is the Javelin profile (owner decision 4). No unit in the roster
carries a Javelin yet. When one is added, its weapon uses `homing` +
`topAttack`.

## 4. Simulation (`crates/sim`)

### 4.1 Types (`rules.rs`, `entity.rs`, `world.rs`)

```rust
// rules.rs: WeaponDef gains (render is ignored on parse, like TypeDef::render)
pub speed_centi: u32,
pub delivery: Delivery,
pub scatter_centi: u32,
pub salvo: u32,
pub salvo_interval_ticks: u32,

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "u8")]
pub enum Delivery { Homing = 0, Ballistic = 1 }

// entity.rs
pub struct Projectile {
    pub id: u32,            // World::next_projectile_id, starting at 0
    pub owner: PlayerId,
    pub shooter: EntityId,
    pub weapon: WeaponId,
    pub target: EntityId,
    pub origin: FxVec2,     // shooter position at fire time
    pub impact: FxVec2,
    pub launch_tick: u32,
    pub impact_tick: u32,
}

// Entity gains (presentation only, never read by game rules, not hashed)
pub last_hit: Option<(EntityId, WeaponId)>,

// world.rs
pub enum CombatEvent {
    Detonate { projectile: u32, owner: PlayerId, weapon: WeaponId, pos: FxVec2, hit: Option<EntityId> },
    Death { victim: EntityId, owner: PlayerId, kind: TypeId, pos: FxVec2,
            killer: Option<EntityId>, weapon: Option<WeaponId> },
}
impl World {
    /// Events of the last `step`, in emission order; cleared when a step starts.
    pub fn events(&self) -> &[CombatEvent];
}
pub const DIRECT_HIT_CENTI: u32 = 45;
```

When the serde field is missing, `speed_centi`, `scatter_centi` and
`salvo_interval_ticks` default to 0 and `salvo` to 1. `delivery` defaults as
in §3.1. The test fixture `crates/sim/tests/fixtures/test-rules.json` stays
unchanged.

### 4.2 Fire (amends spec 03 §5.11 step 2, "Fire")

`d` = entity distance from the shooter to the target (as for range).
`flight` =

* `max(1, ceil(d.raw / fx_centi(speed_centi).raw))` when `speed_centi > 0`;
* `projectile_ticks` otherwise.

With `flight == 0`, the instant hit of spec 03 is unchanged and creates no
projectile.

Otherwise, for `k` in `0..salvo`, push a `Projectile`:

* `id = next_projectile_id++`;
* `shooter` and `owner` are the firing entity and its owner;
* `origin` is the shooter's position;
* `aim` is the target position (buildings: footprint centre);
* `impact = aim + scatter(k)` (§4.4);
* `launch_tick = tick + k × salvo_interval_ticks`;
* `impact_tick = launch_tick + flight`.

Then `cooldown` and `last_target` are set as today. `next_projectile_id` is
not hashed.

### 4.3 Flight and impact (amends spec 03 §5.11 steps 3 and 4)

At the start of step 3, in creation order:

1. A projectile with `launch_tick > tick` whose shooter no longer exists or
   has `hp == 0` is removed with no event. The rest of the salvo is not fired.
2. A `homing` projectile with `launch_tick <= tick` whose target exists with
   `hp > 0` sets `impact` to the target position (buildings: footprint centre).

Then every projectile with `impact_tick == tick` resolves and is removed:

* **Homing, `splash == 0`:** spec 03 behaviour. The target, if it exists with
  `hp > 0`, takes the hit; `hit = Some(target)`.
* **Ballistic, `splash == 0`:** the direct hit is the entity with `hp > 0`,
  owner neither the shooter's owner nor `NEUTRAL`, `modifier > 0`, and the
  smallest entity distance from `impact`, as long as that distance is
  `<= fx_centi(DIRECT_HIT_CENTI)`. Ties go to the lowest id. If there is no
  such entity, the projectile misses (`hit = None`).
* **`splash > 0`** (either delivery): spec 03 splash around `impact`;
  `hit = None`.

Every resolution emits `Detonate { projectile: id, owner, weapon, pos:
impact, hit }`.

Every damage application of `damage > 0` (instant, projectile or splash) sets
the victim's `last_hit = Some((shooter, weapon))`. For a projectile, the
shooter is `Projectile::shooter` even if that entity has died since.

### 4.4 Scatter (`combat.rs`)

`scatter(k)` is `(0, 0)` unless `delivery == Ballistic && scatter_centi > 0`.
In that case:

```rust
let mut rng = SplitMix64::new((u64::from(tick) << 32) ^ (u64::from(shooter) << 8) ^ u64::from(k));
let u = Fx::from_raw((rng.next_u32() % 65537) as i32);        // 0..=1
let r = fx_centi(scatter_centi).mul(u.sqrt());                 // uniform over the disc
let a = Angle((rng.next_u32() >> 16) as u16);
a.dir().scale(r)
```

The draw is stateless: it adds no world state and does not change the hash
stream.

### 4.5 Deaths (amends spec 03 §5.7 step 8)

Before removal, each unit or building with `hp == 0` (ascending id) emits
`Death { victim, owner, kind, pos (buildings: footprint centre), killer,
weapon }`. `killer` and `weapon` come from `last_hit`, or are `None`.

### 4.6 State hash (amends spec 03 §5.14 step 4)

Each projectile record becomes `id: u32, owner: u8, shooter: u32, weapon: u16,
target: u32, origin.x: i32, origin.y: i32, impact.x: i32, impact.y: i32,
launch_tick: u32, impact_tick: u32`. The empty-world stream is unchanged.

### 4.7 Combat snapshot (`snapshot.rs`, `wasm_api.rs`)

```rust
pub const PROJECTILE_STRIDE: usize = 11;
pub const EVENT_STRIDE: usize = 7;
pub const EVENT_DETONATE: i32 = 0;
pub const EVENT_DEATH: i32 = 1;
pub fn encode_combat(world: &World, viewer: PlayerId, events: &[CombatEvent]) -> Vec<i32>;

// Sim
pending_events: Vec<CombatEvent>,      // appended after every step / step_n step
pub fn combat_for(&mut self, viewer: u8) -> Vec<i32>; // encodes, then clears pending_events
```

A point `p` is seen by the viewer when `world.fog(viewer, cell_of(p)) == 2`.
The observer sees every point.

Layout:

* `projectile_count`, then per projectile in creation order: `id, owner,
  weapon, shooter, target, origin.x, origin.y, impact.x, impact.y,
  launch_tick, impact_tick`. Only projectiles that the viewer owns, or whose
  `origin` or `impact` the viewer sees, are listed.
* `event_count`, then per event in emission order:
  * `Detonate`: `0, projectile, owner, weapon, hit (-1), pos.x, pos.y`.
  * `Death`: `1, victim, kind, killer (-1), weapon (-1), pos.x, pos.y`.
  
  An event is listed when the viewer owns it (`owner`) or sees `pos`.

The match snapshot (`snapshot_for`, spec 03 §5.15) is unchanged.

## 5. Client data path

* `client/src/sim/workerHandler.ts`: `SkirmishSimLike` gains the optional
  method `combat_for?(viewer: number): Int32Array`. When present, the handler
  calls it right after `snapshot_for`.
* `client/src/sim/protocol.ts`: the snapshot message gains `combat?:
  Int32Array`. The skirmish client passes it through.
* `client/src/sim/combatSnapshot.ts` (new):

```ts
export const PROJECTILE_STRIDE = 11;
export const EVENT_STRIDE = 7;
export interface ProjectileState {
  id: number; owner: number; weapon: number; shooter: number; target: number;
  originX: number; originY: number; impactX: number; impactY: number; // tiles
  launchTick: number; impactTick: number;
}
export const COMBAT_EVENT_KINDS = ["detonate", "death"] as const;
export type CombatEventState =
  | { kind: "detonate"; projectile: number; owner: number; weapon: number; hit: number | null; x: number; y: number }
  | { kind: "death"; victim: number; victimKind: number; killer: number | null; weapon: number | null; x: number; y: number };
export interface CombatSnapshot { projectiles: ProjectileState[]; events: CombatEventState[] }
export function decodeCombat(data: Int32Array): CombatSnapshot; // raw / 65536 → tiles
```

* `client/src/rules.ts` exports `WEAPONS: WeaponDef[]` with the §3 fields and
  `render` already resolved to defaults. If `effects.ts` keeps its own
  `WEAPONS`, it switches to this one.

## 6. Flight profiles (`client/src/render/flight.ts`, new)

```ts
export const FLIGHT_PROFILES = ["straight", "boost", "loft", "ballistic", "topAttack"] as const;
export type FlightProfile = (typeof FLIGHT_PROFILES)[number];
export const IMPACT_HEIGHT = 0.2;   // tiles; ballistic and topAttack end at 0
export const TOP_ATTACK_CLIMB = 0.3;
/** Horizontal fraction s and height z (tiles) at flight fraction t in [0, 1]. */
export function flightSample(profile: FlightProfile, t: number, h0: number, apex: number): { s: number; z: number };
/** World position at a fractional tick, plus a unit direction for orientation. */
export function flightPoint(p: ProjectileState, tick: number, profile: FlightProfile, h0: number, apexTiles: number):
  { x: number; y: number; z: number; dx: number; dy: number; dz: number; t: number };
```

`t = clamp((tick − launchTick) / (impactTick − launchTick), 0, 1)`.
`lerp(a, b, u) = a + (b − a)·u`. `h0` is the muzzle height:
`0.7 × render.size[1] / 100` of the shooter type, or 0.5 when the shooter is
not in the snapshot.

| Profile | s | z |
|---|---|---|
| `straight` | `t` | `lerp(h0, IMPACT_HEIGHT, t)` |
| `boost` | `0.3t + 0.7t²` | `lerp(h0, IMPACT_HEIGHT, s)` |
| `loft` | `t` | `lerp(h0, IMPACT_HEIGHT, t) + apex·4t(1−t)` |
| `ballistic` | `t` | `lerp(h0, 0, t) + A·4t(1−t)`, `A = max(apex, 0.25 × ground distance)` |
| `topAttack` | `t < c`: `0.1u`, `u = t/c`; else `0.1 + 0.9u²`, `u = (t−c)/(1−c)` | `t < c`: `h0 + (apex − h0)(1 − (1−u)²)`; else `apex(1 − u²)` |

Here `c = TOP_ATTACK_CLIMB` and `apex = render.apexCenti / 100`. The position
is `origin + (impact − origin)·s` at height `z`. The direction is the
normalised difference between the samples at `t` and `max(0, t − 0.02)` (at
`t = 0`, between `0.02` and `0`). `topAttack` climbs steeply for the first
30 % of the flight, covering only 10 % of the ground, and then dives with
increasing speed.

## 7. Rendering

### 7.1 Projectile models (`client/src/render/projectiles.ts`, new)

```ts
export const PROJECTILE_MODELS = ["tracer", "tracerHeavy", "shell", "rpg", "atgm", "rocket"] as const;
export type ProjectileModel = (typeof PROJECTILE_MODELS)[number];
export const PROJECTILE_CAPACITY = 1024;   // per model; extra projectiles are not drawn
export interface Projectiles {
  readonly group: Group;
  readonly meshes: Readonly<Record<ProjectileModel, InstancedMesh>>;
  /** Places every flying projectile (launchTick <= tick < impactTick) at `tick` (fractional). */
  sync(states: readonly ProjectileState[], tick: number, snapshot: MatchSnapshot): void;
  counts(): Record<ProjectileModel, number>;
}
export function createProjectiles(): Projectiles;
```

Each model is built procedurally from Three.js primitives and merged into one
geometry along +Z (nose forward). Its look lives in a constant dictionary:

| Model | Shape (tiles) | Material |
|---|---|---|
| `tracer` | box 0.03 × 0.03 × 0.45 | additive, `#fff2b0` |
| `tracerHeavy` | box 0.05 × 0.05 × 0.6 | additive, `#ffd27a` |
| `shell` | box 0.07 × 0.07 × 0.3 | additive, `#ffb347` |
| `rpg` | cone r 0.05 h 0.12 + cylinder r 0.025 l 0.25 + 4 fins | `#4a4f3a`, emissive tail `#ff9a3a` |
| `atgm` | cylinder r 0.035 l 0.4 + 4 fins + nose cone | `#55604a`, emissive tail `#ffcf7a` |
| `rocket` | cylinder r 0.05 l 0.75 + nose cone + 4 fins | `#8a8f86`, emissive tail `#ffb04a` |

Projectiles stay out of the shadow pass.

### 7.2 Launch effects

A projectile id seen for the first time with `launchTick <= tick` spawns its
`render.launch` effects at the shooter end of the path:

* `back` is the unit vector from impact to origin.
* The muzzle point is `origin − back × 0.3` at height `h0`.

New `EFFECT_KINDS` (spec 07 §3 table format):

| Kind | Look | Duration |
|---|---|---|
| `backblast` | additive orange-white flash, 0.5 tiles, at `origin + back × 0.35` | 150 ms |
| `dust` | tan `#8a7a5c` ground puff, grows 0.15 → 0.45 tiles | 1000 ms, fading the last 600 ms |
| `launchSmoke` | grey `#9a9a92` puff, grows 0.6 → 1.4 tiles | 2500 ms, fading the last 1500 ms |
| `trail` | white-grey `#d8d8d0` puff, grows 0.1 → 0.4 tiles | 1200 ms, fading the last 900 ms |

`EffectSpawn` gains `z?: number` (height in tiles, default the kind's),
`vx?: number; vy?: number` (tiles per second, default 0) and `growTo?: number`
(final uniform size). `update` moves each instance by velocity × age and
lerps its size to `growTo`.

| `launch` | Spawns |
|---|---|
| `muzzle` | one `muzzle` at the muzzle point |
| `cannon` | `muzzle` at size 0.35, plus 6 `dust` at radius 0.3 around the shooter, moving outward at 0.6 tiles/s |
| `backblast` | `muzzle`, plus `backblast`, plus 3 `trail` along `back` at 0.3, 0.6 and 0.9 tiles moving along `back` at 1.5 tiles/s, plus 8 `dust` evenly spaced at radius 0.2 moving outward at 0.9 tiles/s |
| `softLaunch` | `muzzle` at size 0.1, plus 2 `trail` along `back` |
| `rocketLaunch` | `backblast` at size 1.0, plus 6 `launchSmoke` evenly spaced at radius 0.4 moving outward at 0.4 tiles/s |

### 7.3 Trails

A flying projectile with `render.trail: smoke` spawns one `trail` at its
current position every `TRAIL_INTERVAL_MS = 40` (real ms, scaled by the
simulation speed like spec 07 durations).

### 7.4 Detonations

Each `detonate` event spawns the spec 07 shot effect for the weapon's damage
type at the event position `(x, y)`:

* `smallArms` and `autocannon`: `impact`;
* `antiTank`: `blast`;
* `highExplosive` and `thermobaric`: `explosion` sized as in spec 07, with no
  delay.

A ballistic miss explodes on the ground where it landed.

### 7.5 Deaths

In the skirmish, `death` events replace `detectDeaths` (which stays exported
for its tests). Each event calls `spawnDeathEffects` for its victim kind at
`(x, y)`. When `killer` is in the previous snapshot, `debris` and `wreck` debris
get a velocity of 0.8 tiles/s away from the killer. A vehicle or building
killed by `antiTank`, `highExplosive` or `thermobaric` also spawns an
`explosion` of size 0.8.

### 7.6 Shots and tracer lines

`spawnShotEffects` (spec 07) applies only to shooters whose weapon has
`speedCenti == 0 && projectileTicks == 0` (instant). The one-frame tracer
`LineSegments` in `entities.ts` is removed. Projectiles replace them.

### 7.7 Debug API

`__redline.projectileCounts(): Record<ProjectileModel, number>` and
`__redline.projectileSamples(): { model: ProjectileModel; z: number; t: number }[]`
(one entry per drawn projectile) are added to the skirmish debug API.

## 8. Acceptance criteria

**AC-17-01 Weapon data.** Given the faction files, when `node --run
build:data` runs, then every builtin weapon in `ruleset.json` has the §3.3
values with defaults filled in. A weapon with `speedCenti > 0` and
`projectileTicks > 0`, or with `delivery: homing` and `scatterCenti > 0`, or
with an unknown `render.model`, fails `node --run check:data`.

**AC-17-02 Flight time from speed.** Given a sandbox with a rifleman of
`ua-rifle` (speed 400) 3.0 tiles from an enemy, when it fires on tick `t`,
then one projectile exists with `impact_tick = t + 1`. At 4.2 tiles,
`impact_tick = t + 2`. The enemy's hp drops on `impact_tick` and not before.

**AC-17-03 Legacy behaviour.** Given the unchanged test fixture, AC-03-27..33
pass unchanged, and a fixture weapon with `projectileTicks == 0` and no
`speedCenti` still hits in the tick it fires and creates no projectile.

**AC-17-04 Homing tracks.** Given a homing weapon (speed 45) firing at a unit
that moves sideways, then the projectile's `impact` equals the target position
on every tick until impact, and the target takes the damage on `impact_tick`.
If the target dies first, the projectile detonates at the last `impact` and
damages nobody.

**AC-17-05 Ballistic can miss.** Given a ballistic `splash 0` weapon (speed 60,
scatter 0) firing at a unit that keeps moving at 0.3 tiles/tick, then on
`impact_tick` the unit is undamaged and a `Detonate` with `hit: None` is
emitted at the fire-time aim point. A stationary target is hit (`hit:
Some(target)`). An enemy standing within `DIRECT_HIT_CENTI` of the impact point
is hit instead of a target that left.

**AC-17-06 Scatter.** Given a ballistic weapon with `scatterCenti 150` firing
a salvo of 4, then every `impact` lies within `fx_centi(150)` of the aim point,
the four impacts are not all equal, and two worlds with the same commands give
identical impacts. A weapon with `scatterCenti 0` lands exactly on the aim
point.

**AC-17-07 Salvo.** Given `salvo 4`, `salvoIntervalTicks 3`, fired on tick
`t`, then four projectiles exist with `launch_tick` `t, t+3, t+6, t+9` and
consecutive ids. If the shooter dies on tick `t+4`, the projectiles not yet
launched (`t+6`, `t+9`) are removed without events.

**AC-17-08 Events and killer.** Given a rifleman killing an enemy, then the
step that removes the victim emits `Death { victim, killer: Some(rifleman),
weapon: Some(ua-rifle id) }`. A unit killed by a projectile whose shooter
died in flight still names that shooter. A unit set to `hp 0` by the debug
API with no prior hit emits `killer: None`. `events()` is empty after a step
with no combat.

**AC-17-09 Combat snapshot.** Given the AC-17-07 scenario, `combat_for(viewer)`
encodes the §4.7 layout exactly. A projectile whose origin and impact the
viewer cannot see is omitted. Events from two `step` calls before one
`combat_for` call are all reported, and a second `combat_for` reports none.
The observer sees everything.

**AC-17-10 Hash.** The empty-world hash of AC-03-08 is unchanged. Two worlds
that differ only in one projectile's `origin` hash differently.

**AC-17-11 Client decode.** `decodeCombat` turns the AC-17-09 array into the
expected `ProjectileState` and `CombatEventState` values (tiles, `-1` →
`null`). The worker handler passes `combat` through when the sim has
`combat_for`, and works unchanged when it does not.

**AC-17-12 Flight profiles.** With `h0 = 0.5` and `apex = 6`:

* `flightSample("straight", 0.5)` → `{ s: 0.5, z: 0.35 }`.
* `boost` at `t = 0.5` → `s = 0.325`, and its speed `ds/dt` at `t = 1` is
  more than 5× its speed at `t = 0`.
* `topAttack` at `t = 0.3` → `{ s: 0.1, z: 6 }`, at `t = 1` → `{ s: 1, z: 0 }`,
  and `z` at `t = 0.15` is above 4.
* `ballistic` over 10 tiles with `apex 0`: `z` at `t = 0.5` is `2.75`.
* Every profile has `s(0) = 0` and `s(1) = 1`.

**AC-17-13 Projectile renderer.** Given two flying projectiles (`rpg`,
`rocket`) and one landed, `sync` sets `counts()` to `rpg 1, rocket 1` and
places each instance at its `flightPoint`, oriented along its direction.

**AC-17-14 Launch effects and trails.** A first-seen `backblast` projectile
spawns 1 `muzzle`, 1 `backblast`, 3 `trail` and 8 `dust`. The `dust` puffs move
away from the shooter after 500 ms. Seeing the same id again spawns nothing.
`rocketLaunch` spawns 6 `launchSmoke`. A flying `smoke` projectile adds one
`trail` every 40 ms.

**AC-17-15 Detonations and deaths from events.** A `detonate` event of
`ru-tos-thermobaric` spawns an `explosion` (×1.5 size) at the event position
with no delay. A `death` event of a vehicle killed by `antiTank` spawns a
`wreck` and an `explosion`, and its debris moves away from the killer.
`spawnShotEffects` adds nothing for a shooter with a projectile weapon.

**AC-17-16 Projectiles in the skirmish (Playwright).** In `?debug=1&seed=1`:

* Given a `ru-rpg-gunner` and an enemy `ua-leopard-2a4` spawned 4 tiles apart,
  within 5 s `projectileCounts().rpg >= 1` and `effectCounts().dust >= 1`.
* Given a `ua-himars` with an enemy building 20 tiles away, kept visible by a
  friendly `ua-kozak-scout` spawned 3 tiles from the building, some
  `projectileSamples()` entry has `model: "rocket"` with `z > 4` after an
  attack order on the building.

The attack order is given with real mouse input: select the unit with a click,
then right-click the building.

## 9. Amendments

* Spec 03 §5.11 steps 2–4: replaced by §4.2–§4.3 for weapons with
  `speedCenti`, `delivery`, `scatterCenti` or `salvo`. Fixture weapons keep
  the spec 03 behaviour (AC-17-03).
* Spec 07 AC-07-02: the `highExplosive`/`thermobaric` explosion and the
  `antiTank` blast now come from `detonate` events (AC-17-15), because the
  builtin HIMARS no longer has `projectileTicks`. In the AC-07-02 test, the
  `ua-himars` case asserting an explosion delayed by `projectileTicks / 15`
  is replaced by the AC-17-15 assertion. This is the only spec-phase test this
  spec changes. Its muzzle, impact and absent-target cases stay.
* AI-vs-AI outcomes (`crates/sim/tests/ai_match.rs`, `crates/headless/tests/cli.rs`)
  may change with the new builtin data. Do not edit them. If one fails, report
  it on the issue with `needs-pro` and stop.

## 10. Traceability

| Criterion | File | Test |
|---|---|---|
| AC-17-01 | `scripts/build-data.test.mjs` | `AC-17-01: weapon data` |
| AC-17-02 | `crates/sim/tests/projectiles.rs` | `ac_17_02_flight_time_from_speed` |
| AC-17-03 | `crates/sim/tests/projectiles.rs` | `ac_17_03_legacy_behaviour` |
| AC-17-04 | `crates/sim/tests/projectiles.rs` | `ac_17_04_homing_tracks` |
| AC-17-05 | `crates/sim/tests/projectiles.rs` | `ac_17_05_ballistic_can_miss` |
| AC-17-06 | `crates/sim/tests/projectiles.rs` | `ac_17_06_scatter` |
| AC-17-07 | `crates/sim/tests/projectiles.rs` | `ac_17_07_salvo` |
| AC-17-08 | `crates/sim/tests/projectiles.rs` | `ac_17_08_events_and_killer` |
| AC-17-09 | `crates/sim/tests/projectiles.rs` | `ac_17_09_combat_snapshot` |
| AC-17-10 | `crates/sim/tests/projectiles.rs` | `ac_17_10_hash` |
| AC-17-11 | `client/src/sim/combatSnapshot.test.ts` | `AC-17-11: client decode` |
| AC-17-12 | `client/src/render/flight.test.ts` | `AC-17-12: flight profiles` |
| AC-17-13 | `client/src/render/projectiles.test.ts` | `AC-17-13: projectile renderer` |
| AC-17-14 | `client/src/render/projectiles.test.ts` | `AC-17-14: launch effects and trails` |
| AC-17-15 | `client/src/render/effects.test.ts` | `AC-17-15: detonations and deaths from events` |
| AC-17-16 | `client/tests/e2e/projectiles.spec.ts` | `AC-17-16: projectiles in the skirmish` |

Sandbox tests for AC-17-02..10 add their own weapons through a ruleset built
in the test file (a copy of the fixture JSON with extra weapons). They do not
edit `test-rules.json`.

## 11. Issue breakdown

| Issue | Scope | Criteria | Tier | Depends on |
|---|---|---|---|---|
| P4-26 | Weapon data fields, schema, build script, builtin values | AC-17-01 | ready-local | — |
| P4-27 | Sim: flight time, delivery, scatter, salvo, hash | AC-17-02..07, 10 | ready-pro | P4-26 |
| P4-28 | Sim: events, `last_hit`, `combat_for`; client decode and worker plumbing | AC-17-08, 09, 11 | ready-pro | P4-27 |
| P4-29 | Flight profiles and projectile renderer, tracer lines removed | AC-17-12, 13 | ready-pro | P4-28 |
| P4-30 | Launch effects, dust, trails, effect velocity/growth | AC-17-14 | ready-pro | P4-29 |
| P4-31 | Detonations and deaths from events, AC-07-02 amendment, e2e | AC-17-15, 16 | ready-pro | P4-30 |
