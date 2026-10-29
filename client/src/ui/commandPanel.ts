import { t } from "../i18n";
import { type CameoStore, cameoInitials, gameCameos } from "../render/cameos";
import { RULES, typeDef, typeName } from "../rules";
import type { EntityState, QueueState } from "../sim/matchSnapshot";
import { appendDiv } from "./dom";
import { createFoldable } from "./foldable";

/** Snapshot progress is permille and a complete building is exactly full (spec §5.15). */
const PROGRESS_FULL = 1000;
/** A second Sell tap within this window sells (spec 41 §3.1, AC-41-04). */
export const SELL_CONFIRM_MS = 3000;
/** A frame longer than this is a stall (a slow runner, a shader compile), not
 *  time the player had to confirm, so it does not consume the window. */
const SELL_MAX_FRAME_MS = 250;

/** A single construct/produce button offered by the command panel. */
export interface CommandButton {
  /** Type index of the unit/building this button constructs or produces. */
  typeIndex: number;
  /** Player-facing label, e.g. "Power plant (600)". */
  label: string;
  /** Credits required to build or produce this type. */
  cost: number;
  /** Whether the button is currently actionable (affordable, requirements met). */
  enabled: boolean;
  /** Whether the button constructs a building, produces a unit, or (spec 31
   *  block 2) garrisons the selection / evacuates a garrisoned building. */
  action:
    | "construct"
    | "produce"
    | "garrison"
    | "evacuate"
    | "disembark"
    | "dig"
    | "repair"
    | "sell";
  /** Feature index the garrison and evacuate buttons act on; for Sell, the
   *  building's entity id (so a changed selection cancels an armed sale). */
  feature?: number;
  /** Spec 34: vehicle the Unload button empties. */
  carrier?: number;
}

/** One selected type with its count (the selection strip, spec 41 §3.1). */
export interface SelectionChip {
  kind: number;
  count: number;
}

/** The chips of `selected`: one per type, in type order. */
export function selectionChips(
  selected: readonly EntityState[],
): SelectionChip[] {
  const counts = new Map<number, number>();
  for (const entity of selected)
    counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([kind, count]) => ({ kind, count }));
}

/** An armed map-tap mode of the command panel (spec 41 §3.1). */
export type ArmedMode = "force" | "rally" | "dig" | null;

/** What one command panel render shows (spec §6.7). */
export interface PanelInput {
  buttons: CommandButton[];
  queue: QueueState | null;
  placing: number | null;
  /** The selection strip. */
  chips: SelectionChip[];
  /** The selection holds own units: show the Units section. */
  units: boolean;
  /** The selection holds a unit with a weapon; unset counts as true. Without
   *  one (trucks, dozers) Force fire is greyed out. */
  canFire?: boolean;
  /** The selection is one own producer: the Rally point button shows. */
  rally: boolean;
  /** The armed mode that lights its button. */
  armed: ArmedMode;
}

/** True when rendering `b` would show exactly what `a` showed (spec §6.7). */
export function samePanelInput(a: PanelInput, b: PanelInput): boolean {
  if (
    a.placing !== b.placing ||
    a.units !== b.units ||
    a.canFire !== b.canFire ||
    a.rally !== b.rally ||
    a.armed !== b.armed ||
    a.buttons.length !== b.buttons.length ||
    a.chips.length !== b.chips.length ||
    a.chips.some(
      (chip, i) =>
        chip.kind !== b.chips[i]?.kind || chip.count !== b.chips[i]?.count,
    )
  )
    return false;
  const sameButtons = a.buttons.every((button, i) => {
    const other = b.buttons[i];
    return (
      other !== undefined &&
      button.typeIndex === other.typeIndex &&
      button.label === other.label &&
      button.cost === other.cost &&
      button.enabled === other.enabled &&
      button.action === other.action &&
      button.feature === other.feature &&
      button.carrier === other.carrier
    );
  });
  if (!sameButtons) return false;
  if (a.queue === null || b.queue === null) return a.queue === b.queue;
  return (
    a.queue.building === b.queue.building &&
    a.queue.headPermille === b.queue.headPermille &&
    a.queue.items.length === b.queue.items.length &&
    a.queue.items.every((item, i) => item === b.queue?.items[i])
  );
}

