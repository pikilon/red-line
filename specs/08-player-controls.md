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

## 7. Issue breakdown

| Issue | Scope | Criteria | Tier |
|---|---|---|---|
| P5-01 (#183) | pause (§3) | AC-08-01..03 | ready-pro |
| P5-02 (#200) | game menu on Esc (§3.1) | AC-08-03, 04 | ready-local |
