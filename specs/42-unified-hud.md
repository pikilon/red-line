# 42 — Unified HUD

Status: all of §3 is built (§3.7 minimap, owner request 2026-10-30). Replaces the docked panels of spec 41 §3 and §3.4 and the top
resource panel of spec 03 §6.7; keeps their buttons, cameos and look (spec 41
§3.1, §3.2, §3.5). Touches `08` §3.6 (menu button). Client only: no sim, save
or rules change.

## 1. Goal

One console holds everything the player reads or presses, takes little of a
phone screen and never needs a second panel.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`.

* The command bar is one docked console with a full and a low stage
  (`ControlBarCallback.cpp:436`, already cited in spec 41 §2).
* Radar: 128 × 128 terrain texture rebuilt only on map change
  (`W3DRadar.cpp:1021`), one 2 × 2 dot per object in the owner's colour, nothing
  under shroud or fog (`W3DRadar.cpp:620`), black overlay for shroud and
  half-black for fog (`W3DRadar.cpp:1276`), the view as a clipped trapezoid
  (`W3DRadar.cpp:178`, `:284`), objects redrawn every 6 frames, about 5 Hz
  (`W3DRadar.cpp:64`).
* Radar input: left click moves the selection or, with none, the camera; right
  click moves the camera; no drag (`ControlBarCallback.cpp:227-320`).

Red Line departs from the radar input on purpose, see A3.

## 3. Behaviour

### 3.1 The bar

`#hud-bar` docks to the bottom edge. Its top row holds, in order: the menu
button on every device, the status (`Player 1: Ukraine`, credits, power), the
tabs, the name of the selection. Below runs the content row of the open tab.
Tapping the bar never reaches the map.

The bar wears the player's side (owner request 2026-10-30): the flag drawn
beside the country name, the flag's stripes along the top edge and its last
stripe as the accent of tabs and section marks. The flag is drawn from the
stripes the buildings fly (spec 16 §4), not an emoji: Windows browsers show
flag emoji as two letters. Switching sides repaints it.

### 3.2 Tabs

* **Orders:** selection chips, unit actions, structure actions.
* **Build:** structure actions and the build grid, so Sell and Rally point stay
  one tap from the tiles. Its tab shows a lit dot while a queue runs.
* **Groups:** the Set button, the ten group slots, the structure shortcuts.

A new selection opens Build when it can build or produce and Orders otherwise.
A selection made from a group slot or a digit leaves the Groups tab open. A tab
the player picks stays while the selection stands; Build closes to Orders when
nothing is left to build. With nothing picked, Orders says so.

### 3.3 Scrolling

A content row that does not fit scrolls: sideways by finger or by wheel, which
is turned sideways over the row. The zoom gestures are not taken: the wheel
zooms over the map and pinch zooms on the map.

### 3.4 Minimal and expanded

A button in the top row folds the bar to that row alone: menu, status, tools.
Pressing it again expands it. The choice survives a reload. Zero Hour's full
and low stages, spec 41 §2.

### 3.5 Bottom or left

A second button docks the bar to the left edge, as a full-height column with
its rows wrapped and scrolling up and down, or back to the bottom edge. The
choice survives a reload.

### 3.6 Sizes

Rows follow the screen height. On a phone in landscape (height ≤ 500 px) the
expanded bar stays at or under 110 px: top row 40 px, content row 68 px, tiles
54 × 58 px with their names at 10 px. Touch targets on that size are ≥ 40 px,
below the 44 px of spec 41 §3 on purpose: the owner asked for a smaller bar.

### 3.7 Minimap

`#hud-radar` is the first child of the bar: a square as high as the bar at the
bottom edge, a strip across the top of the column when docked left (150 px; 106
px on a phone). It folds away with the bar's minimal size. One canvas draws,
about five times a second and never per frame:

* The terrain, one pixel per cell scaled up and built once per map: land
  shaded by height, shallow and deep water, rock tiles. A map that is not square
  is fitted whole, centred, aspect kept.
* The fog over it: black where unexplored, half dark where explored, clear
  where visible.
* One small dot per unit or building in its owner's colour: always the
  player's own, the rest only on visible cells.
* The view: the ground the screen shows, an amber outline (a trapezoid under
  the isometric camera) clipped to the map.

Tapping, clicking or dragging on it moves the camera to that point and keeps
following the pointer while pressed (mouse or one finger; a second finger and
non-primary buttons are ignored). It never gives an order and none of its
events reach the map (A3).

## 4. Assumptions

* A1: Three tabs. Structure shortcuts live with the groups: both are "go to
  what I own".
* A2: A fold per panel is gone; §3.4 folds the whole bar.
* A3: The minimap only moves the camera (tap, click or drag, with or without a
  selection), because the owner asked for it to navigate and every order now
  goes through the left button on the map.

* A4: "Vertical" means the HUD's own orientation; portrait phones still show
  the rotate guard of spec 08 §3.8. Left is the only side edge offered.

## 5. Acceptance

* AC-42-01: The menu button, the status and the tabs are inside `#hud-bar` with
  mouse and touch.
* AC-42-02: Selecting a producer opens Build with its tiles, Rally point and
  Sell; selecting a unit opens Orders.
* AC-42-03: A group slot keeps Groups open.
* AC-42-05: The flag and the top edge use the stripes of the side played.
* AC-42-04: A row wider than the bar scrolls sideways and its last item can be
  reached.
* AC-42-06: The bar folds to its top row and expands, and both that and the
  dock survive a reload.
* AC-42-07: Docked left, the bar is a column and its content scrolls vertically.
* AC-42-08: At 844 × 390 the expanded bar is at most 110 px high and every
  button at least 40 px.
* AC-42-09: Tapping the minimap, then dragging across it, moves the camera each
  time; it is hidden while the bar is minimal.