/** Arguments for `commandButtons` (spec §6.6). */
export interface CommandPanelArgs {
  /** Own entities currently selected. */
  selected: EntityState[];
  /** All own entities (used to check requirements and completeness). */
  ownEntities: EntityState[];
  /** Available credits. */
  credits: number;
  /** Queue of the selected production building, if any. */
  queue: QueueState | null;
  /** Spec 31 block 2: garrison and evacuate offers for the selection. */
  garrison?: { garrison: number | null; evacuate: number | null };
  /** Spec 34: the selected transport with riders, for the Unload button. */
  disembark?: { carrier: number; riders: number } | null;
  /** Spec 35: the selection holds workers that can dig a trench. */
  dig?: boolean;
  /** Spec 39: the selection holds damaged vehicles with a factory to dock at. */
  repair?: boolean;
}

/** Builds the construct/produce buttons for the current selection (spec §6.6). */
export function commandButtons({
  selected,
  ownEntities,
  credits,
  queue,
  garrison,
  disembark,
  dig,
  repair,
}: CommandPanelArgs): CommandButton[] {
  const buttons = productionButtons({
    selected,
    ownEntities,
    credits,
    queue,
  });
  const extra: CommandButton[] = [];
  const subject = selected.length === 1 ? selected[0] : undefined;
  if (
    subject !== undefined &&
    ownEntities.some((entity) => entity.id === subject.id) &&
    typeDef(subject.kind).category === "building" &&
    isComplete(subject)
  ) {
    const refund = Math.floor(
      (typeDef(subject.kind).cost * RULES.sellRefundPercent) / 100,
    );
    extra.push({
      typeIndex: -1,
      label: t("ui.sell", { refund }),
      cost: 0,
      enabled: true,
      action: "sell",
      feature: subject.id,
    });
  }
  if (garrison?.garrison != null) {
    extra.push(garrisonButton("garrison", garrison.garrison));
  }
  if (garrison?.evacuate != null) {
    extra.push(garrisonButton("evacuate", garrison.evacuate));
  }
  if (dig === true) {
    extra.push({
      typeIndex: -1,
      label: t("ui.dig"),
      cost: 0,
      enabled: true,
      action: "dig",
    });
  }
  if (repair === true) {
    extra.push({
      typeIndex: -1,
      label: t("ui.repairVehicle"),
      cost: 0,
      enabled: true,
      action: "repair",
    });
  }
  if (disembark != null) {
    extra.push({
      typeIndex: -1,
      label: `${t("ui.disembark")} (${disembark.riders})`,
      cost: 0,
      enabled: true,
      action: "disembark",
      carrier: disembark.carrier,
    });
  }
  return [...buttons, ...extra];
}

/** A garrison or evacuate button (spec 31 block 2). */
function garrisonButton(
  action: "garrison" | "evacuate",
  feature: number,
): CommandButton {
  return {
    typeIndex: -1,
    label: t(action === "garrison" ? "ui.garrison" : "ui.evacuate"),
    cost: 0,
    enabled: true,
    action,
    feature,
  };
}

