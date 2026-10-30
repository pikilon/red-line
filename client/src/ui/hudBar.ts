import { t } from "../i18n";
import { loadSettings, saveSettings } from "../settings";
import { appendDiv } from "./dom";

/** The tabs of the unified HUD bar (spec 42 §3.2). */
export const HUD_TABS = ["orders", "build", "groups"] as const;
export type HudTab = (typeof HUD_TABS)[number];

/** What the panel offers now, for `autoTab`. */
export interface TabOffer {
  /** The selection has something to build or produce. */
  build: boolean;
  /** The selection differs from the last one and is not empty. */
  newSelection: boolean;
  /** The selection came from a group slot: the Groups tab stays. */
  fromGroup: boolean;
}

/** The tab to show after the selection or its offers change (spec 42 §3.2). */
export function autoTab(current: HudTab, offer: TabOffer): HudTab {
  if (offer.newSelection && !(offer.fromGroup && current === "groups")) {
    return offer.build ? "build" : "orders";
  }
  return current === "build" && !offer.build ? "orders" : current;
}

export interface HudBar {
  /** `#hud-menu`: holds the menu button. */
  readonly menu: HTMLElement;
  /** `#hud-status`: holds the player, credits and power. */
  readonly status: HTMLElement;
  /** `#hud-selection`: holds the name of what is picked. */
  readonly selection: HTMLElement;
  /** `#hud-content`: the scrolling row the tabs fill. */
  readonly content: HTMLElement;
  /** The tab on show. */
  tab(): HudTab;
  select(tab: HudTab): void;
  /** Follows the selection; `selectionKey` is "" with nothing picked. */
  sync(selectionKey: string, build: boolean): void;
  /** The next selection comes from a group slot. */
  keepTabOnce(): void;
  /** Lights the dot of a tab (e.g. Build while a queue runs). */
  setLit(tab: HudTab, lit: boolean): void;
}

/** Touch, mouse and wheel on the bar never reach the map (spec 41 AC-41-10). */
const ISOLATED = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "touchstart",
  "touchend",
  "wheel",
  "contextmenu",
];

/**
 * `#hud-bar`: the one console of the skirmish (spec 42). It docks to a screen
 * edge and owns the menu button, the status, the tabs and the scrolling row
 * the command and quick panels render into.
 */
export function createHudBar(parent: HTMLElement, storage?: Storage): HudBar {
  const root = appendDiv(parent, "hud-bar");
  root.dataset.tab = "orders";
  for (const type of ISOLATED) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
  root.addEventListener("contextmenu", (event) => event.preventDefault());

  const main = appendDiv(root, "hud-main");
  const top = appendDiv(main, "hud-top");
  const menu = appendDiv(top, "hud-menu");
  const status = appendDiv(top, "hud-status");
  const tabList = appendDiv(top, "hud-tabs");
  tabList.setAttribute("role", "tablist");
  const selection = appendDiv(top, "hud-selection");
  const tools = appendDiv(top, "hud-tools");
  const content = appendDiv(main, "hud-content");
  appendDiv(content, "hud-empty").textContent = t("hud.empty");

  // A mouse wheel only scrolls up and down: the row turns it sideways.
  content.addEventListener(
    "wheel",
    (event) => {
      if (vertical || content.scrollWidth <= content.clientWidth) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      content.scrollLeft += event.deltaY;
      event.preventDefault();
    },
    { passive: false },
  );

  const saved = loadSettings(storage);
  let minimal = saved.hudMinimal === true;
  let vertical = saved.hudVertical === true;

  function tool(id: string, onPress: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = "hud-tool";
    button.addEventListener("click", onPress);
    tools.appendChild(button);
    return button;
  }
  const remember = (): void =>
    saveSettings(
      { ...loadSettings(storage), hudMinimal: minimal, hudVertical: vertical },
      storage,
    );
  const dock = tool("hud-dock", () => {
    vertical = !vertical;
    remember();
    apply();
  });
  const size = tool("hud-size", () => {
    minimal = !minimal;
    remember();
    apply();
  });
  function apply(): void {
    root.dataset.size = minimal ? "min" : "full";
    root.dataset.dock = vertical ? "left" : "bottom";
    document.documentElement.dataset.hudDock = root.dataset.dock;
    dock.setAttribute("aria-pressed", String(vertical));
    const dockLabel = t(vertical ? "hud.dockBottom" : "hud.dockLeft");
    dock.setAttribute("aria-label", dockLabel);
    dock.title = dockLabel;
    size.setAttribute("aria-expanded", String(!minimal));
    const sizeLabel = t(minimal ? "hud.expand" : "hud.minimise");
    size.setAttribute("aria-label", sizeLabel);
    size.title = sizeLabel;
  }
  apply();

  const buttons = new Map<HudTab, HTMLButtonElement>();
  for (const tab of HUD_TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `hud-tab-${tab}`;
    button.className = "hud-tab";
    button.setAttribute("role", "tab");
    button.innerHTML = '<span class="hud-tab-name"></span><i></i>';
    const name = button.querySelector(".hud-tab-name");
    if (name !== null) name.textContent = t(`hud.tab.${tab}`);
    button.addEventListener("click", () => select(tab));
    tabList.appendChild(button);
    buttons.set(tab, button);
  }

  let current: HudTab = "orders";
  let lastKey = "";
  let keep = false;

  function select(tab: HudTab): void {
    current = tab;
    root.dataset.tab = tab;
    content.scrollTo?.(0, 0);
    for (const [id, button] of buttons) {
      button.setAttribute("aria-selected", String(id === tab));
    }
  }
  select(current);

  return {
    menu,
    status,
    selection,
    content,
    tab: () => current,
    select,
    sync(selectionKey, build) {
      const next = autoTab(current, {
        build,
        newSelection: selectionKey !== "" && selectionKey !== lastKey,
        fromGroup: keep,
      });
      lastKey = selectionKey;
      keep = false;
      if (next !== current) select(next);
    },
    keepTabOnce() {
      keep = true;
    },
    setLit(tab, lit) {
      buttons.get(tab)?.classList.toggle("lit", lit);
    },
  };
}
