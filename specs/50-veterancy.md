# 50 — Veterancy: units gain rank from kills

Status: built (issue #473, 2026-11-10). Touches `03` (combat, deaths phase,
state hash, match snapshot flags), `17` (`last_hit` now feeds a game rule),
`19` (save format, setup `rank`, example save `veterancy`), `39`/`40`/`43`
(repair, healing and reload fill up to the rank's hit points), `42` (selection
name). Decisions: D-05 (every number in `data/`), i18n for every
player-facing string, sim determinism. General's powers (#476) will build on
the experience added here.

## 1. Goal

Units earn experience from the enemies they destroy and are promoted to
**veteran**, **elite** and **heroic**. Each rank makes the unit tougher and
deadlier, the two highest repair themselves, and the rank shows as chevrons
over the unit and in the name of the selection.

## 2. Precedent (`generals-precedent`, Zero Hour)

```
Question: How does Zero Hour implement unit veterancy (XP, ranks, bonuses, self-heal,
  UI, sources of rank)?
Source: electronicarts/CnC_Generals_Zero_Hour@0a05454d8 (GeneralsMD/Code/GameEngine/).
  Data: NOT READ (INIZH.big unavailable): every shipped INI number is unverified.
Findings:
* ExperienceValue and ExperienceRequired are 4-entry lists [REGULAR, VETERAN, ELITE,
  HEROIC]; IsTrainable is a bool — ThingTemplate.cpp:134-136, 1013-1018 [fact].
  ExperienceValue is what the victim is worth at its own current level;
  ExperienceRequired[n] is the cumulative XP to reach level n, index 0 unused —
  ExperienceTracker.cpp:174-183 [fact]. No code ties them to BuildCost [fact].
* Only Object::scoreTheKill (Object.cpp:2914) grants XP, when ActiveBody::attemptDamage
  takes health from >0 to <=0 (ActiveBody.cpp:345, ~668); plain damage gives nothing
  [fact]. Killer and victim must be ENEMIES (no allies, neutrals, own units); victims
  under construction give nothing (Object.cpp:2957-2963) [fact]. Buildings are not
  excluded as victims [fact].
* For projectiles the damager is the launcher (Weapon.cpp ~1478-1490); projectiles
  sink their XP to the launcher (Weapon.cpp ~3045, ExperienceTracker.cpp:150-160)
  [fact]. Transport-death passenger kills call no scoreTheKill [inference].
* Levels REGULAR, VETERAN, ELITE, HEROIC (GameCommon.h:208-216). HealthBonus_Veteran /
  Elite / Heroic are percentages (GlobalData.cpp:404-406); on a level change max health
  is multiplied by bonus[new]/bonus[old] with PRESERVE_RATIO, so current health keeps
  its percentage and the unit is not fully healed (ActiveBody.cpp:1412-1456, 897-913)
  [fact].
* Weapon bonuses per condition VETERAN / ELITE / HERO: DAMAGE, RADIUS, RANGE,
  RATE_OF_FIRE, PRE_ATTACK (Weapon.h ~258-275), set per level in
  Object::onVeterancyLevelChanged (Object.cpp:3088-3147) [fact].
* Veterancy does not heal by itself: an upgrade-gated AutoHealBehavior does
  (HealingAmount, HealingDelay, StartHealingDelay after damage); which levels get it is
  INI data; it heals only while health < max (AutoHealBehavior.cpp:160-184) [fact].
* Display: Drawable::drawVeterancy draws the SCVeter1..3 chevrons by the health bar
  (Drawable.cpp:278-281, 3797-3844); the control bar uses SSChevron1L..3L
  (ControlBar.cpp:1271-1273); level-up sound SoundPromotedVeteran/Elite/Hero and a
  level-gain animation, only on a level up (ActiveBody.cpp:1419-1437, Object.cpp ~3150)
  [fact].
* Units can be created with rank: ProductionVeterancyLevel, VeterancyGainCreate
  (science-gated), crates, map objects (Object.cpp:475-480, 3480-3484) [fact].
Values: code defaults only (all bonuses 1.0). Shipped ExperienceValue / Required,
  HealthBonus_*, WeaponBonus and AutoHeal numbers: NOT READ.
Red Line recommendation: kill-only, enemy-only, not under construction, victim's
  level value, launcher credit; integers in data/; health bonus multiplicative with the
  ratio preserved; self-heal data-driven; chevrons and level-up animation client-only.
```

## 3. Behaviour

### 3.1 Experience (`experience` on a type, `Entity::xp`)

* A type may carry `experience: { value: [r, v, e, h], required: [v, e, h] }`
  in `data/factions/*.yaml`. `value` is what an enemy earns for destroying it
  while it holds each rank; `required` is the total experience for veteran,
  elite and heroic. Only a type with `required` can be promoted (Zero Hour
  `IsTrainable`).
* Experience is paid in the deaths phase, just before the dead are removed, in
  ascending victim id. The victim pays the entity that damaged it last
  (`last_hit`), if that entity is alive and belongs to another player. A drone
  launched by a crew or a nest passes its kills to its launcher.
* Nothing is paid for: damage without a kill, friendly fire, a unit crushed by
  a vehicle, an unfinished building, neutral depots, or when the killer is
  already dead.
* Buildings and unarmed units have a `value` (they are worth experience) but
  no `required`.

### 3.2 Ranks (`Entity::rank`)

