import { t } from "./i18n";
import { factionName } from "./rules";

/** "", "Name", or "Name x 2, Other" for the type names of the selection (spec 14 §5). */
export function selectionLabel(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => (count > 1 ? `${name} x ${count}` : name))
    .join(", ");
}

export interface Hud {
  setSelectedCount(n: number): void;
  /** `#hud-selected-type`: the type names of the selection (spec 14 §5). */
  setSelectedTypes(names: readonly string[]): void;
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
  const selectedType = appendDiv(root, "hud-selected-type");
  const tick = appendDiv(root, "hud-tick");
  const player = appendDiv(root, "hud-player");
  let error: HTMLDivElement | undefined;
  return {
    setSelectedCount(n) {
      selected.textContent = t("hud.selectedCount", { count: n });
    },
    setSelectedTypes(names) {
      selectedType.textContent = selectionLabel(names);
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
