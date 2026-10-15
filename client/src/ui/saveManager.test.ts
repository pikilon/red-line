import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlotId } from "../saves/saveFile";
import {
  createSaveManager,
  type SaveManagerActions,
  type SaveManagerView,
} from "./saveManager";

/** Minimal fake DOM (the unit tests run in node), like `gameMenu.test.ts`. */
interface FakeElement {
  tagName: string;
  id: string;
  className: string;
  type: string;
  maxLength: number;
  dataset: Record<string, string>;
  hidden: boolean;
  disabled: boolean;
  value: string;
  textContent: string;
  children: FakeElement[];
  appendChild(child: FakeElement): FakeElement;
  addEventListener(type: string, handler: (event: unknown) => void): void;
  focus(): void;
  select(): void;
  fire(type: string, event?: unknown): void;
  click(): void;
}

function element(tagName: string): FakeElement {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const node: FakeElement = {
    tagName,
    id: "",
    className: "",
    type: "",
    maxLength: -1,
    dataset: {},
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    children: [],
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    focus() {},
    select() {},
    fire(type, event = {}) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
    click() {
      node.fire("click");
    },
  };
  return node;
}

function all(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(all)];
}
const byId = (root: FakeElement, id: string): FakeElement => {
  const found = all(root).find((node) => node.id === id);
  if (found === undefined) throw new Error(`missing #${id}`);
  return found;
};
const byClass = (root: FakeElement, name: string): FakeElement[] =>
  all(root).filter((node) => node.className.split(" ").includes(name));
const slotRow = (root: FakeElement, slot: string): FakeElement => {
  const row = byClass(root, "save-slot").find(
    (node) => node.dataset.slot === slot,
  );
  if (row === undefined) throw new Error(`missing ${slot}`);
  return row;
};
const button = (row: FakeElement, name: string): FakeElement => {
  const found = byClass(row, name)[0];
  if (found === undefined) throw new Error(`missing .${name}`);
  return found;
};

const SLOTS = Array.from({ length: 10 }, (_, i) => `slot-${i + 1}` as SlotId);

function view(open = true): SaveManagerView {
  return {
    open,
    storageAvailable: true,
    defaultName: "first-line 1:15",
    examples: ["showcase", "showcase-units"],
    slots: SLOTS.map((id) =>
      id === "slot-2"
        ? {
            id,
            name: "Second",
            mapId: "first-line",
            savedAt: "2026-10-15T10:00:00.000Z",
            tick: 15 * 75,
          }
        : id === "slot-5"
          ? {
              id,
              name: "Fifth",
              mapId: "showcase",
              savedAt: "2026-10-15T11:00:00.000Z",
              tick: 15 * 3661,
            }
          : { id, empty: true as const },
    ),
  };
}

function setup() {
  vi.stubGlobal("document", { createElement: element });
  const parent = element("div");
  const actions: SaveManagerActions = {
    close: vi.fn(),
    save: vi.fn(),
    rename: vi.fn(),
    load: vi.fn(),
    copy: vi.fn(),
    remove: vi.fn(),
  };
  const manager = createSaveManager(parent as unknown as HTMLElement, actions);
  const root = manager.root as unknown as FakeElement;
  return { manager, root, actions };
}