* `0` regular, `1` veteran, `2` elite, `3` heroic. A unit is promoted the
  moment its experience reaches a threshold; one big kill can skip ranks.
  Ranks are never lost.
* Experience and rank are in the state hash (written only once non-zero, so
  older worlds keep their hashes), in saves (`xp`, `rank`, omitted at zero) and
  in the match snapshot: the rank sits in bits 9-10 of the entity flags.
* Setup saves may give a unit `rank: 1..3`; it starts with exactly the
  experience that rank needs. `hpPercent` is then a share of the rank's hit
  points.

### 3.3 Bonuses (`veterancy` in `data/rules/globals.yaml`)

| Rank | Hit points | Damage | Rate of fire |
| --- | --- | --- | --- |
| Regular | 100 % | 100 % | 100 % |
| Veteran | 120 % | 110 % | 120 % |
| Elite | 130 % | 120 % | 140 % |
| Heroic | 150 % | 130 % | 160 % |

* Maximum hit points are `floor(hp * healthPercent / 100)`. On promotion the
  unit keeps its share of health (rounded up); it is not healed. Repair pads,
  barracks healing, airfield repair and the computer's retreat rule all use
  the rank's maximum.
* Damage is `floor(damage * damagePercent / 100)` before armour and cover; the
  cooldown is `max(1, floor(cooldown * 100 / rateOfFirePercent))`. The rank
  that counts is the shooter's when the shot lands.

### 3.4 Self-heal (`veterancy.selfHeal`)

* From `fromRank` (2, elite) on, every `intervalTicks` (15, one second) a
  living, damaged unit gets `permille` (10, 1 %) of its maximum hit points
  back, at least 1, up to its maximum. Units being healed in a barracks or
  repaired at a pad are left to that.

## 4. Client

* **Chevrons**: one, two or three gold chevrons float by the health bar of
  every promoted unit on show, own or enemy, selected or not. A unit that is
  promoted while on show pulses its new chevrons for 1.5 s.
* **HUD**: the selection name adds the rank: "Leopard 2A4 (Veteran)"
  (`rank.veteran`, `rank.elite`, `rank.heroic`, `rank.label` in
  `client/src/i18n/en.json`).
* Health bars and the repair and heal offers measure against the rank's hit
  points.
* Example save `veterancy` (`?load=veterancy`): a regular Leopard destroys a
  park of worn supply trucks and becomes veteran after about 15 s and elite
  after about 30 s, next to a veteran, a damaged elite (it repairs itself) and
  a heroic Leopard and a heroic rifleman.

## 5. Assumptions

* A1: The shipped Zero Hour numbers could not be read (see the note). The
  bonus table is the Zero Hour table as commonly documented (health 120 / 130 /
  150 %, damage 110 / 120 / 130 %, rate of fire 120 / 140 / 160 %, self-heal
  for elite and heroic) and must be checked against `GameData.ini` when the
  game data is mounted. All of it is data and can be tuned.
* A2: Zero Hour sets experience by hand per unit. Here every type follows one
  rule, written out per type so balance can tune it: `v = cost / 10` rounded
  to 5 (minimum 5; an HQ counts 40, a launched drone 5); `value = [v, 2v, 3v,
  4v]`; `required = [4v, 8v, 16v]`, i.e. four, eight and sixteen kills of its
  own kind. Half those thresholds made computer matches snowball (Russia won
  6 of 6 `first-line` seeds before minute 13), so they were doubled.
* A3: Trainable types are the armed units, including drone crews and sortie
  aircraft. Buildings (defences too), unarmed units and one-way drones and
  missiles never gain rank.
* A4: Credit goes to the last enemy that damaged the victim, not strictly to
  the hit that killed it; a later non-combat death (e.g. passengers dying with
  their transport) still pays that enemy. Zero Hour pays nothing for
  passengers.
* A5: The self-heal has no delay after damage (Zero Hour's `StartHealingDelay`
  could not be read); the slow rate stands in for it.
* A6: Only damage and rate of fire rise; range, splash radius and aim time do
  not. A launcher's rank does not strengthen the drones it launches, and a
  trench fight (spec 35 §5c) ignores rank.
* A7: No promotion sound yet (it needs new audio assets); the pulse is the
  only level-up feedback. No general's experience or rank on production
  (#476).
* A8: The computer AI does not reason about rank; it benefits like a player.

## 6. Acceptance

`crates/sim/tests/veterancy.rs`:

* AC-50-01: a Leopard earns 60 per supply truck and is a veteran at 480, with
  120 % hit points.
* AC-50-02: a heroic victim pays its heroic value; one kill can skip a rank.
* AC-50-03: a type without thresholds never holds a rank; a death with no
  enemy hit pays nobody.
* AC-50-04: promotion keeps the share of hit points.
* AC-50-05: a heroic Leopard deals 130 % damage and its cooldown is 100/160.
* AC-50-06: an elite unit regains 1 % per second up to its maximum; a veteran
  does not.
* AC-50-07: rank changes the state hash and survives a save and load.
* AC-50-08: the match snapshot carries the rank in the flags.
* AC-50-09: an FPV drone's kill goes to the team that launched it.
* AC-50-10: in the example save the rookie becomes veteran and then elite.

`client/src/sim/veterancy.test.ts`, `client/src/render/rankMarkers.test.ts`:
rank decoding, rank hit points, the ranked name, one marker per promoted unit
and the promotion pulse.
