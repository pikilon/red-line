import { t } from "../i18n";
import { appendDiv } from "./dom";

/** Pan directions of the D-pad; `up` is what the Up arrow does (spec 08 §3.6). */
export type PanDirection = "up" | "down" | "left" | "right";

/** Callbacks of the touch controls (spec 08 §3.6). */
export interface TouchControlsActions {
  /** A direction button is held (`true`) or released (`false`). */
  pan(direction: PanDirection, held: boolean): void;
  /** The menu button was tapped: does what `Esc` does. */
  toggleMenu(): void;
}

/** What one touch controls render shows. */
export interface TouchControlsView {
  menuOpen: boolean;
}

/** The `#touch-controls` overlay: a D-pad and a menu button. */
export interface TouchControls {
  /** `#touch-controls`. */
  readonly root: HTMLElement;
  /** Hides the D-pad while the menu is open; an equal view writes nothing. */
  render(view: TouchControlsView): void;
}

const DIRECTIONS = {
  up: { id: "touch-up", label: "touch.up", glyph: "▲" },
  down: { id: "touch-down", label: "touch.down", glyph: "▼" },
  left: { id: "touch-left", label: "touch.left", glyph: "◀" },
  right: { id: "touch-right", label: "touch.right", glyph: "▶" },
} as const;

const DIRECTION_ORDER: readonly PanDirection[] = [
  "up",
  "left",
  "right",
  "down",
];

/** True on touch screens: a coarse pointer or any touch point (spec 08 §3.6). */
export function isTouchDevice(): boolean {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0
  );
}

function createButton(
  parent: HTMLElement,
  id: string,
  label: string,
  glyph: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = id;
  button.textContent = glyph;
  button.setAttribute("type", "button");
  button.setAttribute("aria-label", label);
  parent.appendChild(button);
  // Taps on the controls never reach the map: no selection box, no orders.
  for (const type of ["pointerdown", "pointerup", "click"]) {
    button.addEventListener(type, (event) => event.stopPropagation());
  }
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  return button;
}

/** Creates the touch controls once, so the buttons stay clickable with a real
 *  pointer (spec 08 §3.6, AC-03-65). */
export function createTouchControls(
  parent: HTMLElement,
  actions: TouchControlsActions,
): TouchControls {
  const root = appendDiv(parent, "touch-controls");
  const dpad = appendDiv(root, "touch-dpad");
  const held = new Set<PanDirection>();

  function release(direction: PanDirection): void {
    if (!held.delete(direction)) return;
    actions.pan(direction, false);
  }

  for (const direction of DIRECTION_ORDER) {
    const spec = DIRECTIONS[direction];
    const button = createButton(dpad, spec.id, t(spec.label), spec.glyph);
    button.addEventListener("pointerdown", () => {
      if (held.has(direction)) return;
      held.add(direction);
      actions.pan(direction, true);
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
      button.addEventListener(type, () => release(direction));
    }
  }

  const menu = createButton(root, "touch-menu", t("touch.menu"), "☰");
  menu.addEventListener("click", () => actions.toggleMenu());

  let last: TouchControlsView | null = null;
  return {
    root,
    render(view) {
      if (last !== null && last.menuOpen === view.menuOpen) return;
      last = { menuOpen: view.menuOpen };
      if (view.menuOpen) {
        for (const direction of [...held]) release(direction);
      }
      if (dpad.hidden !== view.menuOpen) dpad.hidden = view.menuOpen;
    },
  };
}
