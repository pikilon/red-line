# 41 — Command bar

Status: built (§3.1, §3.4 for the command panel, §3.5 and cameos; §3.2/§3.3 follow in their own change) (owner request 2026-10-29). Replaces the plain text buttons of
`#command-panel` (spec 06 §6.6–6.7). Touches `08` (camera zoom, touch
controls), `31` (garrison), `33` (rally points), `34` (transport), `35` (dig),
`37` (sell). Client only: no sim, save or rules change.
Decisions: D-05 (balance in data), i18n for every player-facing string.

## 1. Goal

Every order a player can give with the keyboard or a modifier click has a
button, so the whole game is playable on a touch screen. The panels look like
a military console, show a picture of what they build, and fold away.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; `INIZH.big` 1.04.

* The command area is a 2 × 7 grid of 14 slots (`ControlBar.h:406`).
  `GenericCommandSet` puts Attack Move, Guard and Stop in the last row.
* Production buildings put their builds in slots 1–10, Set Rally Point at 13
  and Sell at 14. The queue shows 9 slots (`ControlBar.h:414`).
* Each button shows a cameo image (`ButtonImage`, `CommandButton.ini`); the
  first queue slot shows a reverse clock wipe of its progress
  (`ControlBarCommand.cpp:804`).
* The bar has a full and a low stage toggled by a button
  (`ControlBarCallback.cpp:436`); no full hide.
* Double-click on a unit selects every unit of that type on screen; Alt widens
  it to the map, and with none on screen the map is used
  (`SelectionXlat.cpp:477-525`, `InGameUI.cpp:4901-4915`).
* Ten control groups 0–9 are created, selected, added to and viewed
  (`MetaEvent.cpp:96-126`, `SelectionXlat.cpp:1066-1252`).

Red Line copies the grid-of-slots idea, the cameos, the clock wipe, the
two-stage fold and both group and same-type selection. Attack Move and Guard
need sim orders that do not exist yet: out of scope (assumption A1).

## 3. Layout

Three docked panels, each with a fold tab. Touch targets are ≥ 44 px.

| Panel | Where | Holds |
|---|---|---|
| Command (`#command-bar`) | bottom-left | selection strip, unit actions, structure actions, build grid, queue |
| Quick (`#quick-bar`) | left edge, above the command panel | 10 group slots, structure shortcuts |
| Zoom (`#zoom-bar`) | right edge, above the touch joystick | zoom in, slider, zoom out, reset |

### 3.1 Command panel

* **Selection strip:** one chip per selected type with its cameo and a count
  badge. Tapping a chip narrows the selection to that type.
* **Units section** (shown when the selection holds own vehicles or infantry):
  Stop; Force fire (arms the next map tap as a Ctrl+click force attack, the
  button stays lit until it fires or is tapped again); Same type on screen;
  Same type everywhere; plus the contextual Garrison, Dig and Unload buttons.
* **Structures section** (shown for one own building, a garrisoned building or
  an occupied transport): Rally point (arms the next map tap as the rally
  order, as a right-click does today); Sell (first tap turns it red and shows
  the refund, a second tap within 3 s sells); Evacuate; Unload.
* **Build grid:** construct/produce buttons as cameo tiles with the cost under
  the picture and a hotkey-free tooltip with the full name. Disabled tiles are
  grey; unaffordable ones show the cost in red. Right-click / long-press
  cancels as today.
* **Queue:** there is no separate queue row. Each produce tile shows its unit's
  name as text, a "− 3 +" stepper on the cameo with how many of that type are
  queued ("+" queues one more, "−" cancels the last queued unit and, with one
  left, the whole queue), and a clock-wipe of progress inside the cameo while the head of
  the queue is of that type. Right-click / long-press cancels as above.
* Section headers are thin labels ("UNITS", "STRUCTURE"); a section with no
  buttons is not drawn.

### 3.2 Quick panel

* **Groups 1–9 and 0:** each slot shows the number and the cameo of the
  group's most common type with a count, or is dim when empty. Tap selects the
  group; a second tap within 400 ms centres the camera on it. A Set button
  arms assignment: the next slot tapped stores the current selection. Keyboard:
  digit selects, double digit centres, Ctrl+digit sets, Shift+digit adds.
* **Structure shortcuts:** one cameo button per own production building type
  (HQ, barracks, factory, port…), with a count badge. Tap selects one of them
  (cycling through them on repeated taps) and centres the camera on it.

### 3.3 Zoom panel

`+` and `−` step the zoom by the wheel step; the slider spans the wheel limits
(spec 08 §3.4); the reset button returns to zoom 1. All three keep the wheel
clamps.

### 3.4 Folding

Each panel folds to its tab (a small bar with a chevron and the panel name);
the command panel's tab keeps a dot lit while a queue is running. Fold state is
stored in settings and survives reloads.

### 3.5 Look

Dark gunmetal plates (`#14181c`) with a 1 px steel rim, clipped corners, a
thin red accent line (`#c62828`) on the active section, amber (`#facc15`) for
armed or active buttons, condensed uppercase labels. Icons are inline SVG.
Cameos are rendered from the game's own 3D models at load (three-quarter view,
transparent background) and cached; a type with no model shows its initials.

## 4. Assumptions

* A1: Attack Move, Guard and Scatter are not offered until the sim has them.
* A2: "Same type everywhere" uses the whole map, matching Alt+double-click.
* A3: Mouse double-click on a unit keeps the Generals behaviour (screen first,
  map when none on screen).
* A4: Group slots live only for the match; they are not written to saves.

* A5: The command panel keeps the id `#command-panel` (not `#command-bar`) so existing hooks keep working; the Rally point and Sell buttons sit in the Structure section, Unload with them.

## 5. Acceptance

* AC-41-01: Selecting a unit shows the Units section with Stop, Force fire and
  both same-type buttons; selecting a building shows the Structure section.
* AC-41-02: Force fire then a tap on the ground orders an attack-ground, as
  Ctrl+click does.
* AC-41-03: Rally point then a tap sets the building's rally point.
* AC-41-04: Sell needs two taps; one tap and a wait does nothing.
* AC-41-05: Build tiles show a cameo image and the name of their type; queued units show as a count badge on their tile.
* AC-41-06: Set + slot 1 stores the selection; tapping slot 1 reselects it;
  digit 1 does the same.
* AC-41-07: Same type on screen selects only visible own units of that type;
  everywhere selects all of them.
* AC-41-08: Zoom + / − / slider / reset change the camera zoom within limits.
* AC-41-09: Each panel folds and unfolds, and the state survives a reload.
* AC-41-10: Taps on any panel never reach the map.
