# 62 — Mission scripts

## 1. Goal

Campaign missions (spec 48 §3) are an ordered list of goals over a save. Zero
Hour missions also run scripts: reinforcements that arrive on a timer,
ambushes sprung by a trigger area, messages, objectives that appear mid-
mission. This spec adds a small subset of that model, as data (issue #481).

## 2. Precedent (generals-precedent note)

* The script engine runs every logic frame (30 fps): timers tick, scripts are
  evaluated, then sequential scripts advance (`ScriptEngine.cpp:5503`
  `ScriptEngine::update`).
* A script is OR-clauses of AND-ed conditions plus `actions` (when true) and
  `falseActions` (`ScriptEngine.cpp:7582, 7633`; `Scripts.h:604-640`).
* A script is evaluated only when active and `frame >= frameToEvaluate`;
  `delaySeconds` re-arms the next check at `frame + delay*30`
  (`ScriptEngine.cpp:6950, 6969-6975`).
* `isOneShot` deactivates the script after its actions fire (default true,
  `Scripts.cpp:913`; `ScriptEngine.cpp:7007, 7030`).
* Trigger areas are named polygons; "entered area" conditions read per-frame
  flags (`ScriptConditions.cpp:1638-1699`, reset at `ScriptEngine.cpp:5597`).
* `CREATE_REINFORCEMENT_TEAM` creates a team at a start waypoint and moves it
  to a target (`ScriptActions.cpp:504` `doCreateReinforcements`).
* There is no objective action: objective text comes from DISPLAY_TEXT and
  counters. Scripted VICTORY/DEFEAT show a window and end the game 120
  frames later (`ScriptActions.cpp:193-271`; `ScriptEngine.cpp:133`).
* Not copied: sequential scripts, subroutines, named counters and flags,
  OR clauses, `falseActions`, difficulty filters, team scripting. Zero Hour's
  one-shot quirk (a one-shot also deactivates after running false actions) is
  not copied: a script has no false actions.

## 3. Model

`data/campaign/mission-scripts.yaml` maps a mission save id to a list of
scripts. `node --run build:data` validates it (types exist, labels exist in
the mission's save, area and counts are sane) and writes
`data/generated/mission-scripts.json`; `check:data` fails when it is stale.

A script has an `id` (unique in the mission), `when` (a list of conditions,
all must hold), `do` (a list of actions, run in order) and optionally
`repeat: true` with `every: <seconds>` (default 1). **A script fires once
unless it repeats**; a repeating script fires on every check while its
conditions hold.

Conditions (one key each):

| Condition | Holds when |
| --- | --- |
| `after: <s>` | the mission has run that many seconds (ticks / 15) |
| `enters: { side, area: [x0, y0, x1, y1] }` | a unit (not a building) of `own` or `enemy` stands in the cell rectangle, bounds inclusive |
| `destroyed: <label>` | the save entity with that label is dead |
| `goal: <n>` | at least n of the mission's goals (spec 48 §3) are done |

Actions (one key each):

| Action | Effect |
| --- | --- |
| `message: <key>` | shows a line on screen |
| `dialogue: <key>` | shows a line with a speaker (`<key>.speaker`, `<key>.text`) |
| `reinforce: { side, type, count, at: [x, y] }` | `count` units (1-12) of `type` appear for that side at the cells around `at` |
| `objective: { text, destroy?: [labels] }` | appends an objective line; with `destroy` it is ticked when those entities are dead |
| `victory: true` / `defeat: true` | ends the mission won or lost (spec 48 §4) |

`side` is `own` (the player the mission controls) or `enemy` (the other one).
Text keys are suffixes of `campaign.<ua|ru>.<nn>.script.` in
`client/src/i18n/en.json`.

## 4. Where scripts run (decision)

* **Evaluation is on the client**, like mission goals (spec 46/48): the
  panel feeds each snapshot to a runner (`client/src/ui/missionScript.ts`)
  whose output depends only on the snapshot, the ordered script list and the
  goals done. It holds no clock of its own and reads no randomness, so one
  command log gives one result.
* **Anything that changes the match goes through the sim as a command.** A
  reinforcement is `Command::Reinforce { kind, pos }` (`world.rs`), issued
  as the receiving player; it is stored in saves with the rest of the command
  queue, is applied in the command phase of the next tick, and costs nothing.
  The sim puts each unit in the passable cell nearest `pos` within 4 cells
  (ties by row then column); a building type, an unknown type, a full
  map or no free cell is ignored. The client spreads a team over a 3-wide
  block of cells so units do not stack.
* **Messages, dialogue and objective lines are client-only** (they do not
  change the sim). `victory` and `defeat` end the mission in the client, as
  the `survive` goal does; the sim's own victory rule (spec 03) is unchanged
  and still ends a mission when a side loses every building.
* Objectives added by scripts are optional: they never gate victory.

## 5. Interface

* `#mission-messages` (top centre) shows the last three lines for 9 seconds
  each; a dialogue line is prefixed with its speaker.
* An added objective is appended to the `#tutorial` list, flashes the header
  when it is collapsed (spec 48 §4) and turns green when done.

## 6. Missions using scripts

* **Ukraine 1** — dialogue at 3 s; at 1:00 an objective to kill the VDV dozer
  (`lz-dozer`); at 2:00 a message and 4 riflemen; when the first goal (hold
  the airfield) is done a dialogue and 2 Stugna teams.
* **Russia 1** — dialogue at 3 s; an ambush (message and 3 Ukrainian
  riflemen for the enemy) when a Russian unit enters the airport defences;
  at 1:30 a second lift of 4 riflemen; an objective to destroy the Ukrainian
  headquarters once `tower1` is down.

Other missions have no scripts yet; they get them as they are tuned.

## 7. Acceptance criteria

* **AC-62-01** (`missionScript.test.ts`) A timed script fires once, on the
  tick its `after` passes, and never again.
* **AC-62-02** `enters` holds only for a unit of that side inside the area,
  bounds included.
* **AC-62-03** `destroyed` and `goal` conditions read the mission; every
  condition of a script must hold; a pending script's `destroyed` entities
  are reported for polling.
* **AC-62-04** A `repeat` script fires again every `every` seconds while its
  conditions hold.
* **AC-62-05** All actions of a script are handed over in list order.
* **AC-62-06** Mission 1 of each campaign has scripts that reinforce, add an
  objective and show text, over labels that exist in its save.
* **AC-62-01 (sim)** (`wasm_api.rs`, `ac_62_01`) `Reinforce` spawns a unit of
  a unit type for the issuing player without debug mode and ignores a
  building type.
* **AC-62-02 (sim)** (`ac_62_02`) The same reinforcement at the same tick
  gives the same state hash.
* **AC-62-07** (`workerHandler.test.ts`) The `reinforce` command reaches the
  sim's `command_reinforce`.
* **AC-62-08** `check:data` rejects scripts naming unknown labels or types
  and a stale `mission-scripts.json` (`scripts/mission-scripts.mjs`).

## 8. Assumptions

* A mission's `after` clock is the sim tick, so a mission loaded from a save
  that is already running fires the elapsed `after` scripts at once.
* `enters` and `destroyed` are level conditions (true while the state holds),
  not Zero Hour's one-frame flags; a one-shot script makes the difference
  invisible, and a repeating one fires each check while inside.
* Scripts evaluate at the snapshot rate, so a script may fire a few ticks
  after its condition becomes true.
* `defeat`/`victory` end a mission without the 4-second window Zero Hour
  shows; the score screen (spec 57) takes over at once.
* No difficulty filter: a mission has one difficulty (spec 48 §5).
* Scripts are campaign-only; tutorials and skirmish have none.
