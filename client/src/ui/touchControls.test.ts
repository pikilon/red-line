import { afterEach, describe, expect, it, vi } from "vitest";
import { createTouchControls } from "./touchControls";

/** Minimal fake DOM (the unit test runs in the node environment). */
interface FakeEvent {
  pointerId: number;
  clientX: number;
  clientY: number;
  stopPropagation(): void;
  preventDefault(): void;
}

interface EventInit {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
}

interface FakeElement {
  tagName: string;
  id: string;
  hidden: boolean;
  textContent: string;
  children: FakeElement[];
  attributes: Map<string, string>;
  classes: Set<string>;
  style: Record<string, string>;
  captured: number[];
  classList: { add(name: string): void; remove(name: string): void };
  appendChild(child: FakeElement): FakeElement;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, handler: (event: FakeEvent) => void): void;
  setPointerCapture(id: number): void;
  releasePointerCapture(id: number): void;
  hasPointerCapture(id: number): boolean;
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  fire(type: string, init?: EventInit): { stopped: boolean };
}

/** The base circle: 120 px at (100, 200), so the centre is (160, 260). */
const CENTER = { x: 160, y: 260 };
const RADIUS = 60;

function fakeElement(tagName = "div"): FakeElement {
  const listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  const node: FakeElement = {
    tagName,
    id: "",
    hidden: false,
    textContent: "",
    children: [],
    attributes: new Map(),
    classes: new Set(),
    style: {},
    captured: [],
    classList: {
      add: (name) => node.classes.add(name),
      remove: (name) => node.classes.delete(name),
    },
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      node.attributes.set(name, value);
    },
    removeAttribute(name) {
      node.attributes.delete(name);
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    setPointerCapture(id) {
      node.captured.push(id);
    },
    releasePointerCapture(id) {
      node.captured = node.captured.filter((value) => value !== id);
    },
    hasPointerCapture: (id) => node.captured.includes(id),
    getBoundingClientRect: () => ({
      left: CENTER.x - RADIUS,
      top: CENTER.y - RADIUS,
      width: RADIUS * 2,
      height: RADIUS * 2,
    }),
    fire(type, init = {}) {
      const result = { stopped: false };
      const event: FakeEvent = {
        pointerId: init.pointerId ?? 1,
        clientX: init.clientX ?? CENTER.x,
        clientY: init.clientY ?? CENTER.y,
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
  vi.stubGlobal("window", { addEventListener: () => {} });
  const parent = fakeElement();
  const toggles = { count: 0 };
  const controls = createTouchControls(parent as unknown as HTMLElement, {
    toggleMenu: () => {
      toggles.count++;
    },
  });
  return { parent, toggles, controls };
}

describe("AC-08-18: touch menu button", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates only the menu button, once", () => {
    const { parent } = setup();
    const root = findById(parent, "touch-controls");
    const menu = findById(root, "touch-menu");
    expect(menu.tagName).toBe("button");
    expect(menu.attributes.get("aria-label")).toBe("Menu");
    expect(tryFind(root, "touch-joystick")).toBeNull();
  });

  it("the menu button toggles the menu once per click", () => {
    const { parent, toggles } = setup();
    findById(parent, "touch-menu").fire("click");
    expect(toggles.count).toBe(1);
  });

  it("control events do not propagate to the map", () => {
    const { parent } = setup();
    for (const type of ["pointerdown", "pointerup", "click"]) {
      expect(findById(parent, "touch-menu").fire(type).stopped).toBe(true);
    }
  });

  it("an open menu is mirrored in aria-expanded", () => {
    const { parent, controls } = setup();
    controls.render({ menuOpen: true });
    expect(findById(parent, "touch-menu").attributes.get("aria-expanded")).toBe(
      "true",
    );
    controls.render({ menuOpen: false });
    expect(findById(parent, "touch-menu").attributes.get("aria-expanded")).toBe(
      "false",
    );
  });
});
