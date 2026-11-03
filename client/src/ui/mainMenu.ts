import { type MessageKey, t } from "../i18n";
import { appendDiv } from "./dom";
import { TUTORIALS, type TutorialMission } from "./tutorial";

/** Callbacks of the main menu buttons (spec 45 §4). */
export interface MainMenuActions {
  /** Leaves the shell battle for a new skirmish. */
  skirmish(): void;
  /** Opens the save manager in load mode (spec 19 §5.5). */
  loadGame(): void;
  /** Starts a tutorial mission (spec 46). */
  tutorial(mission: TutorialMission): void;
}

function menuButton(id: string, text: string, action: () => void): HTMLElement {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.textContent = text;
  button.addEventListener("click", action);
  return button;
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
  const main = document.createElement("div");
  main.className = "main-menu-page";
  const tutorials = document.createElement("div");
  tutorials.className = "main-menu-page";
  tutorials.hidden = true;
  const show = (page: HTMLElement): void => {
    main.hidden = page !== main;
    tutorials.hidden = page !== tutorials;
  };
  const buttons: [string, MessageKey, () => void][] = [
    ["main-menu-skirmish", "mainMenu.skirmish", actions.skirmish],
    ["main-menu-tutorials", "mainMenu.tutorials", () => show(tutorials)],
    ["main-menu-load", "mainMenu.loadGame", actions.loadGame],
  ];
  for (const [id, key, action] of buttons) {
    main.appendChild(menuButton(id, t(key), action));
  }
  // Spec 46 §2: one group of missions per army.
  let faction = "";
  for (const mission of TUTORIALS) {
    if (mission.faction !== faction) {
      faction = mission.faction;
      const heading = document.createElement("h2");
      heading.textContent = t(`faction.${faction}` as MessageKey);
      tutorials.appendChild(heading);
    }
    tutorials.appendChild(
      menuButton(`main-menu-${mission.id}`, t(mission.title), () =>
        actions.tutorial(mission),
      ),
    );
  }
  tutorials.appendChild(
    menuButton("main-menu-back", t("mainMenu.back"), () => show(main)),
  );
  panel.append(main, tutorials);
  element.appendChild(panel);
  return element;
}
