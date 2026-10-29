import { t } from "../i18n";
import { appendDiv } from "./dom";

/** Callbacks of the touch controls (spec 08 §3.6). */
export interface TouchControlsActions {
  /** The menu button was tapped: does what `Esc` does. */
  toggleMenu(): void;
}

/** What one touch controls render shows. */
export interface TouchControlsView {
  menuOpen: boolean;
}

/** The `#touch-controls` overlay: the menu button. */
export interface TouchControls {
  /** `#touch-controls`. */
  readonly root: HTMLElement;
  /** Mirrors the open menu in `aria-expanded`; an equal view writes nothing. */
  render(view: TouchControlsView): void;
}

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
  const menu = document.createElement("button");
  menu.id = "touch-menu";
  menu.textContent = "☰";
  menu.setAttribute("type", "button");
  menu.setAttribute("aria-label", t("touch.menu"));
  menu.setAttribute("aria-haspopup", "dialog");
  menu.setAttribute("aria-controls", "game-menu");
  menu.setAttribute("aria-expanded", "false");
  root.appendChild(menu);
  isolate(menu);
  menu.addEventListener("click", () => actions.toggleMenu());

  let last: TouchControlsView | null = null;
  return {
    root,
    render(view) {
      if (last !== null && last.menuOpen === view.menuOpen) return;
      last = { menuOpen: view.menuOpen };
      menu.setAttribute("aria-expanded", view.menuOpen ? "true" : "false");
    },
  };
}
