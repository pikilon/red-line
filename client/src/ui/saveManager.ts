/** The `#save-manager` panel of the game menu (spec 19 §5.5). Every element
 *  is created once; renders only change text, `hidden` and `disabled`, so
 *  the buttons stay clickable with a real mouse. */
import { type MessageKey, t } from "../i18n";
import { gameTime, MAX_NAME_LENGTH, type SlotId } from "../saves/saveFile";
import type { SaveSummary } from "../saves/store";
import { setText } from "./dom";

export type SlotView = SaveSummary | { id: SlotId; empty: true };

/** What one save manager render shows (spec 19 §5.5). */
export interface SaveManagerView {
  open: boolean;
  /** "Save game" or "Load game" (spec 19 §5.5). */
  mode: "save" | "load";
  /** `SLOT_COUNT` entries, ascending slot number. */
  slots: readonly SlotView[];
  /** Example ids in menu order. */
  examples: readonly string[];
  storageAvailable: boolean;
  /** Pre-filled name of a save into an empty slot. */
  defaultName: string;
}

/** Callbacks; dialogs are confirmed before `save`, `load`, `rename` and
 *  `remove` run. */
export interface SaveManagerActions {
  close(): void;
  save(slot: SlotId, name: string): void;
  rename(slot: SlotId, name: string): void;
  /** Navigates to `?load=<id>`. */
  load(id: string): void;
  copy(id: string): void;
  remove(slot: SlotId): void;
}

export interface SaveManager {
  /** `#save-manager`. */
  readonly root: HTMLElement;
  render(view: SaveManagerView): void;
  /** Esc: closes an open dialog, else the panel. False when it is closed. */
  handleEscape(): boolean;
}

/** An open dialog: its text, an optional name and what OK does. */
interface Dialog {
  text: string;
  /** null: a plain confirmation without the name input. */
  name: string | null;
  confirm(name: string): void;
}

interface SlotRow {
  row: HTMLElement;
  name: HTMLElement;
  info: HTMLElement;
  buttons: Record<
    "save" | "load" | "rename" | "copy" | "delete",
    HTMLButtonElement
  >;
}

const isOccupied = (slot: SlotView): slot is SaveSummary => !("empty" in slot);

function child<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  options: { id?: string; className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.id !== undefined) element.id = options.id;
  if (options.className !== undefined) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  parent.appendChild(element);
  return element;
}

function button(
  parent: HTMLElement,
  className: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const element = child(parent, "button", { className, text: label });
  element.addEventListener("click", onClick);
  return element;
}

/** `savedAt` in the player's locale, short date and time. */
function localTime(savedAt: string): string {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime())
    ? savedAt
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

