import { t } from "./i18n";
import { factionName } from "./rules";

export interface Hud {
  setSelectedCount(n: number): void;
  setTick(n: number): void;
  /** Skirmish only: `#hud-player`, with a 1-based player number (spec §6.6). */
  setPlayer(player: number, faction: number): void;
  showError(detail: string): void;
}

function appendDiv(root: HTMLElement, id: string): HTMLDivElement {
  const element = document.createElement("div");
  element.id = id;
  root.appendChild(element);
  return element;
}

export function createHud(root: HTMLElement): Hud {
  const selected = appendDiv(root, "hud-selected");
  const tick = appendDiv(root, "hud-tick");
  const player = appendDiv(root, "hud-player");
  let error: HTMLDivElement | undefined;
  return {
    setSelectedCount(n) {
      selected.textContent = t("hud.selectedCount", { count: n });
    },
    setTick(n) {
      tick.textContent = t("hud.tick", { tick: n });
    },
    setPlayer(n, faction) {
      player.textContent = t("hud.player", {
        player: n,
        faction: factionName(faction),
      });
    },
    showError(detail) {
      error ??= appendDiv(root, "hud-error");
      error.setAttribute("role", "alert");
      error.textContent = t("error.simInit", { detail });
    },
  };
}
