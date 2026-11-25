# 57 — Score screen at the end of a match

Status: built. Depends on `03-phase2-core-loop.md` (§5.15 match snapshot,
victory), `19-save-games.md`, `46-tutorials.md` and `48-campaigns.md` (§4).
Decisions: D-02 (deterministic fixed point), D-05 (balance is data).

## 1. Goal

When a skirmish, a multiplayer match or a campaign mission ends, the player
sees a score screen: what every player built, lost and destroyed, how much
money they earned and spent, and how long the match lasted. The next actions
sit under the table. The buttons that spec 48 §4 put in the objectives panel
(**Next mission**, **Epilogue**, **Retry**, **Main menu**) move to this screen.

## 2. Precedent (`generals-precedent`, Zero Hour)

Zero Hour's `ScoreKeeper` keeps integer counters per player, and
`ScoreScreen.cpp` shows, one row per player: Units Built, Units Lost, Units
Destroyed, Buildings Built, Buildings Lost, Buildings Destroyed and Resources
(money earned). Rows are sorted by a score (`ScoreKeeper::calculateScore`:
units built, buildings built and every kill count 100 each, plus money earned)
that is used only for the order. Counters are bumped where things happen:
`Player::onUnitCreated` (units built), `onStructureConstructionComplete`
(buildings built, money spent on structures), `Object::scoreTheKill` (lost
before the enemy check, destroyed only for enemies; objects under
construction are excluded), and money earned at every credit source (supply
drop-off, bounty, crates). Zero Hour does not show money spent or match time
on the screen and never adds unit production cost to money spent.

Copied: the seven columns, a row per player ordered by that score, the same
update points, foundations excluded. Changed on purpose (the issue asks for
them): **Money spent** and **Match time** are shown, and unit and upgrade
production cost counts as money spent (Zero Hour's omission is a bug to
avoid).

## 3. Counters (sim)

`PlayerStats` (`crates/sim/src/player.rs`), per player, plain `u32`, bumped in
the deterministic step. Saved in the save file (`PlayerState.stats`, omitted
while zero; spec 19) so a loaded match keeps counting, and not hashed (nothing
in the sim reads them).

| Counter | Bumped when |
| --- | --- |
| `units_built` | a queued unit spawns, or a finished building's free unit appears |
| `units_lost` | one of the player's units is removed with 0 hp |
| `units_destroyed` | a unit was removed and the last enemy hit credits this player (a launched drone credits its launcher) |
| `buildings_built` | a foundation reaches full progress |
| `buildings_lost` | one of the player's finished buildings is removed with 0 hp |
| `buildings_destroyed` | as `units_destroyed`, for a finished building |
| `money_earned` | a harvester unloads at a drop-off (the paid amount, so a Brutal AI's bonus counts) |
| `money_spent` | an order is queued (unit or upgrade cost), a building is placed, or a building or vehicle is repaired for money; a cancelled order or foundation refunds it back out |

Depots, neutral entities, foundations and upgrades are never lost or
destroyed. Friendly fire is a loss and no kill. Selling a building counts it
as lost (it dies with 0 hp); the sale refund is not money earned.

## 4. Interface

1. The match snapshot (§5.15) ends with the counters: after the upgrade list,
   `count, (player, units_built, units_lost, units_destroyed,
   buildings_built, buildings_lost, buildings_destroyed, money_earned,
   money_spent)*`. They are written once any player has a non-zero counter;
   the air and upgrade counts before them are then always written (zero when
   empty). The client decodes them as `MatchSnapshot.stats` (empty before).
2. `#score-screen` (a modal over the game, `client/src/ui/scoreScreen.ts`)
   opens when the sim names an outcome (victory, defeat or draw) or a mission
   script ends the mission. The heading is **Victory**, **Defeat** or
   **Draw** (**Mission failed.** when a mission is lost), under it
   **Match time m:ss** (tick count at 15 ticks per second), then a table with
   one row per player: name (*Player N: Faction*, a star after the winner,
   the viewer highlighted) and the eight counters, ordered by the Zero Hour
   score, ties by player number.
3. Buttons: in a campaign mission, **Next mission** (**Epilogue** after the
   tenth) after a win, **Retry** after a loss, and **Main menu**. In a
   tutorial the same, with its own next mission. In a skirmish **Restart
   match** and **Main menu**; in a networked match only **Main menu**. Every
   screen also has **View battlefield**, which closes it for the rest of the
   match.
4. The old centred outcome text is gone; the main menu's shell battle (spec
   45) never shows the screen. The tutorial panel keeps the objectives and
   the result line, but no buttons.

## 5. Acceptance criteria

* AC-57-01: a fresh match has every counter at zero.
* AC-57-02: a kill is a loss for the victim and a kill for the killer.
* AC-57-03: a produced unit counts as built and its cost as spent.
* AC-57-04: a cancelled order is not money spent.
* AC-57-05: a finished building counts as built, a foundation does not, and
  its cost is spent when it is placed.
* AC-57-06: the snapshot carries the counters once counting starts.
* AC-57-07: the client decodes the counters (and none when absent).
* AC-57-08: rows are ordered by the Zero Hour score and mark you and the
  winner.
* AC-57-09: the match time is formatted m:ss, or h:mm:ss from an hour.
* AC-57-10: in the browser `?load=victory-near` ends with the score screen
  and its actions (manual).

## 6. Assumptions

* Match time is the tick count at the end of the match, not wall-clock time.
* A save made before this spec loads with zero counters; the screen then
  counts from the load.
* Capturing and neutral-structure counters of Zero Hour have no equivalent
  yet and are left out.
* Money from sales, bounties and crates is not "earned" until those exist as
  income sources; only harvesting is.
* A team row (several players on one side, as in Zero Hour's single-player
  screen) is not built: one row per player.
