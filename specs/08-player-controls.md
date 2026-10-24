# 08 — Player controls

Status: §3 (pause) approved by the owner on 2026-10-11 for immediate
implementation; §3.3 (AI toggle) requested by the owner on 2026-10-12; §5
lists the owner's other requests, to be specified later.
Depends on `03-phase2-core-loop.md` §6.3 (worker loop) and §6.5 (input).

## 1. Context

After playing Phases 3–4 the owner listed missing controls. Pause is needed
now; the rest are queued (§5).

## 2. Scope

In: pausing and resuming a skirmish. Out: everything in §5.

## 3. Pause

* Keys: `P` and `Pause` toggle pause in skirmish mode (with or without
  `?debug=1`). Not available in the tech-slice mode.
* Protocol (`client/src/sim/protocol.ts`): new main→worker message
  `SetPausedMessage = { type: "setPaused"; paused: boolean }`, part of
  `MainToWorker`. `SkirmishClient` gains `setPaused(paused: boolean): void`.
* Worker (`workerHandler.ts`): while paused, `advance(nowMs)` updates `lastMs`,
  keeps `accumulatorMs` at 0, steps nothing and posts nothing. Resuming does
  not catch up the paused time. Commands received while paused are applied as
  today (enqueued in the simulation) and take effect on the first tick after
  resuming.
* Client: while paused, the render loop keeps running (camera pan, selection,
  command panel and orders work), interpolation stays on the last snapshot and
  combat effects (spec 07) freeze (their clock does not advance).
* Overlay: a centred, non-interactive (`pointer-events: none`) label with
  `pause.overlay` = `"Paused — press P to resume"` from `client/src/i18n/en.json`,
  rendered on change only (not every frame).
* Debug API: `__redline.paused(): boolean`.
* The simulation is unchanged: pause is a client/worker scheduling concern, so
  determinism and state hashes are unaffected.

## 3.1 Game menu on Esc (amends §3, owner request 2026-10-11)

The owner asked for `Esc` to open a menu that also pauses, as in Red Alert;
`P` is no longer needed.

* Keys: `Esc` toggles the game menu in skirmish mode. While a placement mode
  is active (`placementKind() !== null`) `Esc` keeps cancelling placement and
  does not open the menu. `P` and `Pause` no longer pause.
* Opening the menu pauses (§3 worker and client behaviour unchanged); closing
  it resumes. There is no pause without the menu.
* `client/src/ui/gameMenu.ts`:

  ```ts
  export interface GameMenuView {
    open: boolean;
    gore: boolean;
  }
  export interface GameMenuActions {
    resume(): void;      // closes the menu and resumes
    toggleGore(): void;  // same as the G key (spec 07 §5)
    restart(): void;     // reloads the page with the same query string
  }
  export interface GameMenu {
    readonly root: HTMLElement; // #game-menu
    /** Re-renders only when `view` differs from the last rendered view. */
    render(view: GameMenuView): void;
  }
  export function createGameMenu(parent: HTMLElement, actions: GameMenuActions): GameMenu;
  ```

  The root is a full-screen backdrop (`position: fixed; inset: 0; background:
  rgba(0, 0, 0, 0.55)`, `pointer-events: auto`, so map clicks do not reach
  the canvas while open) holding a centred panel with the title `menu.title`
  and three buttons in this order: `menu.resume`, `menu.gore` (label with the
  current state: `menu.goreOn` / `menu.goreOff`), `menu.restart`. Buttons are
  created once and only their text/visibility changes, so they stay clickable
  with a real mouse (AC-03-65 rule: no per-frame DOM rebuild). Hidden
  (`hidden` attribute) when `open` is false.
* i18n (`client/src/i18n/en.json`): `menu.title` "Paused", `menu.resume`
  "Resume", `menu.goreOn` "Gore: on", `menu.goreOff` "Gore: off",
  `menu.restart` "Restart match". The `pause.overlay` label and
  `#pause-overlay` are removed.
* Debug API: `paused()` unchanged; new `menuOpen(): boolean`.

## 3.2 Hot-seat camera (owner request 2026-10-12, issue #220)

Switching the controlled player with the debug-only `F2` key (spec 03
AC-03-60) left the camera where the previous player was looking, which made
finding one's own base very hard. Each player now keeps their own view.

