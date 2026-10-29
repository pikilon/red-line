import { t } from "./i18n";

/**
 * The corner readout of the phase-1 tech slice (spec 02): `#hud-selected` and
 * `#hud-tick`, plus `#hud-error` when the simulation fails to start.
 *
 * The skirmish moved every line of this block on 2026-10-29 (owner request):
 * the selection name lives in the command panel (`#picked`), the tick in the
 * performance panel (`#perf-tick`) and the player in the resource panel. The
 * tech slice is a debug harness frozen by spec 02, so it keeps its corner.
 */
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
