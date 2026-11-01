# 43 — Air power, drones and deep strike

Status: in progress (owner request 2026-11-01; `docs/roadmap.md`, drone pool).
Depends on `11-phase4e-locomotor-and-turret-aim.md`,
`17-projectiles-and-combat-readability.md`, `19-save-games.md`, D-10.
Decisions: D-02 (determinism), D-05 (data driven), D-14 (below).

## 1. Goal

The war moves into the sky, and each side fights it differently. Russia owns
real aviation, glide bombs, Shahed-type mass strikes and electronic warfare.
Ukraine has no aircraft: it fights with robots on the ground, drones built in a
workshop, interceptors, and scarce deep-strike missiles. **No unit of one side
is a reskin of a unit of the other**: every entry below has a different job,
counter or mechanic (owner requirement).

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; data: `INIZH.big` 1.04.

* **Anti-air is a mask match.** `getVictimAntiMask`
  (`Object/WeaponSet.cpp:371-413`) maps a victim to a flag and a weapon fires
  only if its mask has it (`:605`).
* **Airborne is a height.** `AIUpdate.cpp:2299-2304` marks a unit airborne above
  its locomotor's `AirborneTargetingHeight`; a jet parked on the ground is an
  ordinary target.
* **Air units fly straight.** `canComputeQuickPath` (`AIUpdate.cpp:1595`) gives
  them a two-node path; flying bodies do not collide
  (`Locomotor.cpp:1046-1048`).
* **A missile detonates the weapon that launched it**
  (`MissileAIUpdate.cpp:388-420`), and a cruise object with a body can be shot
  down by any damage. Patriot hits ballistic missiles only by mask.
* **Jets run out of ammo and go home.** `isOutOfSpecialReloadAmmo`
  (`JetAIUpdate.cpp:106`) sends the jet back; `JetOrHeliReloadAmmoState`
  (`:1413`) refills over a time; with no airfield it circles and takes damage
  (`OutOfAmmoDamagePerSecond`, `:382`).
* **Slaved drones die with the master.** `SlavedUpdate.cpp:152` disables and
  drops the slave when its master dies; GLA Stinger Site replaces spawns
  (`SpawnBehavior.cpp`).

## 3. Differences from Zero Hour

* **D1 — flying missiles are units, not projectiles.** Shahed, Flamingo and
  Storm Shadow are entities, so they can be shot down with the ordinary damage
  rules. Spec 17's "no interception" still holds for `Projectile`s (glide bombs
  included).
* **D2 — three anti-air levels, not masks.** `none`, `low` (small arms and
  autocannons reach drones and missiles at low level) and `all`.
* **D3 — electronic warfare** has no Zero Hour equivalent: control links.
* **D4 — one reload clock.** An aircraft reloads all its clip in `reloadTicks`,
  as Zero Hour, with no parking slots: any number land on one airfield.

## 4. Rules

### 4.1 Flight

* `locomotors.airLow` / `airHigh`: `{ kind: air, class: low|high, altitudeCenti }`.
  They fly straight, ignore the nav grids, never separate or crush, and turn at
  `turnRateDeg`.
* A flyer is **airborne** while it has an order that moves it or while it is
  away from base; a parked aircraft or a missile waiting on its rail is not, and
  any ground weapon can hit it.
* Weapon `antiAir: none|low|all` (default `none`), `antiGround` (default `true`).
  `low` reaches airborne units of class `low`, `all` reaches both.
  `smallArms` and `autocannon` weapons of units get `low`.
* New armour classes `drone`, `aircraft`; new damage type `flak`.
* `lowObservable: true`: an enemy weapon engages it only inside one third of its
  range (targeting, ordered attacks and the approach of an attacking flyer).
* **As built.** A flyer's heading turns at `turnRateDeg` and it moves along it at
  its top speed, at a quarter of it while the goal is more than 45 degrees off
  the heading; within two steps of the goal it flies straight at it, so it always
  arrives (turn rates are 150 degrees per second or more). An aircraft with a
  weapon flies until the target is inside the weapon range (a `lowObservable`
  target: a third of it) and then holds there; it needs no aiming, and hits with
  splash weapons and direct hits skip the units its weapon cannot reach by height.
  Airborne means: the order moves the flyer, or it is `Idle` more than
  `DOCK_RANGE_CENTI` (250) from the footprint of an own complete building that
  produces its type. An empty sortie aircraft docked with an attack remembered
  is parked too. An attack order a unit's weapon (or warhead) can never carry out
  by height is ignored. Flyers can be placed over any cell.

### 4.2 One-way units

