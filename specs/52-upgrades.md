# 52 — Upgrades purchased at buildings

Status: built (issue #474). Depends on `03-phase2-core-loop.md` (queues),
`37-selling-buildings.md`, `41-command-bar.md`, `50-veterancy.md` and
`19-save-games.md`. Decisions: D-02 (deterministic fixed point), D-05 (balance
in data), D-06 (computer AI).

## 1. Goal

The player buys upgrades in a building's command bar. An upgrade costs money
and takes time, like a unit, and once finished it improves every unit of its
list the player owns now or builds later. Each faction starts with two.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`. Shipped INI values
were not read (no game data on disk).

* Upgrades are `PLAYER` (default) or `OBJECT` scope
  (`Common/System/Upgrade.cpp:75-98`). A player upgrade lives in a player
  bitmask and on completion refreshes every object of the player
  (`Player.cpp:3037-3107`); new objects get it on creation
  (`Object.cpp:2434-2460`).
* `queueUpgrade` checks money, that the producer's command set lists the
  button, no duplicate in the queue and no second copy of a player upgrade
  anywhere. The full cost is withdrawn at once and the upgrade takes one slot
  of the same queue as units, so it blocks the units behind it
  (`ProductionUpdate.cpp:228-306`).
* Build time is a flat `BuildTime`; cancel refunds the full cost
  (`ProductionUpdate.cpp:332-381`). Death and sale cancel and refund the whole
  queue (`ProductionUpdate.cpp:1133-1165`).
* Effects are modules fired once per object: `MaxHealthUpgrade` adds health,
  `WeaponBonusUpgrade` raises weapon output, `ArmorUpgrade` swaps armour
  (`GameLogic/Object/Upgrade/*.cpp`).
* Upgrades have no prerequisites besides the building that offers them.
* The skirmish AI buys upgrades only through scripts
  (`AIPlayer::buildUpgrade`, `AIPlayer.cpp:1752-1845`); the choice lives in
  data.

## 3. Rules

* An upgrade is a type of `category: upgrade`, listed in a faction's
  `upgrades:` (after every other type, so earlier type indices stay). It has
  `cost`, `buildTicks` and an `upgrade` block:
  `{ appliesTo: [type ids], healthPercent, damagePercent }` (both default
  100). A building offers it by naming it in `produces`.
* **Purchase.** `Produce` of an upgrade follows the unit rules (own complete
  producer, credits, free slot) and is also refused when the player already
  owns it or has it queued in any building. The cost is paid at once.
* **Completion.** The finished head is removed from the queue and added to
  the player's upgrade list. Nothing spawns.
* **Effect.** An owned upgrade multiplies by its percents the maximum hit
  points and the weapon damage of every unit of its `appliesTo` the player
  owns, now or later; upgrades and ranks stack by multiplication. When a
  health upgrade completes, every affected unit alive gains the extra hit
  points too (Zero Hour `MaxHealthUpgrade` with added current health), so its
  share of health does not drop.
* **Cancel, sale, death.** Cancel refunds the last queued item as before. A
  producer that is destroyed now refunds its whole queue, units included, as a
  sale does. Upgrades already owned stay when the building is lost.
* **Capture.** Not applicable: player buildings cannot be captured yet.
* **Command bar.** The producer shows the upgrade as one more tile with a
  shield badge, its name and cost. An owned upgrade shows a check mark in
  place of the cost, is labelled *(done)* and is disabled; one queued anywhere
  is disabled without the short-of-credits colour.
* **Health bars.** Every client sizes health bars with every player's
  upgrades, so upgraded units, own or enemy, show full bars when unhurt.
* **AI.** An AI personality lists `upgrades: [{ upgrade, minTick }]`; from
  `minTick` on it buys the first one it does not own whose producer it has,
  when it can afford it and the producer queue is empty.

## 4. First upgrades (`data/factions/*.yaml`)

| Faction | Upgrade | Building | Applies to | Effect | Cost | Time |
| --- | --- | --- | --- | --- | --- | --- |
| Russia | Ratnik body armour | Barracks | rifleman, RPG gunner, Molniya crew | health +25% | 800 | 30 s |
| Russia | Kontakt-5 reactive armour | Vehicle factory | BRDM, BMP-2, T-72B3 | health +25% | 1200 | 40 s |
| Ukraine | Western optics | Barracks | rifleman, Stugna team, FPV team | damage +20% | 800 | 30 s |
| Ukraine | Western ammunition | Vehicle factory | Kozak, Bradley, Leopard 2A4 | damage +20% | 1200 | 40 s |

## 5. Architecture

* `crates/sim`: `Category::Upgrade`, `TypeDef::upgrade`; `Player::upgrades`
  (sorted type ids, hashed and saved); completion in `update_production`;
  `max_hp` and `rank_weapon` apply the percents; death refund in
  `remove_dead`; AI purchase in `ai.rs`.
* Snapshot: after the air tail (then always written), `count, (player,
  type)*` of every player's upgrades; both are left out when empty. Upgrades
  are public, as Zero Hour shows them on the units.
* Saves: `PlayerState.upgrades` (type ids, omitted when empty); a setup's
  `upgrades: [[ids of start 0], [ids of start 1]]` grants them at tick 0.
* Client: upgrade tiles in `commandPanel.ts`; `maxHpOf` in
  `sim/veterancy.ts` counts upgrades; names in `i18n`.
* Example save `?load=upgrades`: a Ukrainian base that owns Western optics,
  Russian riflemen with Ratnik armour nearby, and Western ammunition ready to
  buy at the vehicle factory.

## 6. Assumptions

* Only `PLAYER` scope; `OBJECT` upgrades (one building's own) wait for a use.
* Effects are health and damage only; armour swaps and new weapons wait.
* Upgraded units look the same; the change shows in health bars and damage.
* Values in §4 are ours (Zero Hour's shipped numbers were not available);
  they live in data and can be rebalanced.
