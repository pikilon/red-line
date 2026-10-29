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
  projection and keep working at any zoom; health bars are world-space
  billboards that face the camera, scale with the models and stay horizontal
  on screen (owner request 2026-10-29). Window resize keeps the zoom.
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
  player's last view or base and `#res-player` reads `Player N: <faction>`.
  Reveal map does what `F3` does. Both work in every skirmish, without
  `?debug=1`.
* FPS panel shows or hides `#perf-panel` (`PerfPanel.setVisible(visible)`,
  `hidden` attribute). It is created in every skirmish; hidden by default,
  shown with `?debug=1`. The panel holds the frame readout and `#perf-tick`
  (the simulation tick, moved here from the old top-left HUD by owner request
  2026-10-29), so this one switch hides both.
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
  covers the HUD, the FPS panel or the menu button on 844 x 390, the only
  playable orientation (§3.8).
* `render({ menuOpen })` sets `hidden` on `#touch-joystick` while the menu is
  open (releasing a held drag) and leaves `#touch-menu` visible above the menu
  so it can close it; an equal view writes nothing. `#touch-menu` also mirrors
  the menu state in `aria-expanded` ("true" while open, "false" otherwise).

## 3.7 Attack orders (owner request 2026-10-15, issue #296)

Superseded by §3.9 for the mouse button: the rules below still hold, with
`resolveRightClick` renamed to `resolveClickOrder` and reached by a left click.

A HIMARS clicked onto an enemy building drove up to it although it was
already in range: the order resolver only attacked enemy units and sent a
plain `move` for anything else. Unarmed units in the selection also walked
onto the clicked enemy. Generals precedent (issue #296, EA source
`CnC_Generals_Zero_Hour@0a05454d`): a context click on an enemy unit or
structure issues the same attack (`CommandXlat.cpp:1986`,
`ActionManager.cpp:723`). An attacker already in range fires in place
(`AIStates.cpp:315`). Out of range it stops at the first in-range cell of its
route (`AIPathfind.cpp:10606-10740`). Units without a weapon issue no order
(`CommandXlat.cpp:2262-2331`).

* `resolveClickOrder`: when the entity under the cursor (not a ghost) is a
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

## 3.8 Mobile web app: landscape, pinch zoom and install (owner request 2026-10-26)

Playing on a phone exposed four gaps: the browser pinch zoomed the page 2D
instead of the camera (the stretched canvas looked blurry), the game could be
played in portrait, there was no installable app shell, and the page could
scroll or overflow. This section amends §3.4 and §3.6.

* Landscape only. `client/index.html` uses `viewport-fit=cover`; the manifest
  (`client/public/manifest.webmanifest`) declares
  `"orientation": "landscape"` and `"display": "standalone"`, with 192, 512
  and maskable icons plus `icon.svg`. `installMobileShell()`
  (`client/src/app/mobileShell.ts`, called from `client/src/main.ts` in every
  mode) adds `#rotate-device` to the body and tries
  `screen.orientation.lock("landscape")` when running installed
  (`display-mode: standalone`). The stylesheet shows the overlay — "Rotate
  your device" / "Red Line plays in landscape." from i18n — for touch devices
  in portrait (`(orientation: portrait) and (pointer: coarse)`, plus
  `body.touch`). It sits above everything (z-index 100), so a portrait touch
  window cannot be played by accident. In a browser tab without an
  orientation lock the player rotates the device; the installed app holds
  landscape. A desktop portrait window is not blocked.
* Installable shell. A production build registers `/sw.js`
  (`client/public/sw.js`) after load: navigations are network-first with the
  cached shell as the offline fallback, and `/assets/`, `/icons/`,
  `/models/`, `/textures/` and `/data/` are stale-while-revalidate. The
  service worker is not registered in dev builds. `theme-color`,
  apple-touch-icon and standalone meta tags make iOS Add to Home Screen show
  the full-screen game.
* No page zoom, no overflow. The viewport meta sets `maximum-scale=1,
  user-scalable=no`; `html`, `body` and `#app` fill the viewport with
  `overflow: hidden` and `overscroll-behavior: none`, and `#app` and its
  canvas use `touch-action: none`. `installMobileShell()` prevents the iOS
  `gesturestart`/`gesturechange`/`gestureend` events and cancels two-finger
  `touchstart`/`touchmove` over `#app canvas` before the platform can start a
  native page zoom, so the page never scrolls or zooms while the menus keep
  `touch-action: pan-y` for their own scrolling. Safe-area insets
  keep the HUD, joystick, hamburger and command panel clear of notches;
  `#game-menu-panel` and `#save-manager-panel` cap their height at the
  viewport and scroll inside, so a landscape phone never overflows. The
  skirmish renderer caps its pixel ratio at 2, so camera zoom stays sharp on
  high-DPI screens without always quadrupling the fill rate at 3x.
