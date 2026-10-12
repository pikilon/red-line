# 08 — Player controls

Status: §3 (pause) approved by the owner on 2026-10-11 for immediate
implementation; §5 lists the owner's other requests, to be specified later.
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

**AC-08-04 Game menu view.** `createGameMenu` renders three buttons in the §3.1
order; `render` with an equal view does not touch the DOM (same button
elements, no text writes); clicking each button calls its action once; the
gore label follows `view.gore`; `open: false` sets `hidden`.

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

## 5. Queued requests (to be specified)

1. Camera bookmarks: save with `Ctrl+F1..F4`, jump with `F1..F4`.
2. Clear selection indicator: ring under selected units and a selection panel
   showing the selected unit's name, portrait/icon and health.
3. Zoom in/out with the mouse wheel (bounded).
4. Camera rotation in 90° steps.
5. Rally points for production buildings in the UI (the sim already supports
   `Rally`) and unit waypoints.
6. Unit stances: guard/defend, scout/explore, scatter, hold position.
7. Rotating buildings before placing them (footprint rotation in the sim).

## 6. Traceability

| Criterion | File | Test |
|---|---|---|
| AC-08-01 | `client/src/sim/workerHandler.test.ts` | `AC-08-01: worker pause` |
| AC-08-02 | `client/src/sim/skirmishClient.test.ts` | `AC-08-02: client pause message` |
| AC-08-03 | `client/tests/e2e/pause.spec.ts` | `AC-08-03: game menu in the skirmish` |
| AC-08-04 | `client/src/ui/gameMenu.test.ts` | `AC-08-04: game menu view` |
| AC-08-05 | `client/src/app/cameraMemory.test.ts` | `AC-08-05: camera memory` |
| AC-08-06 | `client/tests/e2e/hotSeatCamera.spec.ts` | `AC-08-06: hot-seat camera` |

## 7. Issue breakdown

| Issue | Scope | Criteria | Tier |
|---|---|---|---|
| P5-01 (#183) | pause (§3) | AC-08-01..03 | ready-pro |
| P5-02 (#200) | game menu on Esc (§3.1) | AC-08-03, 04 | ready-local |
| P5-03 (#220) | hot-seat camera (§3.2) | AC-08-05, 06 | ready-pro |
