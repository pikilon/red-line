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
* **D5 — launchers carry finite charges** (§4.4), refilled next to a supply
  source; Zero Hour has none for infantry launchers.

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
* **Fixed-wing and rotorcraft.** Only rotorcraft may hover: a type with
  `hover: true` (`ua-baba-yaga`, `ua-fpv`, `ua-sting`). Every other flyer is
  fixed-wing and **never has speed 0 while airborne**: it turns at a limited
  `turnRateDeg`, never in place, and flies at no less than `minSpeedPercent` of
  its speed (locomotor, 60). It circles, on a circle whose radius follows from
  speed and turn rate (`speed / turn rate`), when it waits, is idle with no
  base or holds; it shoots on the move when the target is in range and inside a
  nose cone (`noseConeDeg`, locomotor, 20 degrees each side); a missed window
  means coming round again. Zero Hour: `JetOrHeliCirclingDeadAirfieldState`
  and the wing-type circling of `getAircraftPath`. A parked aircraft and a unit
  waiting on its rail stay still and are not airborne.
* **As built (rotorcraft).** A rotorcraft's heading turns at `turnRateDeg` and it
  moves along it at its top speed, at a quarter of it while the goal is more
  than 45 degrees off the heading; within two steps of the goal it flies
  straight at it, so it always arrives (turn rates are 150 degrees per second or
  more). A rotorcraft with a weapon flies until the target is inside the weapon
  range (a `lowObservable` target: a third of it) and then holds there, hovering,
  needing no aiming.
* **As built (fixed-wing).** Speed is the top speed, or the minimum speed while
  the goal is more than 45 degrees off the heading (a tighter circle). There is
  no turret, `stationaryFire` or `aim_turret` pause: `fire` and `fire_ground`
  ask only whether the target is inside the nose cone
  (`World::flyer_aligned`), so a flyer fires on any tick of a pass. Loitering
  (idle, no base, empty with no base, an unarmed attack order) turns at the full
  turn rate at the minimum speed, a circle of radius `minSpeed / turnRate`
  starting where it is. A `Move` of a flyer without a `sortie` never ends: it
  orbits the ordered point on a circle of 1.25 times that radius (a vector field
  towards the tangent, with a margin so the turn rate can follow it), so the Orlan
  circles over its point; a sortie flyer ends the `Move` near the point and
  flies home. An armed flyer (Su-34) keeps flying at the target through its
  weapon range and past it: the bomb is released inside range and cone, the clip
  empties and it turns for base (the kept `Attack` is remembered), or, with
  rounds left, it comes round. **Reaching a target inside the turning circle.**
  Each tick the flyer predicts pure pursuit from its heading (a look-ahead of up
  to one full circle, only needed within two top-speed turning circles of the
  goal) and turns at the goal only if that gets inside the arrival distance; if
  not it flies straight on, overshoots, and comes round once pursuit works, so
  no one-way unit circles a target forever. The prediction is the pursuit it then
  flies, so the answer does not flip-flop. (A first version slowed to the minimum
  speed near the target for a tighter turn; that made waves arrive late under
  anti-air and was dropped.) A flyer pressing a map edge turns anyway.
* Airborne means: the order moves the flyer, or it is `Idle` more than
  `DOCK_RANGE_CENTI` (250) from the footprint of an own complete building that
  produces its type. An empty sortie aircraft docked with an attack remembered
  is parked too. A one-way drone with no master and no producing building (one
  a save placed) is parked on the ground while idle: it burns no fuel. An attack
  order a unit's weapon (or warhead) can never carry out by height is ignored.
  Flyers can be placed over any cell. The snapshot marks a flyer with speed as
  moving, so the client banks an idle circling flyer too.

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
A fixed-wing one-way unit arrives by the pursuit rule of §4.1 (it never hovers
to line up). The blast is a `CombatEvent::Detonate` with `projectile = u32::MAX`, followed by
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
home. A parked aircraft with a weapon still fires at enemies in range. A sortie flyer is
a pass: the glide bomb has a short cooldown (3 ticks), so both rounds of the clip
go in one approach from beyond the anti-air, and the aircraft then turns for
its base (a fixed-wing flyer cannot stop to bomb, §4.1). If the first approach
misses the nose cone or the range it comes round again.

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

**Charges.** A drone is ammunition. `charges: { max, refillTicks,
refillRadiusCenti? }` on a type whose weapon `launches`. It starts with `max`
(a unit a save places starts full, and a save without the field loads full), every
launch spends one, and with 0 it cannot launch: it fires nothing, drops its attack
order and idles, but stays selectable and can be ordered to move. One charge
comes back every `refillTicks` while the unit is below `max` and:

* with `refillRadiusCenti` (a crew on foot): an own unit or complete building with
  `resupplies: true` (supply truck, supply center, barracks) is within that
  radius of it (footprint distance for a building); leaving the radius resets the
  clock, so a crew must be resupplied, by going back or by bringing a truck;
* without it (the Sting nest): by itself, anywhere, so only saturation beats it.

| Type | max | refillTicks | Radius | Launch cooldown |
|---|---|---|---|---|
| `ua-fpv-team` | 4 | 300 | 500 | 150 |
| `ru-molniya-crew` | 3 | 360 | 500 | 240 |
| `ua-sting-nest` | 6 | 60 | none | 40 |