describe("save manager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-19-13: save manager render", () => {
    const { manager, root, actions } = setup();
    expect(root.id).toBe("save-manager");
    expect(root.hidden).toBe(true);
    manager.render(view());
    expect(root.hidden).toBe(false);

    // Ten slot rows; occupied rows show name, map and game time.
    expect(byClass(root, "save-slot").map((row) => row.dataset.slot)).toEqual(
      SLOTS,
    );
    const second = slotRow(root, "slot-2");
    expect(byClass(second, "save-slot-name")[0]?.textContent).toBe("Second");
    expect(byClass(second, "save-slot-info")[0]?.textContent).toContain(
      "first-line",
    );
    expect(byClass(second, "save-slot-info")[0]?.textContent).toContain("1:15");
    expect(
      byClass(slotRow(root, "slot-5"), "save-slot-info")[0]?.textContent,
    ).toContain("1:01:01");
    const empty = slotRow(root, "slot-1");
    expect(byClass(empty, "save-slot-name")[0]?.textContent).toBe("Empty slot");

    // Empty rows only offer Save; occupied rows offer every action.
    const visible = (row: FakeElement) =>
      ["save", "load", "rename", "copy", "delete"].filter(
        (name) => !button(row, `save-slot-${name}`).hidden,
      );
    expect(visible(empty)).toEqual(["save"]);
    expect(visible(second)).toEqual([
      "save",
      "load",
      "rename",
      "copy",
      "delete",
    ]);

    // Examples in order, with their i18n name.
    const examples = byClass(root, "save-example");
    expect(examples.map((row) => row.dataset.example)).toEqual([
      "showcase",
      "showcase-units",
    ]);
    expect(
      byClass(examples[0] as FakeElement, "save-example-name")[0]?.textContent,
    ).toBe("Showcase");

    // Rendering the same view keeps the same elements.
    const before = all(root);
    manager.render(view());
    const after = all(root);
    expect(after.length).toBe(before.length);
    after.forEach((node, i) => {
      expect(node).toBe(before[i]);
    });

    const dialog = byId(root, "save-dialog");
    const text = byId(root, "save-dialog-text");
    const name = byId(root, "save-dialog-name");
    const ok = byId(root, "save-dialog-ok");
    const cancel = byId(root, "save-dialog-cancel");
    expect(dialog.hidden).toBe(true);

    // Save on an empty slot: name dialog with the default name.
    button(empty, "save-slot-save").click();
    expect(dialog.hidden).toBe(false);
    expect(name.hidden).toBe(false);
    expect(name.value).toBe("first-line 1:15");
    expect(text.textContent).toBe("Name of the save:");
    name.value = "   ";
    name.fire("input");
    expect(ok.disabled).toBe(true);
    name.value = "My base";
    name.fire("input");
    expect(ok.disabled).toBe(false);
    ok.click();
    expect(actions.save).toHaveBeenCalledWith("slot-1", "My base");
    expect(dialog.hidden).toBe(true);

    // Save on an occupied slot asks to overwrite, with the old name.
    button(second, "save-slot-save").click();
    expect(text.textContent).toBe("Overwrite this save?");
    expect(name.value).toBe("Second");
    name.fire("keydown", { key: "Enter", preventDefault: () => {} });
    expect(actions.save).toHaveBeenLastCalledWith("slot-2", "Second");

    // Load asks to confirm the lost progress; Cancel does nothing.
    button(second, "save-slot-load").click();
    expect(text.textContent).toBe(
      "Unsaved progress in the current match will be lost.",
    );
    expect(name.hidden).toBe(true);
    cancel.click();
    expect(actions.load).not.toHaveBeenCalled();
    button(second, "save-slot-load").click();
    ok.click();
    expect(actions.load).toHaveBeenCalledWith("slot-2");

    // Rename and delete.
    button(second, "save-slot-rename").click();
    name.value = "Renamed";
    name.fire("input");
    ok.click();
    expect(actions.rename).toHaveBeenCalledWith("slot-2", "Renamed");
    button(second, "save-slot-delete").click();
    expect(text.textContent).toBe("Delete “Second”?");
    ok.click();
    expect(actions.remove).toHaveBeenCalledWith("slot-2");

    // Copy needs no dialog; examples load after the same confirmation.
    button(second, "save-slot-copy").click();
    expect(actions.copy).toHaveBeenCalledWith("slot-2");
    button(examples[1] as FakeElement, "save-example-load").click();
    ok.click();
    expect(actions.load).toHaveBeenLastCalledWith("showcase-units");
    button(examples[0] as FakeElement, "save-example-copy").click();
    expect(actions.copy).toHaveBeenLastCalledWith("showcase");

    // Esc closes an open dialog first, then the manager.
    button(second, "save-slot-load").click();
    expect(manager.handleEscape()).toBe(true);
    expect(dialog.hidden).toBe(true);
    expect(manager.handleEscape()).toBe(true);
    expect(actions.close).toHaveBeenCalledTimes(1);
    byId(root, "save-manager-close").click();
    expect(actions.close).toHaveBeenCalledTimes(2);

    // Without storage only the examples work.
    manager.render({ ...view(), storageAvailable: false });
    expect(byId(root, "save-manager-storage").hidden).toBe(false);
    expect(byId(root, "save-manager-storage").textContent).toBe(
      "Saved games are unavailable in this browser.",
    );
    expect(byClass(root, "save-slot").every((row) => row.hidden)).toBe(true);

    // Closed: hidden, and Esc is not consumed.
    manager.render(view(false));
    expect(root.hidden).toBe(true);
    expect(manager.handleEscape()).toBe(false);
  });
});
