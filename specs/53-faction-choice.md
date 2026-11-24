# 53 — Choosing both armies in a skirmish

Status: built. Depends on `03-phase2-core-loop.md` (§5.6 skirmish setup),
`05-computer-ai.md` (personalities, difficulty), `19-save-games.md` and
`45-main-menu.md`. Decisions: D-02 (deterministic fixed point), D-05
(balance and factions are data).

## 1. Goal

In a skirmish the player picks their own army and the enemy army from every
faction of the ruleset, mirror matches included. The map's start positions do
not change: each start simply takes the chosen faction, so its HQ and dozer
come from that faction (`hq` / `dozer` in `data/factions/<id>.yaml`). Today
that is Ukraine and Russia; a new faction appears in the pickers as soon as it
is added as data.

## 2. Precedent

Zero Hour's skirmish setup lets every slot choose any side independently of
the map's start spot. This spec copies that shape (a per-slot side, a fixed
start spot). The `generals-precedent` subagent was not consulted for this
change; the statement is from the designers' knowledge of the original UI.

## 3. Behaviour

1. The main menu skirmish page shows two drop-downs above the difficulty
   buttons: **Your army** (`#main-menu-army-player`, every faction) and
   **Enemy army** (`#main-menu-army-enemy`, every faction an AI personality
   exists for). Their defaults are the map's own (Ukraine, Russia).
2. Starting a skirmish sends both picks as `?army=<id>&enemy=<id>`, and saves
   them in the settings, so a later bare `?mode=skirmish` and a reload keep
   them, as the played side already does. The URL outranks the saved pick;
   unknown ids are ignored (the map's own factions are used).
3. The sim builds start `i` with faction `armies[i]` (`World::skirmish_armies`,
   `Setup.armies`, wasm `Sim.skirmish_armies`). An empty list is the map's
   own factions, so every existing save, replay and script is unchanged. A
   list of the wrong length or an unknown faction id is an error
   ("invalid setup: armies: ...").
4. The player's army goes to the start they control (start 0, or start 1 when
   the saved side is 1); the enemy army goes to the other start. The enemy AI
   is the `<faction>-<style>` personality of its faction (`balanced` by
   default), at the chosen difficulty. Switching side in a match (game menu or
   F2) keeps the factions with their bases and swaps the saved pick.
5. Saves already store each player's faction, so a loaded match keeps the
   armies it was played with; the client reads a player's faction from the
   entities it owns.
6. HQ lookup, camera home, flags, EVA, voices and music follow the player's
   faction. The client carries no per-faction branching beyond data tables:
   a faction with no flag, texture set, livery or audio of its own gets a
   neutral flag (white over grey), the default texture set, no livery decal
   and the first faction's audio. Nothing throws.
7. The AI's attack-target lookup (`enemy_start_center`) uses the map the world
   was built from, so mirror matches and swapped armies still send the AI to
   the right base.

## 4. Acceptance criteria

* AC-53-01 (`crates/sim/tests/armies.rs`): `skirmish_armies` with
  `["russia","ukraine"]` gives start 0 the Russian HQ and faction.
* AC-53-02: a mirror match (`["ukraine","ukraine"]`) builds; an empty list is
  hash-identical to `World::skirmish`.
* AC-53-03: a list of the wrong length, or with an unknown faction, errors.
* AC-53-04: `Setup.armies` is honoured by `from_setup`, and an AI personality
  of another faction than its player is refused.
* AC-53-05 (`client/src/app/armies.test.ts`): URL pick over saved pick;
  unknown ids ignored; the player's army goes to the controlled start;
  enemies are the factions with a personality.
* AC-53-06: the neutral flag and `teamColors` fallbacks never return null for
  a faction id (`flags.test.ts`, `resourceBar.test.ts`).

## 5. Assumptions

* The armies are chosen per match on the skirmish page; the map list and map
  choice are unchanged (still the default map).
* The enemy picker only offers factions that have an AI personality, because
  an AI can only play its own faction (`Ai::new`). A new faction becomes
  selectable as an enemy when its first personality is added.
* Multiplayer (spec 51) keeps the map's own factions; its lobby has no army
  picker yet.
* The tutorial, campaign and shell battle keep their fixed armies.
* A faction without art of its own renders with the Ukrainian texture set
  until its art exists; no art for new factions is added here.
