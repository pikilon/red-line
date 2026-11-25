# 63 — Player rank and General's powers

Status: built (first version). Depends on `50-veterancy.md` (experience values)
and `62-mission-scripts.md` (reinforcement spawning). Issue #476. Decisions:
D-02 (the sim owns the rules; the client sends commands), D-14 (each faction
gets its own paradrop; effects are shared).

## 1. Goal

Besides the experience of single units, the player has a rank. Destroying
enemies earns skill points; each rank grants General's points; points buy
powers from a panel in the HUD; a bought power is cast at a point of the map
and then recharges.

## 2. Precedent (`generals-precedent`, Zero Hour)

* Skill points come only from kills of enemies: the victim's `SkillPointValue`
  (falling back to `ExperienceValue`), nothing for unfinished buildings, allies
  or self-kills, capped at the top rank's threshold (`Player.cpp`
  `addSkillPoints`, `addSkillPointsForKill`; `ThingTemplate.cpp`).
* Ranks: `SkillPointsNeeded`, `SciencePurchasePointsGranted` per rank
  (`RankInfo.cpp`, `Player::setRankLevel`). Rank 1 starts with its grant.
* A Science is bought with purchase points when its prerequisites are owned
  (`Science.cpp`, `Player.cpp`); there is no rank field per Science, the rank
  gate comes from the points granted per rank.
* Special powers recharge by `ReloadTime`; the ready frame is stored
  (`SpecialPower.cpp`, `SpecialPowerModule.cpp`).
* Not verified: the shipped numbers (rank thresholds, points per rank, reload
  times, costs). The Zero Hour install was not available to read.

Copied: kill-only skill points from the experience value, points per rank,
purchase by points, ready-tick recharge. Deviations: see §7.

## 3. Rank and points

* Skill points = sum of the experience values of the enemies the player's
  units destroy (same payment as spec 50 §3.1). They never decrease and cap at
  the last rank's threshold.
* The rank is derived: the number of `general.ranks` whose `xp` is reached.
  Everyone is rank 1 at the start.
* General's points available = points granted by the ranks reached minus the
  cost of the powers bought. Rank 1 grants 1 point.
* Data (`data/rules/globals.yaml`, `general.ranks`): ranks at 0, 300, 800,
  1600 and 3000 skill points, granting 1, 1, 1, 1 and 3 points.

## 4. Powers

`general.powers` is the catalogue; each entry has a `rank` needed to buy, a
`cost` in points, `rechargeTicks`, an optional `factions` list (empty = every
faction) and an `effect`:

| Power | Rank | Cost | Recharge | Effect |
| --- | --- | --- | --- | --- |
| Recon scan | 1 | 1 | 900 | every cell within 15 tiles of the target becomes explored for the caster |
| Emergency repair | 2 | 1 | 1800 | own tracked and wheeled vehicles within 6 tiles regain 50 % of their maximum hit points |
| Artillery barrage | 3 | 2 | 3600 | 12 blasts spread over 4 tiles around the target, each 40 high-explosive damage within 1.5 tiles of enemy ground entities (own units and flyers are spared) |
| Paradrop (per faction) | 4 | 3 | 3600 | 5 riflemen of the faction land around the target |

Commands (all validated by the sim, anything invalid is ignored):

* `BuyPower { power }`: needs the faction's permission, the rank, enough points
  and the power not owned. It is ready to cast at once.
* `CastPower { power, target }`: needs a bought power whose `ready_tick` has
  passed and a target inside the map. It applies the effect and sets
  `ready_tick = tick + rechargeTicks`.

The barrage draws its impact points from a stateless `SplitMix64` seeded by
tick, player and power (deterministic, no state to save). Paradrop units appear
through the reinforcement rule of spec 62 §4 at fixed offsets around the target.

## 5. State, hash, saves, snapshot

* Per player: `general_xp` and the bought powers with their `ready_tick`.
* Hash: both are hashed behind a tag byte, only when non-empty, so existing
  matches keep their hashes.
* Save: `generalXp` and `powers: [{ id, readyTick }]` in the player state,
  omitted when empty; commands are saved by power id. Example saves can set
  `generalXp: [..]` per start.
* Snapshot tail (after the score counters, written only when some player has
  skill points or powers): `count, (player, skillPoints, powerCount,
  (power, readyTick)*)*`.

## 6. Interface

* A rank badge in the top bar: `Rank N` with the skill points to the next
  rank, and the free General's points.
* A **General's powers** button in the top bar opens a panel listing the
  catalogue of the player's faction: name, description, cost and rank; a
  **Buy** button when affordable, a **Cast** button once bought, and the
  recharge shown as seconds left.
* **Cast** puts the cursor in targeting mode (crosshair); a left click on the
  map casts the power there, Escape or right click cancels.
* The AI does not use powers in this version.

## 7. Assumptions

* The numbers in §3 and §4 are tuned for Red Line's kill values (50–200 per
  unit), not copied from Zero Hour's INI files, which could not be read.
* A bought power is ready at once; Zero Hour starts the reload on purchase.
* Skill points come only from units' kills (as spec 50) and not from kills
  made by a power, which have no shooter.
* No prerequisites between powers (a Science tree) in this version.
* Powers are not in multiplayer-specific UI; they travel as ordinary commands.
* Paradrops land at fixed offsets, with no aircraft animation.

## 8. Acceptance criteria

* AC-63-01: the rank derives from skill points and each rank grants points.
* AC-63-02: destroying an enemy earns its experience value as skill points.
* AC-63-03: buying needs rank, points and faction, and works once.
* AC-63-04: a power is cast at a target, then recharges.
* AC-63-05: emergency repair heals own vehicles in the area only.
* AC-63-06: the barrage hurts enemy ground units in the area only.
* AC-63-07: the paradrop lands the faction's infantry.
* AC-63-08: skill points and powers are hashed, saved and deterministic.
* AC-63-09: the snapshot carries rank and powers; the example save
  `generals-powers` starts at rank 3 with 3 points.
* AC-63-10: the client shows the rank badge and the powers panel; buying and
  casting send the commands (vitest).
