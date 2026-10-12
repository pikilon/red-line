import { t } from "../i18n";
import { appendDiv, setText } from "./dom";

/** What one game menu render shows (spec 08 §3.1). */
export interface GameMenuView {
  open: boolean;
  gore: boolean;
  /** Whether the AI plays; null when no AI is attached (§3.3). */
  ai: boolean | null;
  /** Generated textures on (spec 12 §3); absent counts as off. */
  generatedTextures?: boolean;
}

/** Callbacks the game menu buttons invoke (spec 08 §3.1). */
export interface GameMenuActions {
  /** Closes the menu and resumes. */
  resume(): void;
  /** Same as the `G` key (spec 07 §5). */
  toggleGore(): void;
  /** Pauses or resumes the skirmish AI (§3.3). */
  toggleAi(): void;
  /** Switches procedural/generated textures (spec 12 §3); no button when absent. */
  toggleTextures?(): void;
  /** Reloads the page with the same query string. */
  restart(): void;
}

/** The `#game-menu` overlay (spec 08 §3.1). */
export interface GameMenu {
  /** `#game-menu`. */
  readonly root: HTMLElement;
  /** Re-renders only when `view` differs from the last rendered view. */
  render(view: GameMenuView): void;
}

/** The full-screen game menu: a backdrop with a centred panel holding the
 *  title and the Resume, Gore, AI and Restart buttons (§3.3). Buttons are
 *  created once, so they stay clickable with a real mouse (spec 08 §3.1,
 *  AC-03-65). */
export function createGameMenu(
  parent: HTMLElement,
  actions: GameMenuActions,
): GameMenu {
  const root = appendDiv(parent, "game-menu");
  root.hidden = true;

  const panel = appendDiv(root, "game-menu-panel");
  const title = document.createElement("h2");
  title.id = "game-menu-title";
  title.textContent = t("menu.title");
  panel.appendChild(title);

  const resume = createButton("game-menu-resume", t("menu.resume"), () => {
    actions.resume();
  });
  const gore = createButton("game-menu-gore", t("menu.goreOff"), () => {
    actions.toggleGore();
  });
  const ai = createButton("game-menu-ai", t("menu.aiOn"), () => {
    actions.toggleAi();
  });
  const restart = createButton("game-menu-restart", t("menu.restart"), () => {
    actions.restart();
  });
  panel.appendChild(resume);
  panel.appendChild(gore);
  panel.appendChild(ai);
  const toggleTextures = actions.toggleTextures;
  const textures =
    toggleTextures === undefined
      ? null
      : createButton("game-menu-textures", t("menu.texturesProcedural"), () =>
          toggleTextures.call(actions),
        );
  if (textures !== null) panel.appendChild(textures);
  panel.appendChild(restart);

  /** Last rendered view; an equal render mutates nothing. */
  let last: GameMenuView | null = null;

  return {
    root,
    render(view) {
      if (
        last !== null &&
        last.open === view.open &&
        last.gore === view.gore &&
        last.ai === view.ai &&
        last.generatedTextures === view.generatedTextures
      ) {
        return;
      }
      last = {
        open: view.open,
        gore: view.gore,
        ai: view.ai,
        generatedTextures: view.generatedTextures,
      };
      if (root.hidden !== !view.open) root.hidden = !view.open;
      setText(gore, t(view.gore ? "menu.goreOn" : "menu.goreOff"));
      if (textures !== null) {
        setText(
          textures,
          t(
            view.generatedTextures === true
              ? "menu.texturesGenerated"
              : "menu.texturesProcedural",
          ),
        );
      }
      if (ai.hidden !== (view.ai === null)) ai.hidden = view.ai === null;
      if (view.ai !== null) {
        setText(ai, t(view.ai ? "menu.aiOn" : "menu.aiOff"));
      }
    },
  };
}

/** A menu button created once; only its text changes on render. */
function createButton(
  id: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = id;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
