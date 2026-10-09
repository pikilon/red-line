import { t } from "./i18n";

export interface Hud {
  setSelectedCount(n: number): void;
  setTick(n: number): void;
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
  let error: HTMLDivElement | undefined;
  return {
    setSelectedCount(n) {
      selected.textContent = t("hud.selectedCount", { count: n });
    },
    setTick(n) {
      tick.textContent = t("hud.tick", { tick: n });
    },
    showError(detail) {
      error ??= appendDiv(root, "hud-error");
      error.setAttribute("role", "alert");
      error.textContent = t("error.simInit", { detail });
    },
  };
}