* Pinch (amends §3.4). The camera stays orthographic and isometric (D-05):
  the pinch only changes `camera.zoom`, exactly like the wheel, and the target
  does not move. `client/src/camera.ts` exports `clampZoom(zoom)` and
  `zoomAfterPinch(zoom, fromDistance, toDistance)` =
  `clampZoom(zoom × toDistance / fromDistance)`; a degenerate distance
  leaves the zoom unchanged. `client/src/input/pinch.ts` tracks touch
  pointers for `SkirmishController`: on the second `pointerdown` it starts a
  pinch, calls `begin()` (cancels a drag selection and hides
  `#selection-box`) and records `startZoom` and the two-finger distance.
  Every move applies `zoomAfterPinch(startZoom, startDistance, distance)` and
  updates the projection matrix, so the wheel's [ZOOM_MIN, ZOOM_MAX] clamp
  applies to the whole gesture (spread = zoom in). Each finger's release is
  swallowed (no click, selection or order) until every finger is up; a third
  finger ends the current pinch and the remaining two start a fresh one;
  mouse pointers never pinch; `pointercancel` and window blur drop the
  gesture.
* Hamburger menu. `#touch-menu` (§3.6) stays the touch entry to the game menu:
  it draws three bars, is 56 x 56 CSS px in the top-right safe area, opens
  and closes the same menu as `Esc`, stays above the menu backdrop, and
  mirrors the state in `aria-expanded`/`aria-controls` (`#game-menu`).

## 3.9 Left-click orders and inert right button (owner request 2026-10-29)

The owner wants every map order on the left button: select a unit, click empty
ground to move, click an enemy to attack. The right button must issue no order.
This replaces the alternate scheme (left selects, right orders) of spec 20 §3.

### Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`; `EnglishZH.big` 1.04.

* `UseAlternateMouse` is client-only; both schemes send the same order messages.
  The left click reaches `evaluateContextCommand` only when the alternate flag
  is off (`CommandXlat.cpp:3767`; right click `:3678-3681`).
* A drawable click first asks for a context order; if there is one, the click
  is that order and the selection is unchanged; otherwise the click replaces
  the selection (`SelectionInfo.cpp:91-247`; `SelectionXlat.cpp:632`).
* Context priority: resume construction, dock, dozer repair, get-repaired-at,
  get-healed-at, enter (garrison/transport), attack, rally, move
  (`CommandXlat.cpp:1712-2225`). The move fallback refuses a friendly drawable.
* Empty ground is one `MSG_DO_MOVETO` for the whole selection
  (`CommandXlat.cpp:872,2294`).
* In the regular scheme a short right click deselects
  (`SelectionXlat.cpp:1027-1049`), cancels an armed command and build placement
  (`:1031-1039`; `CommandXlat.cpp:3652`), and held it pans the camera
  (`LookAtXlat.cpp:221-236`).
* Producer + left click on empty ground is `SET_RALLY_POINT`
  (`CommandXlat.cpp:2204-2225`).

Red Line copies the context-order-then-selection rule and the move fallback,
with three owner decisions:

* **D1 — the right button is inert.** It does nothing on the map or the HUD,
  not even deselect or cancel; `contextmenu` is prevented so the browser menu
  never appears. Selection is replaced by selecting another own entity or by
  an empty box drag; there is no explicit deselect gesture and no new button.
  Build placement cancels with `Esc` (or the touch menu button), armed commands
  with their own button (a second press), and Dig with its own button (a second
  press, now a toggle). Queue cancel is the queue item click only; the
  right-click on a build tile is removed.
* **D2 (revised 2026-10-29) — Rally by ground click or button.** A left click
  on empty ground with exactly one own complete producing building selected
  sets its rally (a building cannot move, so there is no conflict); the Rally
  button remains. Original text follows, superseded where it says button-only.
* **D2 (original) — Rally point is button-only.** `resolveClickOrder` no longer returns a
  rally for a selected producer; the Structure section's Rally button arms the
  next left click and `resolveRally` accepts exactly one own complete producing
  building. This deviates from Zero Hour's context click.
* **D4 — deselect and feedback (owner 2026-10-29).** `Esc` (no placement or
  armed mode open) clears the selection; a single click on the already
  selected lone entity deselects it; an empty box drag still clears. Move and
  context actions (repair, heal, board, resume, harvest) flash a short green
  ring on the target, like the red attack ring; attack stays red.
* **D6 — two-finger pan, never rotation (owner 2026-10-29).** Two fingers
  sliding together move the map (the ground follows the midpoint) once the
  midpoint has travelled 12 px; the pinch zoom is unchanged and both can
  combine. Only the midpoint and the distance are read: the angle between the
  fingers is never used, and the camera has no rotation, so a twist does
  nothing.
