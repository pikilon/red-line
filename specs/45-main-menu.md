# 45 — Main menu over a shell battle

## 1. Goal

Opening the game with no URL parameters shows a main menu over a live
AI-vs-AI battle, like the Zero Hour shell map.

## 2. Precedent (generals-precedent note)

* Zero Hour loads a normal map as a `GAME_SHELL` game with a fixed seed
  (`Shell.cpp:472-511`, `InitGameLogicRandom(0)`); the full sim runs and the
  control bar is hidden (`GameLogic.cpp:2219-2227`).
* The camera is scripted by the shell map; the fighting is AI/script teams.
* Top-level buttons: Single Player (Skirmish, campaigns), Multiplayer,
  Load/Replay (Load Game), Options, Credits, Exit (`MainMenu.wnd`).
* Picking a mode clears the shell game and starts a new one
  (`SkirmishGameOptionsMenu.cpp:418-459`); the shell reloads when the menu
  shows again.

## 3. Shell battle

* A bare URL (`/`) runs the default map with the default seed; player 1 gets
  the default AI and player 0 the same style for its own faction.
* The map is revealed (observer), the HUD, outcome and game menu are hidden
  and no key reaches the game.
* The camera sweeps slowly between both headquarters (120 s round trip).
* When the battle ends, a new one starts 5 s later.

## 4. Menu

* `#main-menu` shows the title and two buttons:
  * **Skirmish** opens `?mode=skirmish` (the shell match is discarded).
  * **Load game** opens the save manager in load mode (spec 19 §5.5).
* Any URL parameter (`?load`, `?map`, `?mode`...) skips the menu, so links and
  tests open the game directly.

## 5. Assumptions

* Multiplayer, campaigns, Options, Credits and Exit are left out: the game has
  none of those modes yet and a browser tab cannot exit.
* The camera sweep lives in code, not a map script, until maps carry camera
  tracks.