/** The construct/produce buttons of the selection (spec §6.6). */
function productionButtons({
  selected,
  ownEntities,
  credits,
  queue,
}: CommandPanelArgs): CommandButton[] {
  // An enemy entity in the selection gives no buttons.
  const ownIds = new Set(ownEntities.map((entity) => entity.id));
  if (selected.some((entity) => !ownIds.has(entity.id))) return [];
  if (selected.length === 0) return [];

  // A selected unit that can build: use the lowest-id one, action construct.
  let builder: EntityState | null = null;
  for (const entity of selected) {
    const def = typeDef(entity.kind);
    if (def.category !== "unit" || def.builds.length === 0) continue;
    if (builder === null || entity.id < builder.id) builder = entity;
  }
  if (builder !== null) {
    return buildButtons(
      typeDef(builder.kind).builds,
      "construct",
      credits,
      ownEntities,
    );
  }

  // Exactly one complete own building with non-empty produces: action produce.
  const producers = selected.filter((entity) => {
    const def = typeDef(entity.kind);
    return (
      def.category === "building" &&
      def.produces.length > 0 &&
      isComplete(entity)
    );
  });
  if (producers.length === 1) {
    const producer = producers[0];
    if (producer === undefined) return []; // guarded: length is exactly 1
    const queueFull = queue !== null && queue.items.length >= RULES.maxQueue;
    return buildButtons(
      typeDef(producer.kind).produces,
      "produce",
      credits,
      ownEntities,
      queueFull,
    );
  }

  return [];
}

/** Renders the buttons for `targetKinds` (construct or produce). */
function buildButtons(
  targetKinds: readonly number[],
  action: "construct" | "produce",
  credits: number,
  ownEntities: EntityState[],
  queueFull = false,
): CommandButton[] {
  return targetKinds.map((kind) => {
    const def = typeDef(kind);
    const enabled =
      credits >= def.cost &&
      requiresSatisfied(def.requires, ownEntities) &&
      (action !== "produce" || !queueFull);
    return {
      typeIndex: kind,
      label: t("ui.buttonLabel", { name: typeName(kind), cost: def.cost }),
      cost: def.cost,
      enabled,
      action,
    };
  });
}

/** True when every required kind is an own complete building in `ownEntities`. */
function requiresSatisfied(
  requires: readonly number[],
  ownEntities: EntityState[],
): boolean {
  for (const requiredKind of requires) {
    if (
      !ownEntities.some(
        (entity) => entity.kind === requiredKind && isComplete(entity),
      )
    ) {
      return false;
    }
  }
  return true;
}

/** A building is complete when its permille progress reaches the total (spec §5.15). */
export function isComplete(entity: EntityState): boolean {
  return entity.progress >= PROGRESS_FULL;
}

/** Inline icons, 24 x 24, drawn with the current colour (spec 41 §3.5). */
const ICONS = {
  stop: '<rect x="6" y="6" width="12" height="12" fill="currentColor"/>',
  force:
    '<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="currentColor" stroke-width="2"/>',
  screen:
    '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  map: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c4 3 4 15 0 18M12 3c-4 3-4 15 0 18" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  garrison:
    '<path d="M3 11l9-7 9 7v9H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10v7M9 14l3 3 3-3" fill="none" stroke="currentColor" stroke-width="2"/>',
  dig: '<path d="M2 9h6l4 9 4-9h6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="miter"/>',
  repair:
    '<path d="M14 6a4 4 0 0 0-5 5L3 17l4 4 6-6a4 4 0 0 0 5-5l-3 3-3-1-1-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  disembark:
    '<path d="M4 10v10h16V10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 15V3M8 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2"/>',
  evacuate:
    '<path d="M10 4H4v16h6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 12h12M17 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2"/>',
  rally:
    '<path d="M6 21V3" stroke="currentColor" stroke-width="2.5"/><path d="M6 4h13l-3 4 3 4H6z" fill="currentColor"/>',
  sell: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 9c-1-1.500-5-1.500-5.500.500S14 12 14.500 14s-4 2-5.500.500M12 6v12" fill="none" stroke="currentColor" stroke-width="2"/>',
} as const;
type IconName = keyof typeof ICONS;