* `client/src/app/cameraMemory.ts`:

  ```ts
  export interface ViewPoint {
    x: number;
    y: number;
  }
  export interface CameraMemory {
    /** Stores `current` as `from`'s last view and returns `to`'s last view,
     *  or null when `to` has none yet. */
    switchPlayer(from: number, to: number, current: ViewPoint): ViewPoint | null;
  }
  export function createCameraMemory(): CameraMemory;
  /** The player's main base: their HQ, else their first building in
   *  `entities` order, else null. */
  export function homeView(
    entities: readonly EntityState[],
    player: number,
    hqKind: number | null,
    isBuilding: (kind: number) => boolean,
  ): ViewPoint | null;
  ```

* On `F2` (`setControlledPlayer` in `client/src/app/skirmish.ts`) the camera
  target moves to the new player's last view when there is one. Otherwise it
  moves to `homeView` of the first snapshot whose `viewer` is the new player
  or `OBSERVER` (the snapshot still in flight was built for the old viewer and
  hides the new player's base under fog); if `homeView` is null there, the
  camera stays where it is.
* Camera panning between switches is part of the stored view; nothing is
  stored in the simulation, so determinism is unaffected.

## 3.3 AI toggle in the game menu (amends §3.1, owner request 2026-10-12)

The owner wants to switch the computer opponent off mid-match to test things
without being attacked, and back on later.

* Simulation (`crates/sim/src/ai.rs`), `Ai` gains an active flag (new AIs are
  active):

  ```rust
  /// Whether `step_with_ai` lets this AI think.
  pub fn is_active(&self) -> bool;
  /// Pauses or resumes the AI. Pausing an active AI returns one
  /// `Command::Stop` with the units committed to the current attack (ascending
  /// attack order, none when there are none); every other call returns nothing.
  pub fn set_active(&mut self, active: bool) -> Vec<Command>;
  ```

  `step_with_ai` skips `think` for inactive AIs; everything else is unchanged.
  Already queued production finishes; stopped units keep their normal idle
  behaviour (they still fire at enemies in range). Resuming keeps the AI's
  state, so idle attackers retarget on the next pass (§5.4 step 8 of spec 05).
* WASM API (`wasm_api.rs`, still version 3):

  ```rust
  /// Pauses or resumes the AI of `player`, enqueuing `set_active`'s commands as
  /// `player`. Returns false (and does nothing) when `player` has no AI.
  pub fn set_ai_active(&mut self, player: u8, active: bool) -> bool;
  ```

  The toggle is a runtime testing aid outside the command stream: a match where
  it is used is not reproducible from its commands alone.
* Protocol: new main→worker message `SetAiActiveMessage = { type:
  "setAiActive"; active: boolean }` in `MainToWorker`; `SkirmishClient` gains
  `setAiActive(active: boolean): void`. The worker calls
  `set_ai_active(1, active)` (the skirmish AI player) and ignores the message
  before a skirmish exists.
* Game menu: `GameMenuView` gains `ai: boolean | null` (`null` = no AI
  attached, `?ai=off`) and `GameMenuActions` gains `toggleAi(): void`. A fourth
  button `#game-menu-ai` sits between Gore and Restart, labelled `menu.aiOn`
  "AI: on" / `menu.aiOff` "AI: off", and is `hidden` when `ai` is `null`. The
  equal-view rule of §3.1 covers the new field.
* The skirmish starts with the AI on whenever one is attached; the setting is
  not persisted across reloads (Restart brings the AI back).
* Debug API: new `aiActive(): boolean | null`.

## 3.4 Mouse-wheel zoom (owner request 2026-10-12, issue #226)

The owner wants to zoom in to inspect units and buildings and out to see more
of the battle (§5.3). The camera stays orthographic and isometric (D-05): zoom
only scales the view.

* `client/src/camera.ts`:

  ```ts
  export const ZOOM_MIN = 0.6;   // zoomed out: 1 / 0.6 ≈ 1.67 × today's view
  export const ZOOM_MAX = 3;     // zoomed in
  /** Zoom factor of one wheel notch (`deltaY` = WHEEL_NOTCH pixels). */
  export const ZOOM_STEP = 1.15;
  export const WHEEL_NOTCH = 100;
  /** Lines (`deltaMode` 1, Firefox) to pixels. */
  export const WHEEL_LINE_PIXELS = 33;
  /** `zoom × ZOOM_STEP^(−pixels / WHEEL_NOTCH)` clamped to
   *  [ZOOM_MIN, ZOOM_MAX], where `pixels` is `deltaY` in pixels: wheel up
   *  (negative `deltaY`) zooms in. Trackpads send fractional notches. */
  export function zoomAfterWheel(zoom: number, deltaY: number, deltaMode: number): number;
  ```

* The skirmish controller listens to `wheel` on the canvas (non-passive,
  `preventDefault` so the page never scrolls), sets `camera.zoom` to
  `zoomAfterWheel(camera.zoom, deltaY, deltaMode)` and updates the projection
  matrix. The camera target (screen centre) does not move. Zoom starts at 1
  (today's view), is shared by both hot-seat players and is not persisted.
  `SkirmishController` gains `zoom(): number`.
* Picking, box selection, placement and `worldToScreen` use the camera
  projection and keep working at any zoom; health bars are world-space and
  scale with the models. Window resize keeps the zoom.
* Shadows (amends spec 10 §3): the sun's shadow camera half-size becomes
  `SHADOW_EXTENT / min(zoom, 1)`, so zooming out keeps the whole view shadowed;
  at zoom ≥ 1 it is today's 24 tiles.
* Debug API: new `zoom(): number`.
* Not in the tech-slice mode.

## 3.5 Switch side, reveal map and FPS panel in the menu (amends §3.1, owner request 2026-10-13, issue #245)

The owner asked to put the debug options and the side switch in the Esc menu.
They were keyboard-only (`F2`, `F3`) and needed `?debug=1`.

* `GameMenuView` gains the optional `revealed?: boolean` (map revealed) and
  `fpsPanel?: boolean` (performance panel shown); absent counts as `false`.
  `GameMenuActions` gains the optional `switchSide?(): void`,
  `toggleReveal?(): void` and `toggleFpsPanel?(): void`; a button exists only
  when its action is provided, so the earlier menu tests keep passing. The
  equal-view rule of §3.1 covers the new fields.
* Buttons `#game-menu-switch`, `#game-menu-reveal` and `#game-menu-fps` sit
  after the Textures button and before Restart: Resume, Gore, AI, Textures,
  Switch side, Reveal map, FPS panel, Restart. Labels: `menu.switchSide`
  "Switch side", `menu.revealOn` "Reveal map: on" / `menu.revealOff` "Reveal
  map: off", `menu.fpsOn` "FPS panel: on" / `menu.fpsOff` "FPS panel: off".
  They are created once (AC-03-65).
* Switch side does what `F2` does (spec 03 AC-03-60, §3.2): the selection is
  cleared, the controlled player becomes the other one, the camera goes to that
  player's last view or base and `#hud-player` reads `Player N: <faction>`.
  Reveal map does what `F3` does. Both work in every skirmish, without
  `?debug=1`.
* FPS panel shows or hides `#perf-panel` (`PerfPanel.setVisible(visible)`,
  `hidden` attribute). It is created in every skirmish; hidden by default,
  shown with `?debug=1`.
* `F2`, `F3` and `window.__redline` stay debug-only.

## 3.6 Touch controls (owner request 2026-10-13, issues #251 and #253)

On touch screens panning needed the arrow keys / WASD and the menu needed
`Esc`. Touch devices get a virtual joystick and a menu button. Issue #253
replaced the four-button D-pad of #251 with the joystick (AC-08-15 and
AC-08-16 are superseded by AC-08-18 and AC-08-19).

* Shown only on touch devices: `isTouchDevice()` is true when
  `matchMedia("(pointer: coarse)").matches` or `navigator.maxTouchPoints > 0`.
  Otherwise the controls are not created (no DOM, nothing on desktop).
* `client/src/ui/touchControls.ts` exports `TouchControlsActions { pan(x:
  number, y: number): void; toggleMenu(): void }`, `TouchControls { root:
  HTMLElement; render(view: { menuOpen: boolean }): void }` and
  `createTouchControls(parent: HTMLElement, actions: TouchControlsActions)`.
  `pan(x, y)` receives the current joystick vector in screen axes, each in
  [-1, 1], `x` to the right and `y` down, and `(0, 0)` on release.
* DOM, created once (AC-03-65): `#touch-controls` holds `#touch-joystick`
  (the base, 120 x 120 CSS px circle, bottom right) with `#touch-joystick-knob`
  (about 40 px circle at its centre) inside, and `#touch-menu` (top right,
  label "☰", at least 48 x 48 CSS px). The joystick has an `aria-label` from
  i18n (`touch.joystick`), `#touch-menu` has `touch.menu`; both have
  `touch-action: none` and no text selection.
* Dragging: `pointerdown` on the base or the knob captures the pointer
  (`setPointerCapture`), adds the class `pressed` to the knob (CSS grows it
  about 1.25x with a short transition) and starts reporting. The base circle
  has centre `c` and radius `R` (half its `getBoundingClientRect` width). On
  `pointerdown` and `pointermove` of the captured pointer the knob offset is
  `d = pointer - c` clamped to length `R` (the knob follows the finger inside
  the base), and `pan(d.x / R, d.y / R)` is called when the vector is outside
  the dead zone (length at least 0.15), otherwise `pan(0, 0)`; a call is made
  only when the reported vector changes. `pointerup`, `pointercancel` and a
  window `blur` release: the knob returns to the centre, loses `pressed`, and
  `pan(0, 0)` is called once if a vector was reported (never without a press).
  Moves of other pointers are ignored.
* Direction convention: pushing the knob up is what the Up arrow does (same
  axes and speed as `panDelta`). The controller exposes
  `setAnalogPan(x: number, y: number)` (screen vector in [-1, 1]); in `update`
  its world contribution `((x + y) / sqrt 2, (y - x) / sqrt 2) * speed * dt`
  is added to the keys' `panDelta`, so a full-radius push pans at the
  keyboard's speed, a half-radius push at half of it, and the keyboard keeps
  working unchanged. The skirmish wires `pan(x, y)` to `setAnalogPan`.
* `#touch-menu` `click` calls `toggleMenu()`; the skirmish does what `Esc`
  does: with a placement mode active it cancels placement and leaves the menu
  closed, otherwise it opens (pause) or closes (resume) the game menu.
* `pointerdown`, `pointerup` and `click` on the controls stop propagation and
  `contextmenu` is prevented, so a touch never starts a selection box or an
  order on the map; the controls are DOM siblings of the canvas, never inside
  the HUD, the command panel or the game menu. On touch the command panel
  stays at the bottom left (the joystick is at the bottom right); neither
  covers the HUD, the FPS panel or the menu button, on 375 x 812 and 812 x 375.
* `render({ menuOpen })` sets `hidden` on `#touch-joystick` while the menu is
  open (releasing a held drag) and leaves `#touch-menu` visible above the menu
  so it can close it; an equal view writes nothing.

## 3.7 Attack orders (owner request 2026-10-15, issue #296)

A HIMARS right-clicked onto an enemy building drove up to it although it was
already in range: `resolveRightClick` only attacked enemy units and sent a
plain `move` for anything else. Unarmed units in the selection also walked
onto the clicked enemy. Generals precedent (issue #296, EA source
`CnC_Generals_Zero_Hour@0a05454d`): a right-click on an enemy unit or
structure issues the same attack (`CommandXlat.cpp:1986`,
`ActionManager.cpp:723`). An attacker already in range fires in place
(`AIStates.cpp:315`). Out of range it stops at the first in-range cell of its
route (`AIPathfind.cpp:10606-10740`). Units without a weapon issue no order
(`CommandXlat.cpp:2262-2331`).

* `resolveRightClick`: when the entity under the cursor (not a ghost) is a
  `unit` or `building` owned by neither `player` nor `NEUTRAL`, under
  construction or not, the result is `[attack { units: armed, target }]` where
  `armed` are the selected own units with a weapon (ascending), or `[]` when
  there are none. Unarmed units receive no command and keep their current
  order. This deviates on purpose from the original, which clears their task.
  It supersedes the `move { units [7, 21] }` of AC-03-49's first case.
* Simulation (unchanged, now covered by AC-08-21): a unit with an `Attack`
  order does not move while the target is within its weapon range
  (`entity_distance`, the footprint edge for buildings). Out of range it steps
  toward the attack goal only until the target is in range.

## 4. Acceptance criteria

**AC-08-01 Worker pause.** Given a skirmish worker handler at speed 1, after
`setPaused(true)` repeated `advance` calls over 2000 ms step nothing and post
no snapshot; after `setPaused(false)` the next `advance` 200 ms later steps 3
ticks (not the paused time); a command sent while paused is in effect after the
first tick following resume.

**AC-08-02 Client pause message.** `SkirmishClient.setPaused(true)` posts
`{ type: "setPaused", paused: true }` to the worker.

**AC-08-03 Game menu in the skirmish (Playwright).** In `?debug=1&seed=1`,
pressing `Esc` shows `#game-menu`, `__redline.paused()` is true and
`__redline.tick()` does not change over 1 s; a real mouse click on "Resume"
hides it and the tick advances; `Esc` twice opens and closes it; the gore
button toggles `__redline.gore()` and its label; `P` does nothing; with a
placement mode active `Esc` cancels placement and leaves the menu closed.

**AC-08-04 Game menu view.** `createGameMenu` renders four buttons in the
§3.1/§3.3 order (Resume, Gore, AI, Restart); `render` with an equal view does
not touch the DOM (same button elements, no text writes); clicking each button
calls its action once; the gore label follows `view.gore`; the AI label follows
`view.ai` and `ai: null` hides the AI button; `open: false` sets `hidden`.

**AC-08-05 Camera memory.** `createCameraMemory().switchPlayer(0, 1, {x: 10,
y: 20})` returns null; a following `switchPlayer(1, 0, {x: 70, y: 80})`
returns `{x: 10, y: 20}` and then `switchPlayer(0, 1, {x: 5, y: 5})` returns
`{x: 70, y: 80}`. `homeView` returns the player's HQ position when present,
the first own building when the HQ is gone, and null when the player owns no
building; other players' entities are ignored.

**AC-08-06 Hot-seat camera (Playwright).** In `?debug=1&seed=1` with the camera
moved to `(10, 10)` via `setCameraTarget`, pressing `F2` moves
`cameraTarget()` within 0.5 cells of the owner-1 `ru-hq` (read after `F3`
reveal); after `setCameraTarget(100, 20)`, `F2` returns the camera to
`(10, 10)` and a further `F2` to `(100, 20)`.

**AC-08-07 AI pause in the simulation.** (a) Given an AI that has launched an
attack, `set_active(false)` returns exactly `[Stop { units: <the launched
units> }]`, `is_active()` is false, a second `set_active(false)` and
`set_active(true)` return nothing. (b) Given `Sim::skirmish(1, "first-line")`
with `russia-balanced` attached to player 1 and `set_ai_active(1, false)`, and
the same skirmish with no AI, both state hashes are equal after 900 steps;
`set_ai_active(0, false)` returns false; after `set_ai_active(1, true)` the
hashes diverge within 900 more steps.

**AC-08-08 Worker and client AI toggle.** `SkirmishClient.setAiActive(false)`
posts `{ type: "setAiActive", active: false }`; the worker handler calls
`set_ai_active(1, false)` on its skirmish.

**AC-08-09 AI toggle in the skirmish (Playwright).** In `?debug=1&seed=1`,
`__redline.aiActive()` is true; after `Esc`, a real mouse click on "AI: on"
changes the label to "AI: off" and `aiActive()` to false, and a second click
restores both. With `?debug=1&seed=1&ai=off`, `aiActive()` is null and the AI
button is hidden in the open menu.

**AC-08-10 Wheel zoom.** `zoomAfterWheel(1, -100, 0)` is 1.15 and
`zoomAfterWheel(1, 100, 0)` is 1 / 1.15; `zoomAfterWheel(1, -3, 1)` equals
`zoomAfterWheel(1, -99, 0)`; `zoomAfterWheel(1, 0, 0)` is 1; 30 notches in
from 1 end at `ZOOM_MAX` and 30 notches out at `ZOOM_MIN`.

**AC-08-11 Zoom in the skirmish (Playwright).** In `?debug=1&seed=1&ai=off`,
`__redline.zoom()` is 1; three real mouse-wheel notches up over the canvas
make it 1.15³ (±0.01), keep `cameraTarget()` unchanged, leave
`window.scrollY` at 0 and multiply the screen distance between two ground
points 4 tiles apart by the same factor (±5 %); a real click on the
own dozer at its new screen position selects it; 30 notches down clamp
`zoom()` to `ZOOM_MIN`; no console error.

**AC-08-12 Debug buttons in the menu view.** With all three actions provided,
`createGameMenu` renders the buttons in the §3.5 order (Resume, Gore, AI,
Textures, Switch side, Reveal map, FPS panel, Restart) with the labels "Switch
side", "Reveal map: off", "FPS panel: off"; `revealed: true` and `fpsPanel:
true` give "Reveal map: on" and "FPS panel: on"; an equal view writes nothing;
each button calls its action once; without the three actions the buttons do
not exist.

**AC-08-13 Switch side in the skirmish (Playwright).** (a) In `?seed=1&ai=off`
(no debug, `window.__redline` is undefined), `Esc` and a real click on "Switch
side" make `#hud-player` read "Player 2: Russia"; a second click returns it to
"Player 1: Ukraine"; no console error. (b) In `?debug=1&seed=1&ai=off` with
`Ctrl+A` selecting own units, the same click empties `selectedIds()`, sets
`controlledPlayer()` to 1, moves `cameraTarget()` by more than 10 cells, and
after "Resume" the tick advances.

**AC-08-14 Reveal and FPS panel in the skirmish (Playwright).** In
`?seed=1&ai=off`, `#perf-panel` is hidden; real clicks on "FPS panel: off"
show it and relabel the button "FPS panel: on", a second click hides it; the
Reveal button toggles "Reveal map: off" and "Reveal map: on"; no console
error. With `?debug=1&seed=1&ai=off` `#perf-panel` starts visible and the
button reads "FPS panel: on".

**AC-08-15, AC-08-16** were the D-pad criteria of #251; they are superseded by
AC-08-18 and AC-08-19 (issue #253).

**AC-08-18 Touch joystick view.** `createTouchControls` creates `#touch-joystick`
with `#touch-joystick-knob` and `#touch-menu` once, with the i18n aria-labels
("Joystick", "Menu"). `pointerdown` on the knob captures the pointer and adds
the class `pressed` to the knob; `pointermove` clamps the knob to radius `R`
and reports `pan(x, y)` proportionally (half radius right = `pan(0.5, 0)`,
beyond the radius = length 1); inside the 0.15 dead zone it reports `(0, 0)`;
`pointerup` and `pointercancel` reset the knob and the class and report
`(0, 0)` once, a release without a press calls nothing, moves of another
pointer are ignored; a click on `#touch-menu` calls `toggleMenu()` once; the
control events call `stopPropagation`; `render({ menuOpen: true })` hides
`#touch-joystick` and releases a drag, keeps `#touch-menu` visible, and an equal
view writes nothing.

**AC-08-19 Touch joystick in the skirmish (Playwright).** With touch emulation
(`hasTouch`, 390 x 844) in `?debug=1&seed=1&ai=off`, `#touch-joystick` is in
the bottom right quadrant and `#command-panel` (with a unit selected) in the
bottom left, neither overlaps `#hud` or `#touch-menu`; pointer events on the
knob (down, then move up by half and by the full radius) move `cameraTarget()`
in the ArrowUp direction (-x, -y), the full push about twice as fast as the
half push, the knob has the class `pressed`; after `pointerup` the camera stays
put and the knob is back at the centre; a tap on `#touch-menu` opens
`#game-menu` with `paused()` true, hides `#touch-joystick` and a second tap
closes it; no console error.

**AC-08-17 No touch controls without touch (Playwright).** In a default desktop
context `#touch-controls` is not in the DOM and `ArrowRight` still pans.

**AC-08-20 Attack intents.** With the AC-03-49 entities plus an enemy
`ru-barracks` 50 centred at `(25.5, 25.5)` and an incomplete enemy
`ru-power-plant` 51 centred at `(31, 31)`, all for player 0: right click on 30
with `[7, 20, 21]` selected → `[attack { units [20], target 30 }]`; on 50 →
`[attack { units [20], target 50 }]`; on 51 with `[20]` →
`[attack { units [20], target 51 }]`; on 30 or 50 with only `[7, 21]` → `[]`.

**AC-08-21 Attackers hold position in range.** In the combat sandbox, a
mortar unit (range 10) ordered to attack an enemy power plant 8.5 tiles away
or an enemy truck 8 tiles away has the same position after 30 ticks, and the
plant has lost hit points. A mortar ordered to attack a spotted truck 28 tiles
away stops more than 9.8 tiles from it once within 10 tiles, and stays there
30 more ticks.

## 5. Queued requests (to be specified)

1. Camera bookmarks: save with `Ctrl+F1..F4`, jump with `F1..F4`.
2. Clear selection indicator: ring under selected units and a selection panel
   showing the selected unit's name, portrait/icon and health.
3. Camera rotation in 90° steps.
4. Rally points for production buildings in the UI (the sim already supports
   `Rally`) and unit waypoints.
5. Unit stances: guard/defend, scout/explore, scatter, hold position.
6. Rotating buildings before placing them (footprint rotation in the sim).