* **D7 — no joystick (owner 2026-10-29).** The virtual joystick
  (`#touch-joystick`, `touch.joystick`, `setAnalogPan`) is removed; the touch
  controls are only the menu button, and panning is the two-finger drag (D6) or
  the keys. This supersedes the joystick parts of §3.6 and AC-08-15, AC-08-18
  and AC-08-19, which now cover the menu button and the two-finger pan.
* **D5 — production queue untouched.** Right-click cancel on build tiles keeps
  working as today until the queue branch lands.
* **D3 — no separate confirm/cancel.** A context action is one click; there is
  no confirmation. Selecting an own object that is a valid context target for
  the current selection performs the action and keeps the selection; to select
  that object, first select another own entity or empty-box clear.

### Rules

On a left click that is not a drag (the existing `DRAG_THRESHOLD_PX` split):

1. Force-fire armed, `Ctrl`, Dig armed, Rally armed and placement keep their
   current priority (spec 20, 35, 41; spec 03 §6.5).
2. Context actions, first non-empty wins: garrison, board, bridge repair,
   vehicle repair at a factory, building repair by dozers, infirmary healing;
   then an enemy unit/building under the order pick is attacked by the armed
   units (unarmed units keep their orders); then an own incomplete building
   with a selected builder resumes construction (and moves the rest, as today).
3. If no order was issued and the click picks an own unit/building, the
   selection becomes that entity (double click on a unit still selects its type
   on screen). An own garrisoned feature with no order selects its occupants.
4. Otherwise: a neutral depot harvests for carriers and moves the rest; empty
   ground or any other non-own target moves the selected units; with no own
   units the click changes nothing. In particular, a selected producer plus a
   ground click does nothing (D2).
5. The selection is never cleared by a plain ground click. An empty box drag
   still clears it.

`client/src/input/intent.ts`:

```ts
/** Commands for a left click at ground (x, y) when the click is not on an own
 *  selectable entity: enemy attack, depot harvest, own incomplete resume, or
 *  move. No rally (spec 08 §3.9 D2). */
export function resolveClickOrder(args: { player: number; selected: readonly number[];
  entities: readonly EntityState[]; x: number; y: number }): SimCommand[];
/** Commands for the Rally button's armed left click: exactly one own complete
 *  producing building, else []. */
export function resolveRally(args: { player: number; selected: readonly number[];
  entities: readonly EntityState[]; x: number; y: number }): SimCommand[];
```

The old name `resolveRightClick` disappears. `skirmishController` keeps a
`contextmenu` listener that only calls `preventDefault`; the right-button force
fire and its duplicate-suppression flag are removed. `Ctrl + left click` still
force-fires (including macOS, where the same gesture also raises
`contextmenu`). The command panel no longer cancels production on a build
tile's `contextmenu`; the queue item click is the only cancel.

The Phase 1 tech slice uses the same rule: a point click on a unit selects it;
a point click on empty ground with a selection moves it; right click is inert.
Spec 02's AC-02-41 is amended accordingly.

### Acceptance criteria

**AC-08-25 Left-click intents (unit).** `resolveClickOrder` with own dozer 7,
rifleman 20 and supply truck 21 selected: empty ground (30, 30) →
`[move { units [7, 20, 21] }]`; enemy rifleman 30 → `[attack { units [20] }]`;
depot 0 → `[harvest { units [21] }, move { units [7, 20] }]`; own incomplete
barracks 16 → `[resume { units [7] }, move { units [20, 21] }]`; with only a
complete own barracks selected and a ground click → `[]` (no rally).
`resolveRally` with that barracks returns one rally; with a power plant or
three selected entities it returns `[]`.

**AC-08-26 Left-click move, attack and selection (Playwright).** In
`?debug=1&speed=4&ai=off`, a spawned owner-0 rifleman is selected with a left
click; a left click on empty ground gives it a `move` order and keeps the
selection; a left click on an enemy gives the `attack` order; a left click on
another own unit selects that unit; a right click on empty ground does not
change the order or the selection; a left drag over empty ground with no units
clears the selection.

**AC-08-27 Context actions on left click (Playwright).** With the example saves:
select dozers + damaged building → left click repairs it; damaged riflemen +
barracks → left click heals; infantry + own transport → left click boards;
dozers + incomplete building → left click resumes; workers + damaged bridge →
left click repairs. In every case the selection is unchanged.

**AC-08-28 Rally is button-only (Playwright).** Select a barracks, left click
empty ground → no rally command; press Rally point, left click the ground →
the rally order is sent and the armed state clears; clicking the button again
before the map click disarms it.

**AC-08-29 Inert right button (Playwright).** Right click on a produce tile
does not cancel the queue; right click on the map while placing does not leave
placement; right click on a selected unit does not deselect it; right click
during Dig/Rally/Force fire armed mode does not cancel it; `contextmenu` is
default-prevented on the canvas and the panel.