function iconSvg(name: IconName): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** Handlers the command panel calls (spec 41 §3.1). */
export interface CommandPanelHandlers {
  onConstruct(kind: number): void;
  onProduce(kind: number): void;
  onCancel(): void;
  /** Spec 37: sell the selected complete building (after the second tap). */
  onSell(): void;
  /** Spec 31 block 2: the Garrison button was pressed for `feature`. */
  onGarrison?(feature: number): void;
  /** Spec 31 block 2: the Evacuate button was pressed for `feature`. */
  onEvacuate?(feature: number): void;
  /** Spec 34: the Unload button was pressed for vehicle `carrier`. */
  onDisembark?(carrier: number): void;
  /** Spec 35: the Dig trench button was pressed. */
  onDig?(): void;
  /** Spec 39: the Repair button was pressed. */
  onRepair?(): void;
  /** A disabled offer was pressed; the caller plays the error sound/EVA. */
  onDisabled?(button: CommandButton): void;
  /** Spec 41: stop the selected units. */
  onStop?(): void;
  /** Spec 41: arm or disarm the Force fire map tap. */
  onForceFire?(): void;
  /** Spec 41: arm or disarm the Rally point map tap. */
  onRally?(): void;
  /** Spec 41: select the same unit types on the screen or on the map. */
  onSameType?(scope: "screen" | "map"): void;
  /** Spec 41: a strip chip was tapped; narrow the selection to `kind`. */
  onNarrow?(kind: number): void;
}

/** What the panel needs of the cameo store. */
type Cameos = Pick<CameoStore, "peek" | "request">;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

/** Puts `nodes` in `parent` in order, moving a node only when it is out of
 *  place and dropping the rest (a moved node cancels a click, #138). */
function syncChildren(parent: HTMLElement, nodes: HTMLElement[]): void {
  let previous: HTMLElement | null = null;
  for (const node of nodes) {
    placeAfter(parent, node, previous);
    previous = node;
  }
  const keep = new Set<Node>(nodes);
  for (const child of [...parent.children]) {
    if (!keep.has(child)) child.remove();
  }
}

/**
 * `<div id="command-panel">`: fold tab, selection strip, Units and Structure
 * sections, the build grid of cameo tiles and, for a production building, the
 * `#queue` of cameos (spec 41 §3.1). The panel re-renders when its input
 * changes, so its nodes are reused: replacing them would detach the element
 * under the pointer between frames.
 */
