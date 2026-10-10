import { t } from "../i18n";
import { RULES, typeDef, typeName } from "../rules";
import type { EntityState, QueueState } from "../sim/matchSnapshot";
import { appendDiv } from "./dom";

/** Snapshot progress is permille and a complete building is exactly full (spec §5.15). */
const PROGRESS_FULL = 1000;
/** Queue progress bar maximum (spec §6.6). */
const QUEUE_PROGRESS_MAX = 1000;

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
  /** Whether the button constructs a building or produces a unit. */
  action: "construct" | "produce";
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
}

/** Builds the construct/produce buttons for the current selection (spec §6.6). */
export function commandButtons({
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
function isComplete(entity: EntityState): boolean {
  return entity.progress >= PROGRESS_FULL;
}

/** `#queue` view of one production building; items and progress update in place. */
interface QueueView {
  container: HTMLDivElement;
  items: HTMLSpanElement[];
  progress: HTMLProgressElement;
}

/** `<div id="command-panel">` with one `.cmd` button per offer and, for a
 *  production building, `<div id="queue">` (spec §6.6). The panel re-renders
 *  every frame, so its nodes are reused: replacing them would detach the
 *  element under the pointer between frames. */
export function createCommandPanel(
  root: HTMLElement,
  handlers: {
    onConstruct(kind: number): void;
    onProduce(kind: number): void;
    onCancel(): void;
  },
): { render(buttons: CommandButton[], queue: QueueState | null): void } {
  const panel = appendDiv(root, "command-panel");
  const elements: HTMLButtonElement[] = [];
  let rendered: CommandButton[] = [];
  let queueView: QueueView | null = null;

  function buttonAt(index: number): HTMLButtonElement {
    const existing = elements[index];
    if (existing !== undefined) return existing;
    const element = document.createElement("button");
    element.className = "cmd";
    element.addEventListener("click", () => {
      const button = rendered[index];
      if (button === undefined) return;
      if (button.action === "construct") handlers.onConstruct(button.typeIndex);
      else handlers.onProduce(button.typeIndex);
    });
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (rendered[index]?.action === "produce") handlers.onCancel();
    });
    elements[index] = element;
    return element;
  }

  function updateQueue(queue: QueueState): QueueView {
    queueView ??= createQueueView();
    const view = queueView;
    for (let i = 0; i < queue.items.length; i++) {
      let item = view.items[i];
      if (item === undefined) {
        item = document.createElement("span");
        item.className = "queue-item";
        view.items[i] = item;
      }
      const kind = queue.items[i] ?? -1;
      item.dataset.type = RULES.types[kind]?.id ?? String(kind);
      view.container.insertBefore(item, view.progress);
    }
    while (view.items.length > queue.items.length) view.items.pop()?.remove();
    view.progress.value = queue.headPermille;
    return view;
  }

  return {
    render(buttons, queue) {
      rendered = buttons;
      for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        if (button === undefined) continue;
        const element = buttonAt(i);
        const def = RULES.types[button.typeIndex];
        element.dataset.type = def?.id ?? String(button.typeIndex);
        element.textContent = button.label;
        element.disabled = !button.enabled;
        panel.insertBefore(element, queueView?.container ?? null);
      }
      while (elements.length > buttons.length) elements.pop()?.remove();
      if (queue === null) {
        queueView?.container.remove();
        queueView = null;
        return;
      }
      const view = updateQueue(queue);
      if (view.container.parentNode !== panel)
        panel.appendChild(view.container);
    },
  };
}

function createQueueView(): QueueView {
  const container = appendDiv(document.createElement("div"), "queue");
  const progress = document.createElement("progress");
  progress.id = "queue-progress";
  progress.max = QUEUE_PROGRESS_MAX;
  container.appendChild(progress);
  return { container, items: [], progress };
}
