import { loadSettings, saveSettings } from "../settings";

/** The folded-panel ids after `id` is folded or unfolded (spec 41 §3.4). */
export function withFolded(
  folded: readonly string[],
  id: string,
  fold: boolean,
): string[] {
  const rest = folded.filter((entry) => entry !== id);
  return fold ? [...rest, id].sort() : rest;
}

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg>';

export interface Foldable {
  /** The tab button, already the first child of the panel. */
  readonly tab: HTMLButtonElement;
  folded(): boolean;
  setFolded(folded: boolean): void;
  /** Lights the dot on the tab (e.g. while a queue runs). */
  setLit(lit: boolean): void;
}

/**
 * Gives `panel` a fold tab (chevron, `label`, activity dot) as its first child.
 * A folded panel carries the `folded` class and hides every other child with
 * CSS; the state is stored in the settings so it survives a reload (spec 41
 * §3.4). Reusable by every docked panel.
 */
export function createFoldable(
  panel: HTMLElement,
  id: string,
  label: string,
  storage?: Storage,
): Foldable {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "fold-tab";
  tab.dataset.fold = id;
  tab.innerHTML = `<span class="fold-chevron">${CHEVRON}</span><span class="fold-label"></span><i class="fold-dot"></i>`;
  const text = tab.querySelector(".fold-label");
  if (text !== null) text.textContent = label;
  panel.classList.add("foldable");
  panel.prepend(tab);

  let folded = loadSettings(storage).foldedPanels?.includes(id) ?? false;
  const apply = (): void => {
    panel.classList.toggle("folded", folded);
    tab.setAttribute("aria-expanded", String(!folded));
    tab.title = label;
  };
  apply();
  tab.addEventListener("click", () => {
    folded = !folded;
    const settings = loadSettings(storage);
    saveSettings(
      {
        ...settings,
        foldedPanels: withFolded(settings.foldedPanels ?? [], id, folded),
      },
      storage,
    );
    apply();
  });
  return {
    tab,
    folded: () => folded,
    setFolded(value) {
      if (value === folded) return;
      tab.click();
    },
    setLit(lit) {
      tab.classList.toggle("lit", lit);
    },
  };
}