export function createCommandPanel(
  root: HTMLElement,
  handlers: CommandPanelHandlers,
  cameos: Cameos = gameCameos(),
): { render(input: PanelInput): void } {
  const panel = appendDiv(root, "command-panel");
  panel.hidden = true;
  const fold = createFoldable(panel, "command", t("ui.panel.command"));
  const body = el("div", "cb-body");
  panel.appendChild(body);
  const strip = el("div", "strip");
  const unitsRow = el("div", "sec-row");
  const structureRow = el("div", "sec-row");
  const buildGrid = el("div", "build-grid");
  const unitsSec = section("units", t("ui.section.units"), unitsRow);
  const structureSec = section(
    "structure",
    t("ui.section.structure"),
    structureRow,
  );
  const buildSec = section("build", t("ui.section.build"), buildGrid);
  const rowTop = el("div", "cb-row");
  rowTop.append(strip, unitsSec, structureSec);
  body.append(rowTop, buildSec);

  // Taps on the panel never reach the map (AC-41-10).
  for (const type of [
    "pointerdown",
    "pointerup",
    "pointermove",
    "mousedown",
    "mouseup",
    "click",
    "touchstart",
    "touchend",
    "wheel",
    "contextmenu",
  ]) {
    panel.addEventListener(type, (event) => event.stopPropagation());
  }

  /** The buttons by key; each element is created once. */
  const elements = new Map<string, HTMLButtonElement>();
  /** What a button does now; replaced every paint. */
  const actions = new Map<string, () => void>();
  /** The offer behind a tile or action, for the disabled-press sound. */
  const offers = new Map<string, CommandButton>();
  let last: PanelInput | null = null;
  let sellArmed = false;
  let sellTarget: number | undefined;
  let sellFrame: number | null = null;
  let sellElapsedMs = 0;
  let sellFrameAt = 0;

  function disarmSell(): void {
    sellArmed = false;
    if (sellFrame !== null) cancelAnimationFrame(sellFrame);
    sellFrame = null;
  }

  /** Arms the sale and closes it after three seconds of rendered time: a
   *  stalled frame does not count, so a slow runner can still take the second
   *  tap (spec 41 §3.1, AC-41-04). */
  function armSell(): void {
    sellArmed = true;
    sellElapsedMs = 0;
    sellFrameAt = performance.now();
    const tick = (now: number): void => {
      if (!sellArmed) return;
      sellElapsedMs += Math.min(
        Math.max(0, now - sellFrameAt),
        SELL_MAX_FRAME_MS,
      );
      sellFrameAt = now;
      if (sellElapsedMs >= SELL_CONFIRM_MS) {
        disarmSell();
        if (last !== null) paint(last);
        return;
      }
      sellFrame = requestAnimationFrame(tick);
    };
    sellFrame = requestAnimationFrame(tick);
  }

  function section(
    id: string,
    title: string,
    row: HTMLElement,
  ): HTMLDivElement {
    const sec = el("div", "sec");
    sec.dataset.sec = id;
    const heading = el("span", "sec-title");
    heading.textContent = title;
    sec.append(heading, row);
    return sec;
  }

  // A disabled button swallows `click`, but `pointerdown` still reaches the
  // panel: that press becomes the error sound and the insufficient-funds EVA.
  panel.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = target.closest<HTMLButtonElement>(".cmd");
      if (!element?.disabled) return;
      const offer = offers.get(element.dataset.key ?? "");
      if (offer !== undefined) handlers.onDisabled?.(offer);
    },
    true,
  );

  function button(key: string, make: (b: HTMLButtonElement) => void) {
    const existing = elements.get(key);
    if (existing !== undefined) return existing;
    const element = el("button", "cmd");
    element.type = "button";
    element.dataset.key = key;
    make(element);
    element.addEventListener("click", () => actions.get(key)?.());
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (offers.get(key)?.action === "produce") handlers.onCancel();
    });
    elements.set(key, element);
    return element;
  }

  function setCameo(host: HTMLElement, typeId: string): void {
    if (host.dataset.cameo === typeId) return;
    host.dataset.cameo = typeId;
    const img = host.querySelector("img");
    const initials = host.querySelector(".ini");
    if (img === null || initials === null) return;
    initials.textContent = cameoInitials(typeId);
    img.removeAttribute("src");
    host.classList.remove("has-image");
    const apply = (url: string | null | undefined): void => {
      if (url === undefined || url === null) return;
      if (host.dataset.cameo !== typeId) return;
      img.src = url;
      host.classList.add("has-image");
    };
    const known = cameos.peek(typeId);
    if (known !== undefined) apply(known);
    else void cameos.request(typeId).then(apply);
  }

  function cameoBox(): HTMLSpanElement {
    const box = el("span", "cameo");
    const img = el("img", "");
    img.alt = "";
    img.draggable = false;
    box.append(img, el("span", "ini"));
    return box;
  }

  function actionButton(
    key: string,
    icon: IconName,
    label: string,
    run: () => void,
    lit = false,
    enabled = true,
  ): HTMLButtonElement {
    const element = button(key, (b) => {
      b.classList.add("act");
      b.dataset.type = key;
      b.innerHTML = `${iconSvg(icon)}<span class="lbl"></span>`;
    });
    const text = element.querySelector(".lbl");
    if (text !== null && text.textContent !== label) text.textContent = label;
    if (element.title !== label) element.title = label;
    element.setAttribute("aria-label", label);
    element.disabled = !enabled;
    element.classList.toggle("active", lit);
    element.setAttribute("aria-pressed", String(lit));
    actions.set(key, run);
    return element;
  }

  function tile(
    b: CommandButton,
    placing: number | null,
    queue: QueueState | null,
  ): HTMLButtonElement {
    const key = `${b.action}:${b.typeIndex}`;
    const def = RULES.types[b.typeIndex];
    const element = button(key, (e) => {
      e.classList.add("tile");
      const box = cameoBox();
      const steps = el("span", "qs");
      const minus = el("span", "qm");
      minus.textContent = "−";
      const plus = el("span", "qp");
      plus.textContent = "+";
      steps.append(minus, el("span", "qn"), plus);
      for (const [step, run] of [
        [minus, () => handlers.onCancel()],
        [plus, () => actions.get(e.dataset.key ?? "")?.()],
      ] as const) {
        step.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!step.classList.contains("off")) run();
        });
      }
      box.append(el("span", "wipe"), steps);
      e.append(box, el("span", "name"), el("span", "cost"));
    });
    element.dataset.type = def?.id ?? String(b.typeIndex);
    const nameEl = element.querySelector(".name");
    if (nameEl !== null && nameEl.textContent !== typeName(b.typeIndex))
      nameEl.textContent = typeName(b.typeIndex);
    paintTileQueue(element, b, queue);
    const costText = String(b.cost);
    const cost = element.querySelector(".cost");
    if (cost !== null && cost.textContent !== costText)
      cost.textContent = costText;
    if (element.title !== b.label) element.title = b.label;
    element.setAttribute("aria-label", b.label);
    const box = element.querySelector<HTMLElement>(".cameo");
    if (box !== null && def !== undefined) setCameo(box, def.id);
    element.disabled = !b.enabled;
    element.classList.toggle("short", !b.enabled && b.cost > 0);
    const active = b.action === "construct" && b.typeIndex === placing;
    element.classList.toggle("active", active);
    element.setAttribute("aria-pressed", String(active));
    offers.set(key, b);
    actions.set(key, () => {
      if (b.action === "construct") handlers.onConstruct(b.typeIndex);
      else handlers.onProduce(b.typeIndex);
    });
    return element;
  }

  function chip(c: SelectionChip): HTMLButtonElement {
    const key = `chip:${c.kind}`;
    const def = RULES.types[c.kind];
    const element = button(key, (e) => {
      e.classList.add("chip");
      e.append(cameoBox(), el("span", "count"));
    });
    element.dataset.type = def?.id ?? String(c.kind);
    const label = `${typeName(c.kind)} x${c.count}`;
    if (element.title !== label) element.title = label;
    element.setAttribute("aria-label", label);
    const count = element.querySelector(".count");
    if (count !== null && count.textContent !== String(c.count))
      count.textContent = String(c.count);
    const box = element.querySelector<HTMLElement>(".cameo");
    if (box !== null && def !== undefined) setCameo(box, def.id);
    actions.set(key, () => handlers.onNarrow?.(c.kind));
    return element;
  }

  /**
   * Queue state lives on the tile of the type being built: a number badge for
   * how many of that type are queued and a clock wipe over the cameo while the
   * head item is of that type.
   */
  function paintTileQueue(
    element: HTMLElement,
    b: CommandButton,
    queue: QueueState | null,
  ): void {
    const queued =
      b.action === "produce" && queue !== null
        ? queue.items.filter((kind) => kind === b.typeIndex).length
        : 0;
    const head = queued > 0 && queue?.items[0] === b.typeIndex;
    const badge = element.querySelector<HTMLElement>(".qn");
    if (badge !== null) {
      const text = queued > 0 ? String(queued) : "";
      if (badge.textContent !== text) badge.textContent = text;
      badge.hidden = queued === 0;
    }
    const steps = element.querySelector<HTMLElement>(".qs");
    if (steps !== null) steps.hidden = queued === 0;
    // A cancel removes the last queued item, so "−" works on its own type.
    element
      .querySelector(".qm")
      ?.classList.toggle("off", queue?.items.at(-1) !== b.typeIndex);
    element.classList.toggle("building", head);
    const wipe =
      head && queue ? `${(queue.headPermille * 360) / 1000}deg` : "0deg";
    if (element.style.getPropertyValue("--p") !== wipe)
      element.style.setProperty("--p", wipe);
  }

  function paint(input: PanelInput): void {
    const { buttons } = input;
    const has = (action: CommandButton["action"]) =>
      buttons.find((b) => b.action === action);
    const sell = has("sell");
    // The armed sale belongs to one building: another selection starts over.
    if (sell === undefined || sell.feature !== sellTarget) disarmSell();
    sellTarget = sell?.feature;
    const garrison = has("garrison");
    const dig = has("dig");
    const repair = has("repair");
    const evacuate = has("evacuate");
    const disembark = has("disembark");
    actions.clear();
    offers.clear();

    // Selection strip.
    syncChildren(strip, input.chips.map(chip));
    strip.hidden = input.chips.length === 0;

    // Units section.
    const unitRows: HTMLElement[] = [];
    if (input.units) {
      unitRows.push(
        actionButton("stop", "stop", t("ui.stop"), () => handlers.onStop?.()),
        actionButton(
          "force-fire",
          "force",
          t("ui.forceFire"),
          () => handlers.onForceFire?.(),
          input.armed === "force",
          input.canFire !== false,
        ),
        actionButton("same-screen", "screen", t("ui.sameScreen"), () =>
          handlers.onSameType?.("screen"),
        ),
        actionButton("same-map", "map", t("ui.sameMap"), () =>
          handlers.onSameType?.("map"),
        ),
      );
    }
    if (garrison !== undefined) {
      unitRows.push(
        actionButton("garrison", "garrison", garrison.label, () =>
          handlers.onGarrison?.(garrison.feature ?? -1),
        ),
      );
    }
    if (dig !== undefined) {
      unitRows.push(
        actionButton(
          "dig",
          "dig",
          dig.label,
          () => handlers.onDig?.(),
          input.armed === "dig",
        ),
      );
    }
    if (repair !== undefined) {
      unitRows.push(
        actionButton("repair", "repair", repair.label, () =>
          handlers.onRepair?.(),
        ),
      );
    }
    syncChildren(unitsRow, unitRows);
    unitsSec.hidden = unitRows.length === 0;

    // Structure section.
    const structureRows: HTMLElement[] = [];
    if (input.rally) {
      structureRows.push(
        actionButton(
          "rally",
          "rally",
          t("ui.rally"),
          () => handlers.onRally?.(),
          input.armed === "rally",
        ),
      );
    }
    if (sell !== undefined) {
      const refund = sell.label.replace(/\D+/g, "");
      const label = sellArmed ? t("ui.sellConfirm", { refund }) : sell.label;
      const element = actionButton("sell", "sell", label, () => {
        if (!sellArmed) {
          armSell();
          if (last !== null) paint(last);
          return;
        }
        disarmSell();
        if (last !== null) paint(last);
        handlers.onSell();
      });
      element.classList.toggle("danger", sellArmed);
      structureRows.push(element);
    }
    if (evacuate !== undefined) {
      structureRows.push(
        actionButton("evacuate", "evacuate", evacuate.label, () =>
          handlers.onEvacuate?.(evacuate.feature ?? -1),
        ),
      );
    }
    if (disembark !== undefined) {
      structureRows.push(
        actionButton("disembark", "disembark", disembark.label, () =>
          handlers.onDisembark?.(disembark.carrier ?? -1),
        ),
      );
    }
    syncChildren(structureRow, structureRows);
    structureSec.hidden = structureRows.length === 0;

    // Build grid.
    const tiles = buttons
      .filter((b) => b.action === "construct" || b.action === "produce")
      .map((b) => tile(b, input.placing, input.queue));
    syncChildren(buildGrid, tiles);
    buildSec.hidden = tiles.length === 0;

    fold.setLit(input.queue !== null && input.queue.items.length > 0);
    panel.hidden =
      input.chips.length === 0 && buttons.length === 0 && input.queue === null;
  }

  return {
    render(input) {
      last = input;
      paint(input);
    },
  };
}

/** Puts `node` right after `previous` (first when null) in `parent`, moving it
 *  only when it is not already there: moving a node detaches it, which cancels
 *  a click whose press started before the move (#138). */
function placeAfter(
  parent: HTMLElement,
  node: HTMLElement,
  previous: HTMLElement | null,
): void {
  const reference =
    previous === null ? parent.firstChild : previous.nextSibling;
  if (node === reference) return;
  parent.insertBefore(node, reference);
}
