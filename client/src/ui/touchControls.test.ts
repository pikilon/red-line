import { afterEach, describe, expect, it, vi } from "vitest";
import { createTouchControls, type PanDirection } from "./touchControls";

/** Minimal fake DOM (the unit test runs in the node environment). */
interface FakeEvent {
  stopPropagation(): void;
  preventDefault(): void;
}

interface FakeElement {
  tagName: string;
  id: string;
  hidden: boolean;
  textContent: string;
  children: FakeElement[];
  attributes: Map<string, string>;
  appendChild(child: FakeElement): FakeElement;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: (event: FakeEvent) => void): void;
  fire(type: string): { stopped: boolean };
}

function fakeElement(tagName = "div"): FakeElement {
  const listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  const node: FakeElement = {
    tagName,
    id: "",
    hidden: false,
    textContent: "",
    children: [],
    attributes: new Map(),
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      node.attributes.set(name, value);
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    fire(type) {
      const result = { stopped: false };
      const event: FakeEvent = {
        stopPropagation: () => {
          result.stopped = true;
        },
        preventDefault: () => {},
      };
      for (const handler of listeners.get(type) ?? []) handler(event);
      return result;
    },
  };
  return node;
}

function tryFind(root: FakeElement, id: string): FakeElement | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = tryFind(child, id);
    if (found !== null) return found;
  }
  return null;
}

function findById(root: FakeElement, id: string): FakeElement {
  const found = tryFind(root, id);
  if (found === null) throw new Error(`no element #${id}`);
  return found;
}

function setup() {
  vi.stubGlobal("document", { createElement: fakeElement });
  const parent = fakeElement();
  const pans: Array<[PanDirection, boolean]> = [];
  const toggles = { count: 0 };
  const controls = createTouchControls(parent as unknown as HTMLElement, {
    pan: (direction, held) => pans.push([direction, held]),
    toggleMenu: () => {
      toggles.count++;
    },
  });
  return { parent, pans, toggles, controls };
}

describe("AC-08-15: touch controls view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates the five buttons once with i18n aria-labels", () => {
    const { parent } = setup();
    const root = findById(parent, "touch-controls");
    const expected = {
      "touch-up": "Pan up",
      "touch-down": "Pan down",
      "touch-left": "Pan left",
      "touch-right": "Pan right",
      "touch-menu": "Menu",
    };
    for (const [id, label] of Object.entries(expected)) {
      const button = findById(root, id);
      expect(button.tagName).toBe("button");
      expect(button.attributes.get("aria-label")).toBe(label);
    }
    expect(findById(root, "touch-dpad").children).toHaveLength(4);
  });

  it("holding a direction pans until released", () => {
    const { parent, pans } = setup();
    const right = findById(parent, "touch-right");
    right.fire("pointerdown");
    expect(pans).toEqual([["right", true]]);
    right.fire("pointerup");
    expect(pans).toEqual([
      ["right", true],
      ["right", false],
    ]);
  });

  it("pointercancel and pointerleave release a held button, once", () => {
    const { parent, pans } = setup();
    const left = findById(parent, "touch-left");
    left.fire("pointerdown");
    left.fire("pointercancel");
    left.fire("pointerleave");
    left.fire("pointerup");
    expect(pans).toEqual([
      ["left", true],
      ["left", false],
    ]);
    const up = findById(parent, "touch-up");
    up.fire("pointerdown");
    up.fire("pointerleave");
    expect(pans[pans.length - 1]).toEqual(["up", false]);
  });

  it("a release without a press calls nothing", () => {
    const { parent, pans } = setup();
    findById(parent, "touch-down").fire("pointerup");
    findById(parent, "touch-down").fire("pointerleave");
    expect(pans).toEqual([]);
  });

  it("the menu button toggles the menu once per click", () => {
    const { parent, toggles } = setup();
    findById(parent, "touch-menu").fire("click");
    expect(toggles.count).toBe(1);
  });

  it("button events do not propagate to the map", () => {
    const { parent } = setup();
    for (const type of ["pointerdown", "pointerup", "click"]) {
      expect(findById(parent, "touch-right").fire(type).stopped).toBe(true);
      expect(findById(parent, "touch-menu").fire(type).stopped).toBe(true);
    }
  });

  it("an open menu hides the D-pad, releases and keeps the menu button", () => {
    const { parent, pans, controls } = setup();
    findById(parent, "touch-right").fire("pointerdown");
    controls.render({ menuOpen: true });
    expect(findById(parent, "touch-dpad").hidden).toBe(true);
    expect(findById(parent, "touch-menu").hidden).toBe(false);
    expect(pans).toEqual([
      ["right", true],
      ["right", false],
    ]);
    controls.render({ menuOpen: false });
    expect(findById(parent, "touch-dpad").hidden).toBe(false);
  });

  it("an equal view writes nothing", () => {
    const { parent, controls } = setup();
    controls.render({ menuOpen: true });
    const dpad = findById(parent, "touch-dpad");
    let writes = 0;
    let hidden = dpad.hidden;
    Object.defineProperty(dpad, "hidden", {
      get: () => hidden,
      set: (value: boolean) => {
        writes++;
        hidden = value;
      },
    });
    controls.render({ menuOpen: true });
    expect(writes).toBe(0);
  });
});
