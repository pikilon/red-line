import { type MessageKey, t } from "../i18n";
import { appendDiv } from "./dom";

/** Callbacks of the main menu buttons (spec 45 §4). */
export interface MainMenuActions {
  /** Leaves the shell battle for a new skirmish. */
  skirmish(): void;
  /** Opens the save manager in load mode (spec 19 §5.5). */
  loadGame(): void;
}

/** The `#main-menu` overlay drawn over the AI-vs-AI shell battle (spec 45). */
export function createMainMenu(
  root: HTMLElement,
  actions: MainMenuActions,
): HTMLElement {
  const element = appendDiv(root, "main-menu");
  const panel = document.createElement("nav");
  panel.id = "main-menu-panel";
  const title = document.createElement("h1");
  title.id = "main-menu-title";
  title.textContent = t("mainMenu.title");
  const subtitle = document.createElement("p");
  subtitle.id = "main-menu-subtitle";
  subtitle.textContent = t("mainMenu.subtitle");
  panel.append(title, subtitle);
  const buttons: [string, MessageKey, () => void][] = [
    ["main-menu-skirmish", "mainMenu.skirmish", actions.skirmish],
    ["main-menu-load", "mainMenu.loadGame", actions.loadGame],
  ];
  for (const [id, key, action] of buttons) {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.textContent = t(key);
    button.addEventListener("click", action);
    panel.appendChild(button);
  }
  element.appendChild(panel);
  return element;
}