`oneWay: { warhead: <weapon>, fuelTicks?, armTiles? }` on a type. An attack
order (unit or ground) flies or drives there and detonates the warhead on
arrival; the unit dies with no death explosion of its own. Out of fuel it falls
and detonates where it is. Works for flyers (Geran, missiles, FPV, Sting) and
ground drones (Ratel).

A produced one-way unit waits at the launcher until ordered (it ignores the
rally point); it is never auto-launched, except a launched drone (§4.4).

**As built.** The unit has no `weapon`; it fires nothing, so it never shoots on
its own. `fuel` counts the ticks it has been under way (flyers: airborne; ground
drones: with an order); it falls and detonates at `fuelTicks`, and the warhead is
armed once `armTiles` tiles at top speed have been flown (`ceil(armTiles * 100 /
speedCenti)` ticks), an unarmed unit flies on through its target. It detonates
inside `max(60 centi, one step)` of the target (a ground robot: 100 centi, because
separation keeps it off). A warhead with `scatterCenti` is inaccurate on its own.
The blast is a `CombatEvent::Detonate` with `projectile = u32::MAX`, followed by
the unit's `Death` (killer: itself). A unit shot down, or lost to jamming or a
dead master, dies with no blast.

### 4.3 Sorties

`sortie: { clip, reloadTicks }` on a flyer. Each shot spends one round. With an
empty clip, or an idle order, the aircraft returns to the nearest own building
of a type that lists it in `produces` and reloads there; repaired while
reloading. With no base it stays airborne and loses 5 % max HP each second
(Zero Hour). Attack orders given while empty are remembered until reloaded.

**As built.** The unit is serviced (reloaded and repaired) while docked, idle or
empty, and a unit that is damaged but has a full clip is serviced too. The clip
refills in `reloadTicks`; hit points come back evenly (the missing points over
the ticks left), whole at the end. `Stop` ends any order, so it sends the aircraft
home. A parked aircraft with a weapon still fires at enemies in range.

### 4.4 Launched drones

A weapon may set `launches: <unit type>` instead of a projectile: firing spawns
that unit next to the shooter, owned by the same player, with an attack order
on the target and `master` set to the shooter. The weapon's range is the
control range. If the master dies a `radio` drone falls harmlessly; `autonomous`
ones finish the attack.

**As built.** The drone falls harmlessly when its master is gone or dead if its
link is `radio` or `fibre` (somebody is steering it); `gnss`, `autonomous` and
unlinked drones finish the attack. A launched drone whose target dies picks the
nearest visible enemy its warhead can engage inside its own sight. A building may
be the master (Sting nest); a building whose weapon launches needs no
`turretTurnRateDeg`. The launch needs the target visible like any shot; the Ukrainian
FPV team therefore sees 1000 centi (the drone feed).

### 4.5 Links and jamming

`link: radio|fibre|gnss|autonomous` on a type; absent is `none` (unjammable).
`jammer: { radiusCenti }` on a type. Inside a hostile jammer's radius:

| Link | Effect |
|---|---|
| `radio` flyer | Falls and dies, harmless |
| `radio` ground | Stops: cannot move or fire until out of the area |
| `gnss` | Its warhead lands up to `gnssScatterCenti` off target (seeded) |
| `fibre`, `autonomous` | None |

Only Russia has a jammer.

