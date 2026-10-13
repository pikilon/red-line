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

## 3.6 Touch controls (owner request 2026-10-13, issue #251)

On touch screens panning needed the arrow keys / WASD and the menu needed
`Esc`. Touch devices get a D-pad and a menu button.

* Shown only on touch devices: `isTouchDevice()` is true when
  `matchMedia("(pointer: coarse)").matches` or `navigator.maxTouchPoints > 0`.
  Otherwise the controls are not created (no DOM, nothing on desktop).
* `client/src/ui/touchControls.ts` exports `type PanDirection = "up" | "down" |
  "left" | "right"`, `TouchControlsActions { pan(direction: PanDirection, held:
  boolean): void; toggleMenu(): void }`, `TouchControls { root: HTMLElement;
  render(view: { menuOpen: boolean }): void }` and
  `createTouchControls(parent: HTMLElement, actions: TouchControlsActions)`.
* DOM, created once (AC-03-65): `#touch-controls` holds `#touch-dpad` with four
  buttons `#touch-up`, `#touch-down`, `#touch-left`, `#touch-right` (bottom
  left, cross layout) and `#touch-menu` (top right, label "☰"). Every button is
  at least 48 x 48 CSS px, has an `aria-label` from i18n
  (`touch.up`, `touch.down`, `touch.left`, `touch.right`, `touch.menu`) and
  the D-pad has `touch-action: none` and no text selection.
* Panning: `pointerdown` on a direction button calls `pan(direction, true)`;
  `pointerup`, `pointercancel` and `pointerleave` call `pan(direction, false)`
  (once, and only if it was held). The skirmish maps the directions to the
  arrow-key codes in `PAN_KEYS` (`up` = `ArrowUp`...) inside the controller's
  pressed set, so speed and the `panDelta` path are those of the keyboard and
  the keyboard keeps working. A window `blur` releases them too.
* `#touch-menu` `click` calls `toggleMenu()`; the skirmish does what `Esc`
  does: with a placement mode active it cancels placement and leaves the menu
  closed, otherwise it opens (pause) or closes (resume) the game menu.
* `pointerdown`, `pointerup` and `click` on the controls stop propagation and
  `contextmenu` is prevented, so a touch never starts a selection box or an
  order on the map; the controls are DOM siblings of the canvas, never inside
  the HUD, the command panel or the game menu (on touch the command panel sits
  at the bottom right so the D-pad does not cover it).
* `render({ menuOpen })` sets `hidden` on `#touch-dpad` while the menu is open
  (releasing any held direction) and leaves `#touch-menu` visible above the
  menu so it can close it; an equal view writes nothing.
* Out of scope: selecting and commanding by touch beyond what pointer events
  already give, pinch zoom, long press.

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

**AC-08-15 Touch controls view.** `createTouchControls` creates the five
buttons once with the §3.6 ids and i18n aria-labels; `pointerdown` on `#touch-right` calls
`pan("right", true)` once, `pointerup` then `pan("right", false)`; `pointercancel`
and `pointerleave` also release a held button, and a release without a press
calls nothing; a click on `#touch-menu` calls `toggleMenu()` once; the
button events call `stopPropagation`; `render({ menuOpen: true })` hides
`#touch-dpad` and releases the held direction, keeps `#touch-menu` visible, and
an equal view writes nothing.

**AC-08-16 Touch controls in the skirmish (Playwright).** With touch emulation
(`hasTouch`, 390 x 844) in `?debug=1&seed=1&ai=off`, the five buttons are
visible, at least 48 px, and the D-pad does not overlap `#hud`; holding
`#touch-right` (pointer down) moves `cameraTarget()` by the keyboard
`ArrowRight` direction (+x, -y), and after release it stays put; a tap on
`#touch-menu` opens `#game-menu` with `paused()` true, hides `#touch-dpad` and
a second tap closes it with `paused()` false; no console error.

**AC-08-17 No touch controls without touch (Playwright).** In a default desktop
context `#touch-controls` is not in the DOM and `ArrowRight` still pans.

## 5. Queued requests (to be specified)

1. Camera bookmarks: save with `Ctrl+F1..F4`, jump with `F1..F4`.
2. Clear selection indicator: ring under selected units and a selection panel
   showing the selected unit's name, portrait/icon and health.
3. Camera rotation in 90° steps.
4. Rally points for production buildings in the UI (the sim already supports
   `Rally`) and unit waypoints.
5. Unit stances: guard/defend, scout/explore, scatter, hold position.
6. Rotating buildings before placing them (footprint rotation in the sim).

## 6. Traceability

| Criterion | File | Test |
|---|---|---|
| AC-08-01 | `client/src/sim/workerHandler.test.ts` | `AC-08-01: worker pause` |
| AC-08-02 | `client/src/sim/skirmishClient.test.ts` | `AC-08-02: client pause message` |
| AC-08-03 | `client/tests/e2e/pause.spec.ts` | `AC-08-03: game menu in the skirmish` |
| AC-08-04 | `client/src/ui/gameMenu.test.ts` | `AC-08-04: game menu view` |
| AC-08-05 | `client/src/app/cameraMemory.test.ts` | `AC-08-05: camera memory` |
| AC-08-06 | `client/tests/e2e/hotSeatCamera.spec.ts` | `AC-08-06: hot-seat camera` |
| AC-08-07 | `crates/sim/tests/ai.rs` | `ac_08_07_ai_pause` |
| AC-08-08 | `client/src/sim/skirmishClient.test.ts`, `client/src/sim/workerHandler.test.ts` | `AC-08-08: worker and client AI toggle` |
| AC-08-09 | `client/tests/e2e/pause.spec.ts` | `AC-08-09: AI toggle in the skirmish` |
| AC-08-10 | `client/src/camera.test.ts` | `AC-08-10: wheel zoom` |
| AC-08-11 | `client/tests/e2e/zoom.spec.ts` | `AC-08-11: zoom in the skirmish` |
| AC-08-12 | `client/src/ui/gameMenuDebug.test.ts` | `AC-08-12: debug buttons in the menu view` |
| AC-08-13 | `client/tests/e2e/menuDebug.spec.ts` | `AC-08-13: switch side in the skirmish` |
| AC-08-14 | `client/tests/e2e/menuDebug.spec.ts` | `AC-08-14: reveal and FPS panel in the skirmish` |
| AC-08-15 | `client/src/ui/touchControls.test.ts` | `AC-08-15: touch controls view` |
| AC-08-16 | `client/tests/e2e/touchControls.spec.ts` | `AC-08-16: touch controls in the skirmish` |
| AC-08-17 | `client/tests/e2e/touchControls.spec.ts` | `AC-08-17: no touch controls without touch` |

## 7. Issue breakdown

| Issue | Scope | Criteria | Tier |
|---|---|---|---|
| P5-01 (#183) | pause (§3) | AC-08-01..03 | ready-pro |
| P5-02 (#200) | game menu on Esc (§3.1) | AC-08-03, 04 | ready-local |
| P5-03 (#220) | hot-seat camera (§3.2) | AC-08-05, 06 | ready-pro |
| P5-04 (#219) | AI toggle in the game menu (§3.3) | AC-08-04, 07..09 | ready-pro |
| P5-05 (#226) | mouse-wheel zoom (§3.4) | AC-08-10, 11 | ready-pro |
| P5-06 (#245) | switch side, reveal, FPS panel in the menu (§3.5) | AC-08-12..14 | ready-pro |
| P5-07 (#251) | touch controls (§3.6) | AC-08-15..17 | ready-pro |
