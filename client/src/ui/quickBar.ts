import { t } from "../i18n";
import {
  centreOf,
  createControlGroups,
  digitOfKey,
  dominantKind,
  GROUP_DIGITS,
  nextInCycle,
} from "../input/controlGroups";
import { type CameoStore, cameoInitials, gameCameos } from "../render/cameos";
import { typeDef, typeName } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";

/** Taps on a panel never reach the map (spec 41 AC-41-10). */
export function isolate(element: HTMLElement): void {
  for (const type of ["pointerdown", "pointerup", "click", "dblclick"]) {
    element.addEventListener(type, (event) => event.stopPropagation());
  }
  element.addEventListener("contextmenu", (event) => event.preventDefault());
}

type Cameos = Pick<CameoStore, "peek" | "request">;

/** A cameo of the type: its rendered model, with the initials as the fallback
 *  until the picture is ready or when it cannot be drawn (spec 41 §3.5). */
export function cameoFor(
  kind: number,
  cameos: Cameos = gameCameos(),
): HTMLElement {
  const element = document.createElement("span");
  element.className = "cameo";
  const typeId = typeDef(kind).id;
  element.dataset.cameo = typeId;
  const img = document.createElement("img");
  img.alt = "";
  const initials = document.createElement("span");
  initials.className = "ini";
  initials.textContent = cameoInitials(typeId);
  element.append(img, initials);
  const apply = (url: string | null | undefined): void => {
    if (url === undefined || url === null) return;
    if (element.dataset.cameo !== typeId) return;
    img.src = url;
    element.classList.add("has-image");
  };
  const known = cameos.peek(typeId);
  if (known !== undefined) apply(known);
  else void cameos.request(typeId).then(apply);
  return element;
}

export interface QuickBarDeps {
  /** Latest snapshot entities, or none before the match starts. */
  entities(): readonly EntityState[];
  player(): number;
  selected(): ReadonlySet<number>;
  select(ids: readonly number[]): void;
  centre(x: number, y: number): void;
  /** False while a menu covers the game: keys do nothing. */
  active(): boolean;
  folded: boolean;
  onFold(folded: boolean): void;
  now?(): number;
}

export interface QuickBar {
  /** Re-reads the snapshot: drops dead units from groups, updates counts. */
  refresh(): void;
}

const SVG = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" aria-hidden="true">${body}</svg>`;
const ICON_CHEVRON = SVG('<path d="M6 9l6 6 6-6"/>');
const ICON_SET = SVG('<path d="M5 12l5 5 9-10"/>');

/** Production buildings the player owns, grouped by kind (spec 41 §3.2). */
export function structureShortcuts(
  entities: readonly EntityState[],
  player: number,
): { kind: number; ids: number[] }[] {
  const byKind = new Map<number, number[]>();
  for (const entity of entities) {
    if (entity.owner !== player) continue;
    if (
      (entity.flags & (ENTITY_FLAGS.underConstruction | ENTITY_FLAGS.ghost)) !==
      0
    )
      continue;
    const def = typeDef(entity.kind);
    if (def.category !== "building" || def.produces.length === 0) continue;
    const ids = byKind.get(entity.kind) ?? [];
    ids.push(entity.id);
    byKind.set(entity.kind, ids);
  }
  return [...byKind.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([kind, ids]) => ({ kind, ids: ids.sort((a, b) => a - b) }));
}