export function createSaveManager(
  parent: HTMLElement,
  actions: SaveManagerActions,
): SaveManager {
  const root = child(parent, "div", { id: "save-manager" });
  root.hidden = true;
  const panel = child(root, "div", { id: "save-manager-panel" });
  const title = child(panel, "h2", { text: t("saves.titleLoad") });
  const close = child(panel, "button", {
    id: "save-manager-close",
    text: t("saves.close"),
  });
  close.addEventListener("click", () => actions.close());

  child(panel, "h3", { text: t("saves.slots") });
  const storage = child(panel, "div", {
    id: "save-manager-storage",
    text: t("saves.storageUnavailable"),
  });
  storage.hidden = true;
  const slotList = child(panel, "div", { id: "save-manager-slots" });
  const examplesSection = child(panel, "div", {
    id: "save-manager-examples-section",
  });
  child(examplesSection, "h3", { text: t("saves.examples") });
  const exampleList = child(examplesSection, "div", {
    id: "save-manager-examples",
  });

  const dialogRoot = child(root, "div", { id: "save-dialog" });
  dialogRoot.hidden = true;
  const dialogText = child(dialogRoot, "div", { id: "save-dialog-text" });
  const nameInput = child(dialogRoot, "input", { id: "save-dialog-name" });
  nameInput.type = "text";
  nameInput.maxLength = MAX_NAME_LENGTH;
  const ok = child(dialogRoot, "button", {
    id: "save-dialog-ok",
    text: t("saves.ok"),
  });
  const cancel = child(dialogRoot, "button", {
    id: "save-dialog-cancel",
    text: t("saves.cancel"),
  });

  let dialog: Dialog | null = null;
  let view: SaveManagerView | null = null;
  const rows = new Map<SlotId, SlotRow>();
  let examplesShown: readonly string[] | null = null;

  function refreshOk(): void {
    const disabled = dialog?.name !== null && nameInput.value.trim() === "";
    if (ok.disabled !== disabled) ok.disabled = disabled;
  }

  function openDialog(next: Dialog): void {
    dialog = next;
    setText(dialogText, next.text);
    nameInput.hidden = next.name === null;
    nameInput.value = next.name ?? "";
    dialogRoot.hidden = false;
    refreshOk();
    if (next.name !== null) {
      nameInput.focus();
      nameInput.select();
    } else {
      ok.focus();
    }
  }

  function closeDialog(): void {
    dialog = null;
    dialogRoot.hidden = true;
  }

  function confirmDialog(): void {
    const active = dialog;
    if (active === null || ok.disabled) return;
    const name = nameInput.value.trim();
    closeDialog();
    active.confirm(name);
  }

  ok.addEventListener("click", confirmDialog);
  cancel.addEventListener("click", closeDialog);
  nameInput.addEventListener("input", refreshOk);
  // Typing a name must not pan the camera, select units or toggle gore: the
  // game's key listeners are on `window`, so no key leaves the input.
  nameInput.addEventListener("keydown", (event) => {
    event.stopPropagation?.();
    const key = (event as KeyboardEvent).key;
    if (key !== "Enter" && key !== "Escape") return;
    event.preventDefault();
    if (key === "Enter") confirmDialog();
    else closeDialog();
  });

  const confirmLoad = (id: string): void =>
    openDialog({
      text: t("saves.confirmLoad"),
      name: null,
      confirm: () => actions.load(id),
    });

  function slotOf(id: SlotId): SlotView | undefined {
    return view?.slots.find((slot) => slot.id === id);
  }

  function createSlotRow(id: SlotId): SlotRow {
    const row = child(slotList, "div", { className: "save-slot" });
    row.dataset.slot = id;
    const name = child(row, "div", { className: "save-slot-name" });
    const info = child(row, "div", { className: "save-slot-info" });
    const occupied = (): SaveSummary | null => {
      const slot = slotOf(id);
      return slot !== undefined && isOccupied(slot) ? slot : null;
    };
    const buttons = {
      save: button(row, "save-slot-save", t("saves.save"), () => {
        const current = occupied();
        openDialog({
          text: t(
            current === null ? "saves.namePrompt" : "saves.confirmOverwrite",
          ),
          name: current?.name ?? view?.defaultName ?? "",
          confirm: (chosen) => actions.save(id, chosen),
        });
      }),
      load: button(row, "save-slot-load", t("saves.load"), () =>
        confirmLoad(id),
      ),
      rename: button(row, "save-slot-rename", t("saves.rename"), () => {
        openDialog({
          text: t("saves.namePrompt"),
          name: occupied()?.name ?? "",
          confirm: (chosen) => actions.rename(id, chosen),
        });
      }),
      copy: button(row, "save-slot-copy", t("saves.copy"), () =>
        actions.copy(id),
      ),
      delete: button(row, "save-slot-delete", t("saves.delete"), () => {
        openDialog({
          text: t("saves.confirmDelete", { name: occupied()?.name ?? "" }),
          name: null,
          confirm: () => actions.remove(id),
        });
      }),
    };
    return { row, name, info, buttons };
  }

  /** Buttons of a row per mode and occupancy (spec 19 §5.5). */
  const SHOWN = {
    save: { occupied: ["save", "rename", "delete"], empty: ["save"] },
    load: { occupied: ["load", "copy", "rename", "delete"], empty: [] },
  } as const;

  function renderSlot(
    slot: SlotView,
    available: boolean,
    mode: SaveManagerView["mode"],
  ): void {
    let row = rows.get(slot.id);
    if (row === undefined) {
      row = createSlotRow(slot.id);
      rows.set(slot.id, row);
    }
    if (row.row.hidden !== !available) row.row.hidden = !available;
    const summary = isOccupied(slot) ? slot : null;
    setText(row.name, summary?.name ?? t("saves.empty"));
    setText(
      row.info,
      summary === null
        ? ""
        : `${summary.mapId} · ${localTime(summary.savedAt)} · ${gameTime(summary.tick)}`,
    );
    const shown: readonly string[] =
      SHOWN[mode][summary === null ? "empty" : "occupied"];
    for (const key of ["save", "load", "rename", "copy", "delete"] as const) {
      const hidden = !shown.includes(key);
      if (row.buttons[key].hidden !== hidden) row.buttons[key].hidden = hidden;
    }
  }

  function renderExamples(ids: readonly string[]): void {
    if (examplesShown !== null) return;
    examplesShown = ids;
    for (const id of ids) {
      const row = child(exampleList, "div", { className: "save-example" });
      row.dataset.example = id;
      child(row, "div", {
        className: "save-example-name",
        text: t(`saves.${id}.name` as MessageKey),
      });
      child(row, "div", {
        className: "save-example-description",
        text: t(`saves.${id}.description` as MessageKey),
      });
      button(row, "save-example-load", t("saves.load"), () => confirmLoad(id));
      button(row, "save-example-copy", t("saves.copy"), () => actions.copy(id));
    }
  }

  return {
    root,
    render(next) {
      view = next;
      if (root.hidden !== !next.open) root.hidden = !next.open;
      if (!next.open && dialog !== null) closeDialog();
      setText(
        title,
        t(next.mode === "save" ? "saves.titleSave" : "saves.titleLoad"),
      );
      const noExamples = next.mode === "save";
      if (examplesSection.hidden !== noExamples) {
        examplesSection.hidden = noExamples;
      }
      if (storage.hidden !== next.storageAvailable)
        storage.hidden = next.storageAvailable;
      for (const slot of next.slots) {
        renderSlot(slot, next.storageAvailable, next.mode);
      }
      renderExamples(next.examples);
    },
    handleEscape() {
      if (root.hidden) return false;
      if (dialog !== null) {
        closeDialog();
        return true;
      }
      actions.close();
      return true;
    },
  };
}