**AC-08-30 Touch left-click orders (Playwright).** With touch emulation, a tap
on empty ground with units selected moves them; a tap on another own unit
selects it; the `contextmenu` raised by a long press issues no order of its own
(the release is still a left tap, spec 08 §3.9 D1).

**AC-08-31 Tech-slice left click (Playwright).** `?mode=tech-slice&units=1`:
left click selects the unit; left click empty ground moves it; right click
does nothing.

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
side" make `#res-player` read "Player 2: Russia"; a second click returns it to
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
(`hasTouch`, 844 x 390) in `?debug=1&seed=1&ai=off`, `#rotate-device` is
hidden, `#touch-joystick` is in the bottom right quadrant and
`#command-panel` (with a unit selected) in the bottom left, neither overlaps
`#hud` or `#touch-menu`; pointer events on the knob (down, then move up by
half and by the full radius) move `cameraTarget()` in the ArrowUp direction
(-x, -y), the full push about twice as fast as the half push, the knob has the
class `pressed`; after `pointerup` the camera stays put and the knob is back at
the centre; a tap on `#touch-menu` opens `#game-menu` with `paused()` true,
hides `#touch-joystick`, sets `aria-expanded="true"` and a second tap closes
it and sets `aria-expanded="false"`; no console error.

**AC-08-17 No touch controls without touch (Playwright).** In a default desktop
context `#touch-controls` is not in the DOM and `ArrowRight` still pans.

**AC-08-20 Attack intents.** With the AC-03-49 entities plus an enemy
`ru-barracks` 50 centred at `(25.5, 25.5)` and an incomplete enemy
`ru-power-plant` 51 centred at `(31, 31)`, all for player 0: left click on 30
with `[7, 20, 21]` selected → `[attack { units [20], target 30 }]`; on 50 →
`[attack { units [20], target 50 }]`; on 51 with `[20]` →
`[attack { units [20], target 51 }]`; on 30 or 50 with only `[7, 21]` → `[]`.

**AC-08-21 Attackers hold position in range.** In the combat sandbox, a
mortar unit (range 10) ordered to attack an enemy power plant 8.5 tiles away
or an enemy truck 8 tiles away has the same position after 30 ticks, and the
plant has lost hit points. A mortar ordered to attack a spotted truck 28 tiles
away stops more than 9.8 tiles from it once within 10 tiles, and stays there
30 more ticks.

**AC-08-22 Pinch zoom math and gesture.** `zoomAfterPinch(1, 100, 200)` is 2,
`zoomAfterPinch(1, 200, 100)` is `ZOOM_MIN`, `zoomAfterPinch(1, 100, 1000)`
is `ZOOM_MAX`, and a zero distance leaves the zoom unchanged.
`createPinchGesture` ignores a single touch and mouse pointers, starts at the
second touch, applies `zoom(2)` when the distance doubles from 100 to 200 px,
clamps at `ZOOM_MAX` and `ZOOM_MIN`, swallows both releases, and a later
single tap returns false; `cancel` drops the pointers.

**AC-08-23 Pinch in the skirmish (Playwright).** With touch emulation
(`hasTouch`, `isMobile`, 844 x 390) in `?debug=1&seed=1&ai=off`, a real
two-finger spread from 160 to 320 px makes `zoom()` 2 ± 0.01 and keeps
`cameraTarget()`; the two-finger `touchstart` arrives with
`defaultPrevented` true; spreading to 800 px clamps `zoom()` at 3; pinching
from 600 to 20 px clamps it at 0.6; `visualViewport.scale` stays 1, `scrollX`
and `scrollY` stay 0, `selectedIds()` stays empty and `#selection-box`
hidden; no console error.

**AC-08-24 Mobile web app (Playwright).** In the same context the manifest is
200 with name "Modern Conquest: Red Line", `display: "standalone"`,
`orientation: "landscape"` and 192/512 icons (the icons fetch as
`image/png`); a service worker registration exists; the viewport meta
contains `user-scalable=no` and `viewport-fit=cover`; landscape shows no
`#rotate-device` and no page overflow, the hamburger opens `#game-menu` with
its panel inside the viewport and no overflow, and a 390 x 844 portrait
viewport shows `#rotate-device` ("Rotate your device") with no overflow and
`scrollY` 0; no console error.

## 5. Queued requests (to be specified)

1. Camera bookmarks: save with `Ctrl+F1..F4`, jump with `F1..F4`.
2. Clear selection indicator: ring under selected units and a selection panel
   showing the selected unit's name, portrait/icon and health.
3. Camera rotation in 90° steps.
4. Unit waypoints (production rally points are delivered in spec 33).
5. Unit stances: guard/defend, scout/explore, scatter, hold position.
6. Rotating buildings before placing them (footprint rotation in the sim).