/** The `#quick-bar` panel: control groups and structure shortcuts. */
export function createQuickBar(
  parent: HTMLElement,
  deps: QuickBarDeps,
): QuickBar {
  const now = deps.now ?? (() => performance.now());
  const groups = createControlGroups();
  let armed = false;
  const cycle = new Map<number, number>();

  const root = document.createElement("div");
  root.id = "quick-bar";
  root.className = "bar-panel";
  isolate(root);

  const head = document.createElement("div");
  head.className = "bar-head";
  const tab = document.createElement("button");
  tab.type = "button";
  tab.id = "quick-bar-tab";
  tab.className = "bar-tab";
  tab.innerHTML = `${ICON_CHEVRON}<span>${t("bar.quick")}</span>`;
  const setButton = document.createElement("button");
  setButton.type = "button";
  setButton.id = "group-set";
  setButton.className = "bar-btn wide";
  setButton.innerHTML = `${ICON_SET}<span>${t("quick.set")}</span>`;
  setButton.title = t("quick.setHint");
  head.append(tab, setButton);

  const body = document.createElement("div");
  body.className = "bar-body";
  body.id = "quick-bar-body";
  const grid = document.createElement("div");
  grid.id = "group-grid";
  const slots = new Map<number, HTMLButtonElement>();
  for (const digit of GROUP_DIGITS) {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "bar-btn slot empty";
    slot.id = `group-${digit}`;
    slot.addEventListener("click", () => pressSlot(digit));
    slots.set(digit, slot);
    grid.appendChild(slot);
  }
  const shortcuts = document.createElement("div");
  shortcuts.id = "structure-shortcuts";
  body.append(grid, shortcuts);
  root.append(head, body);
  parent.appendChild(root);

  function applyFold(folded: boolean): void {
    root.classList.toggle("folded", folded);
    tab.setAttribute("aria-expanded", String(!folded));
    body.hidden = folded;
    setButton.hidden = folded;
  }
  applyFold(deps.folded);
  tab.addEventListener("click", () => {
    const folded = !root.classList.contains("folded");
    applyFold(folded);
    deps.onFold(folded);
  });

  function setArmed(on: boolean): void {
    armed = on;
    setButton.classList.toggle("active", on);
    setButton.setAttribute("aria-pressed", String(on));
  }
  setArmed(false);
  setButton.addEventListener("click", () => setArmed(!armed));

  function ownSelection(): number[] {
    const alive = new Set(
      deps
        .entities()
        .filter((entity) => entity.owner === deps.player())
        .map((entity) => entity.id),
    );
    return [...deps.selected()].filter((id) => alive.has(id));
  }

  function selectGroup(digit: number, mayCentre: boolean): void {
    const ids = groups.get(digit);
    if (ids.length === 0) return;
    const action = groups.press(digit, now());
    deps.select(ids);
    if (action === "centre" && mayCentre) {
      const point = centreOf(ids, deps.entities());
      if (point !== null) deps.centre(point.x, point.y);
    }
  }

  function pressSlot(digit: number): void {
    if (armed) {
      groups.set(digit, ownSelection());
      setArmed(false);
      refresh();
      return;
    }
    selectGroup(digit, true);
  }

  function pressShortcut(kind: number, ids: number[]): void {
    const id = nextInCycle(ids, cycle.get(kind) ?? null);
    if (id === null) return;
    cycle.set(kind, id);
    deps.select([id]);
    const entity = deps.entities().find((row) => row.id === id);
    if (entity !== undefined) deps.centre(entity.x, entity.y);
  }

  window.addEventListener("keydown", (event) => {
    const digit = digitOfKey(event.code);
    if (digit === null || !deps.active()) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.type !== "range" &&
      target.type !== "checkbox"
    )
      return;
    if (event.ctrlKey || event.metaKey) {
      // Not preventable in every browser (Ctrl+1 may still switch tabs).
      event.preventDefault();
      groups.set(digit, ownSelection());
      refresh();
      return;
    }
    if (event.altKey) return;
    event.preventDefault();
    if (event.shiftKey) {
      groups.add(digit, ownSelection());
      refresh();
      return;
    }
    selectGroup(digit, true);
  });

  let shownSignature = "";
  function refresh(): void {
    const entities = deps.entities();
    const alive = new Set(entities.map((entity) => entity.id));
    groups.prune(alive);
    const shortcutList = structureShortcuts(entities, deps.player());
    const signature = JSON.stringify([
      GROUP_DIGITS.map((digit) => {
        const ids = groups.get(digit);
        return [ids.length, dominantKind(ids, entities)];
      }),
      shortcutList.map((entry) => [entry.kind, entry.ids.length]),
    ]);
    if (signature === shownSignature) return;
    shownSignature = signature;
    for (const digit of GROUP_DIGITS) {
      const slot = slots.get(digit);
      if (slot === undefined) continue;
      const ids = groups.get(digit);
      const kind = dominantKind(ids, entities);
      slot.replaceChildren();
      slot.classList.toggle("empty", kind === null);
      const number = document.createElement("span");
      number.className = "num";
      number.textContent = String(digit);
      slot.appendChild(number);
      if (kind !== null) {
        slot.appendChild(cameoFor(kind));
        const count = document.createElement("span");
        count.className = "count";
        count.textContent = String(ids.length);
        slot.appendChild(count);
        slot.setAttribute(
          "aria-label",
          t("quick.group", { digit, count: ids.length }),
        );
      } else {
        slot.setAttribute("aria-label", t("quick.groupEmpty", { digit }));
      }
    }
    shortcuts.replaceChildren();
    for (const entry of shortcutList) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bar-btn shortcut";
      button.dataset.kind = String(entry.kind);
      button.title = typeName(entry.kind);
      button.setAttribute("aria-label", typeName(entry.kind));
      button.appendChild(cameoFor(entry.kind));
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(entry.ids.length);
      button.appendChild(count);
      button.addEventListener("click", () =>
        pressShortcut(entry.kind, entry.ids),
      );
      shortcuts.appendChild(button);
    }
  }
  refresh();
  return { refresh };
}