The numbers are asymmetric on purpose: the radio FPV is cheaper to refill and
stronger in the field but jammable; the fibre Molniya is jam-proof, so its crew
carries fewer.

Precedent (`generals-precedent`, same commit): a Zero Hour spawner keeps at most
`SpawnNumber` live spawns and queues one replacement per death at
`now + SpawnReplaceDelay`, automatic, free, checked every 15 frames
(`Object/Behavior/SpawnBehavior.cpp:210-263, 754-771`; Stinger Site: 3 spawns,
30000 ms) with no supply check (`:826-847`): the Sting nest is that, as a
charge per `refillTicks` rather than per death. Jets are a clip plus a reload at
an airfield (`Weapon.ini:1662-1706`, `JetAIUpdate.cpp:1459-1482`). Zero Hour has
no supply-gated refill for infantry-sized launchers (its drones are a one-time
upgrade with no refill, `ObjectCreationUpgrade.cpp:92-98`): needing a supply
source is a deliberate deviation (D5) so a drone crew is tied to logistics.

**As built.** `Entity` gets `charges` and `charge_clock`: hashed with tags 8 and 9,
written only when a launcher has spent a charge or the clock runs, so worlds
without launchers or with full ones keep their hashes; saved as optional
`charges` (absent: full) and `chargeClock`. The charge is spent in
`launch_drone`; the refill and the dropped order are `charges_step`, run for
every entity (a building too) at the start of the air phase. The gate is in
`fire`, after the trench fight, so an empty crew still uses its sidearm in a
trench. The snapshot air tail lists a launcher with its charges as `ammo` and
`max` as `clip`, so the client shows the same pips as for a clip when it is
selected (all dim when empty). **AI:** an attacker launcher crew that is idle
with fewer than half its charges (`low_on_charges`) is sent by `Move` to its
nearest own complete `resupplies` building (`resupply_orders`) and waits there
until the refill brings it to half, when step 8 sends it on again; launched
drones remain outside the pool.

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

**AI as built.**
* Flyers and one-way units are launched with an `Attack` on the nearest visible
  enemy building, else on a remembered one, else `AttackGround` on the enemy
  start; never `Move`. A sortie aircraft is sent again only with a full clip.
  Launched drones and `guards` are never in the pool.
* `guards: [{unit, count, minTick}]` on a personality: units kept built at home
  (Pantsir, Pole-21, Gepard), wanted from `minTick` or at once while visible enemy
  flyers are inside the defense radius; idle armed guards then attack the nearest
  such flyer. Airborne intruders no longer count as the ground threats of
  spec 05 step 5, which would stop production for as long as a drone circled.
* A trigger with `once: true` is an opening: the first eligible one not yet taken
  is chosen before the weighted roll, once per match (`opened` in the AI save).
* Step 5 fix: with intruders in the base and an empty pool, production (step 6)
  still runs, so the AI does not sit on its credits for the rest of the match.
* Balance as tuned (`first-line`, seeds 1-5): before the flight model the balanced
  pair 1 / 2 / 2 undecided, the rush pair 3 / 1 / 1 undecided (Ukraine / Russia /
  neither). With the flight model (§4.1) and launcher charges (§4.4): the balanced
  pair 0 / 2 / 3, the rush pair 4 / 1 / 0.

**As built (client).**

* `matchSnapshot.ts` decodes the flags and the air tail (`air`: id, ammo, clip,
  fuel permille, master); `rules.ts` carries the new type, weapon and locomotor
  fields. `render/flyers.ts` eases each flyer to its locomotor altitude plus
  0.5 tile of clearance (so it is never hidden behind a building), banks it into
  turns, and keeps the rotor time. A unit whose id is new when it appears (a
  launched drone) climbs from the ground; one already flying when first seen
  starts at height.
* Models: nodes named `prop` or `prop_<n>` stay out of the hull (`TypeModel.props`),
  spin about their thinnest axis (a rotor about Y, a pusher propeller about its
  nose), alternate direction, and rotors of one geometry share a single instanced
  mesh. Flyers cast no sun shadow; a dark ellipse is drawn on the ground, shifted
  away from the sun by the height. The KAB glide bomb is a procedural winged bomb
  that only falls when released from a flyer (`DROPPED_FROM`).
* A flyer shot down (death with no killer while airborne) tumbles to the ground
  with a smoke trail and a crash puff, or a fireball when it is big; a one-way
  unit's own detonation (projectile id -1, killer itself) is the warhead's
  explosion sized by its splash and leaves no wreck. Missiles and jet drones
  (one-way, class `high`) leave a smoke trail.
* Clicks and boxes meet a flyer where it is drawn. Orders offer an airborne enemy
  only to the units whose weapon reaches its class (`input/engage.ts`) and keep
  anti-air weapons off the ground; one-way units have Force fire and attack any
  point. A selected jammer draws its radius, a selected sortie unit its ammo
  pips, and every jammed unit a warning mark (`render/airOverlay.ts`).
* Fog needs nothing extra: the simulation lists an enemy flyer only while it is
  visible.

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