**As built.** `gnssScatterCenti` is a field of the type (seeded draw over the disc,
on top of the warhead's own scatter). A jammer works for its enemies only; its
own side, `fibre`, `autonomous` and unlinked units are never affected. A jammed
ground robot keeps its order and resumes when free.

### 4.6 Roster

**Russia** — mass, aviation, EW.

| Id | Built at | Role | Weakness |
|---|---|---|---|
| `ru-airfield` | dozer, needs vehicle factory | Produces and reloads aviation | Big, expensive |
| `ru-su-34` | airfield | Glide bombs from far: `sortie` clip 2, range beyond Pantsir and Gepard | Patriot; scarce |
| `ru-orlan` | airfield | Unarmed spotter, long sight, weak | Any `low` weapon |
| `ru-geran-site` | dozer, needs supply center | Launch rails | Static |
| `ru-geran-2` | site | Cheap, slow, `gnss`; waves | Guns, Sting |
| `ru-geran-3` | site | Jet, fast, expensive, same warhead class | Harder for Sting; Patriot |
| `ru-molniya-crew` | barracks | Launches `ru-molniya`: `fibre`, short range, immune to everything electronic | Crew exposed close to the front |
| `ru-molniya` | launched | Fixed-wing FPV | Infantry fire |
| `ru-pantsir` | vehicle factory | Mobile `all` AA, missiles | Saturation |
| `ru-pole-21` | vehicle factory | Unarmed mobile jammer | Ukraine must hit it with guns or missiles |

**Ukraine** — robots, interceptors, scarce precision.

| Id | Built at | Role | Weakness |
|---|---|---|---|
| `ua-drone-workshop` | dozer, needs barracks | Builds robots and the bomber | Static |
| `ua-ratel` | workshop | Ground kamikaze, `radio`: huge damage to armour and trenches, slow | Jammer, small arms |
| `ua-tw-12-7` | workshop | Crewless tracked machine gun, `radio` | Jammer stops it; light armour |
| `ua-baba-yaga` | workshop | Heavy hexacopter bomber: `sortie` clip 4, drops on what it flies over, slow | Any `low` weapon |
| `ua-fpv-team` | barracks | Launches `ua-fpv`: `radio`, long range, strong against armour | Jammer kills them all |
| `ua-fpv` | launched | Racing quad | Jammer, small arms |
| `ua-sting-nest` | dozer, needs supply center | Automatic interceptor launcher, `low`, air only | Saturation |
| `ua-sting` | launched | `autonomous` ram | Cannot reach `high` |
| `ua-gepard` | vehicle factory | Mobile `all` gun AA, short range, great against drones | Outranged by Su-34 |
| `ua-patriot` | dozer, needs supply center | Long-range `all` AA building, only one that reaches a Su-34 | Very expensive, immobile, slow reload |
| `ua-missile-site` | dozer, needs vehicle factory | Launch pad | Static |
| `ua-flamingo` | missile site | Huge warhead, map-wide, inaccurate, big and easy to hit, `gnss` | Pantsir |
| `ua-storm-shadow` | missile site | Precise penetrator against buildings, `lowObservable`, `gnss`, slow to build | Cost, no splash |

The counters form a loop: Geran waves drain Patriot, Sting beats Geran-2, Pole-21
blinds FPVs and robots, Molniya ignores Pole-21 and kills Gepard, Pantsir kills
Flamingo, Storm Shadow slips past Pantsir, Patriot pushes the Su-34 back.

Ids of the weapons and balance numbers live in `data/factions/*.yaml`.

## 5. Architecture

* `rules.rs`: `LocoKind::Air`, `AirClass`, `OneWayDef`, `SortieDef`, `Link`,
  `JammerDef`; weapon `anti_air`, `anti_ground`, `launches`.
* New `crates/sim/src/air.rs`: flight step, airborne test, one-way detonation,
  sortie state, launched drones, jamming pass. `world.rs` and `combat.rs` only
  call it; `is_valid_target` gains the air test.
* `Entity`: `ammo`, `master`, `fuel`. `Order::ReturnToBase`. All of them hashed
  and saved; optional in saves with defaults, so old saves load.
* Types are added with a per-faction `lateTypes` list, and weapons with a
  `lateWeapons` list, so every existing type and weapon index stays (spec 36):
  the type order is common, factions, global `lateTypes`, then each faction's
  `lateTypes`; the weapon order is the factions' `weapons`, then their
  `lateWeapons`.
* `Entity` also has `reload` (ticks spent servicing); `fuel` counts ticks under
  way (§4.2). Hash tags 4..7 and order tag 12 are written only when set, so
  worlds without flyers keep their hashes. Save entities carry optional `ammo`,
  `reload`, `master`, `fuel` and the order kind `returnToBase`.
* Snapshot: entity flags `FLAG_AIRBORNE` (128) and `FLAG_JAMMED` (256), and an air
  tail after the rally records (`count, then entity id, ammo, clip, fuel permille,
  master id or -1` per sortie flyer, one-way unit or launched drone; absent when
  there are none). `jammer`, `oneWay`, `sortie`, `link`, `lowObservable`,
  `gnssScatterCenti` and the locomotor `class` and `altitudeCenti` go through the
  ruleset.
* Client: flyers at altitude with a ground shadow, spinning props, smoke trail
  and the bomb model; jam radius drawn when selected; ammo pips.
* AI: each faction builds its new structures in `buildOrder` and uses them in
  `taskForces`; one-way units attack the nearest known enemy building.

## 6. Assumptions

* Bombs and shells cannot be intercepted; only entities can.
* Unarmed flyers (Orlan) and AA-only weapons are never sent against targets they
  cannot hurt; the AI builds the new structures at the end of its `buildOrder` and
  keeps AA units out of its task forces.
* Baba Yaga is a flyer with a clip, so Ukraine has one reloading air unit but
  no jet.
* Lancet, naval drones and repeater drones stay in the pool.
* Ukraine has no jammer: its answer to drones is kinetic.

## 7. Acceptance

* A player can order every unit above, and each behaves as in §4.
* Two identical matches produce the same hash with drones in play.
* Saves round-trip mid-flight; old saves load.
* `?load=air-war`, `?load=robots-vs-jammer` and `?load=deep-strike` show them.
