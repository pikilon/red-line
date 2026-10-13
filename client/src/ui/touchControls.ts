import { t } from "../i18n";
import { appendDiv } from "./dom";

/** Callbacks of the touch controls (spec 08 §3.6). */
export interface TouchControlsActions {
  /** The joystick vector, each axis in [-1, 1] (x right, y down); `(0, 0)` at
   *  rest and on release. */
  pan(x: number, y: number): void;
  /** The menu button was tapped: does what `Esc` does. */
  toggleMenu(): void;
}

/** What one touch controls render shows. */
export interface TouchControlsView {
  menuOpen: boolean;
}

/** The `#touch-controls` overlay: a virtual joystick and a menu button. */
export interface TouchControls {
  /** `#touch-controls`. */
  readonly root: HTMLElement;
  /** Hides the joystick while the menu is open; an equal view writes nothing. */
  render(view: TouchControlsView): void;
}

/** Fraction of the base radius inside which the joystick reports nothing. */
const DEAD_ZONE = 0.15;

/** True on touch screens: a coarse pointer or any touch point (spec 08 §3.6). */
export function isTouchDevice(): boolean {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0
  );
}

/** Taps on the controls never reach the map: no selection box, no orders. */
function isolate(element: HTMLElement): void {
  for (const type of ["pointerdown", "pointerup", "click"]) {
    element.addEventListener(type, (event) => event.stopPropagation());
  }
  element.addEventListener("contextmenu", (event) => event.preventDefault());
}

/** Creates the touch controls once, so the controls stay usable with a real
 *  pointer (spec 08 §3.6, AC-03-65). */
export function createTouchControls(
  parent: HTMLElement,
  actions: TouchControlsActions,
): TouchControls {
  const root = appendDiv(parent, "touch-controls");
  const base = appendDiv(root, "touch-joystick");
  const knob = appendDiv(base, "touch-joystick-knob");
  base.setAttribute("aria-label", t("touch.joystick"));
  isolate(base);

  let active: number | null = null;
  let reported = { x: 0, y: 0 };

  function report(x: number, y: number): void {
    if (reported.x === x && reported.y === y) return;
    reported = { x, y };
    actions.pan(x, y);
  }

  /** Moves the knob under the pointer, clamped to the base, and reports. */
  function drag(clientX: number, clientY: number): void {
    const rect = base.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = clientX - (rect.left + radius);
    let dy = clientY - (rect.top + radius);
    const length = Math.hypot(dx, dy);
    if (length > radius) {
      dx = (dx * radius) / length;
      dy = (dy * radius) / length;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (length / radius < DEAD_ZONE) report(0, 0);
    else report(dx / radius, dy / radius);
  }

  function release(): void {
    if (active === null) return;
    const id = active;
    active = null;
    if (base.hasPointerCapture(id)) base.releasePointerCapture(id);
    knob.classList.remove("pressed");
    knob.style.transform = "translate(0px, 0px)";
    report(0, 0);
  }

  base.addEventListener("pointerdown", (event) => {
    if (active !== null) return;
    active = event.pointerId;
    try {
      base.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; the drag still works.
    }
    knob.classList.add("pressed");
    drag(event.clientX, event.clientY);
  });
  base.addEventListener("pointermove", (event) => {
    if (event.pointerId !== active) return;
    drag(event.clientX, event.clientY);
  });
  for (const type of ["pointerup", "pointercancel"] as const) {
    base.addEventListener(type, (event) => {
      if (event.pointerId === active) release();
    });
  }
  window.addEventListener("blur", release);

  const menu = document.createElement("button");
  menu.id = "touch-menu";
  menu.textContent = "☰";
  menu.setAttribute("type", "button");
  menu.setAttribute("aria-label", t("touch.menu"));
  root.appendChild(menu);
  isolate(menu);
  menu.addEventListener("click", () => actions.toggleMenu());

  let last: TouchControlsView | null = null;
  return {
    root,
    render(view) {
      if (last !== null && last.menuOpen === view.menuOpen) return;
      last = { menuOpen: view.menuOpen };
      if (view.menuOpen) release();
      if (base.hidden !== view.menuOpen) base.hidden = view.menuOpen;
    },
  };
}
