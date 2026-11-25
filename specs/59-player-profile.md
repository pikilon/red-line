# 59 — Local player profile

Status: built. Depends on `48-campaigns.md` (§4 progress), `51-multiplayer.md`
and `57-score-screen.md`. Issue #484. Decisions: D-02 (the sim is untouched;
the profile is client state).

## 1. Goal

There are no accounts. The player has a profile kept in the browser: a name, a
colour, match statistics and the campaign progress. It can be exported to a
JSON file and imported in another browser. The name is what the opponent sees
in multiplayer and what the score screen shows for the local player.

## 2. Precedent (`generals-precedent`, Zero Hour)

Zero Hour keeps the local name in a preferences file, not in the simulation:
the LAN name is the `UserName` key of `Network.ini` (`LANPreferences`,
`LanLobbyMenu.cpp`), falling back to the operating-system login name;
`Options.ini` holds only settings (`OptionsMenu.cpp`). All of these files live
under the user data dir (`UserPreferences.cpp`). Per-faction games, wins and
losses (`PSPlayerStats`, maps keyed by player template) live server-side and
are cached locally (`GSMiscPref%d.ini`). Campaign progress is only inside the
`.sav` files (`CHUNK_Campaign`); there is no separate completion file.

Copied: name, colour and per-faction wins and losses are local preferences,
outside the sim; the name falls back to a default. Not copied: Zero Hour's
server-side stats (there is no server here, so the browser is the store).

## 3. Contents

* Name: up to 20 characters, whitespace collapsed, default `Commander`.
* Colour: `#rrggbb`, default blue.
* Statistics per faction id: played, won, lost. A draw adds to played only.
* Campaign progress: stays under `redline.campaign` (spec 48 §4); it is only
  read and written by the export and import.

Storage: `redline.profile.v1` in `localStorage` (name, colour, statistics).

## 4. Interface

* Main menu **Profile** page: name field, colour picker, totals and a line per
  faction, **Export profile**, **Import profile**, **Back**. Name and colour
  save as they change.
* Export downloads `red-line-profile.json`
  (`{ format: "redline-profile", version: 1, profile, campaign }`). Import
  replaces the stored profile and campaign progress; a file of another format
  changes nothing and shows an error.
* A skirmish or multiplayer match enters the statistics when its score screen
  first appears, under the faction the local player commanded.
* Multiplayer: both browsers send their name (the host in `start`, the guest in
  `hello`); the score screen shows the opponent's. The local player's row shows
  the own profile name.

## 5. Acceptance criteria

* AC-59-01: a fresh browser has the default name and no statistics.
* AC-59-02: the name and colour are saved, cleaned and survive a reload.
* AC-59-03: a finished match adds to the statistics of the player's faction.
* AC-59-04: exporting and importing restores profile and campaign progress.
* AC-59-05: a file that is not a profile export changes nothing.
* AC-59-06: corrupt stored data falls back to the defaults.

## 6. Assumptions

* Campaign missions and tutorials are not counted in the statistics; their
  progress is the campaign record. Only skirmish and multiplayer matches count.
* The colour is stored, exported and shown in the profile; in-match owner
  colours stay fixed per side, so two players never share one.
* The name is read when a match starts; renaming mid-match applies to the next.
* Import overwrites the profile and campaign progress (no merge).
* A peer's name is trusted only as text: it is cleaned and length-limited.
* Names are not unique and are not verified; there is no authentication.
