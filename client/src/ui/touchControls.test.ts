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
  const windowListeners = new Map<string, Array<() => void>>();
  vi.stubGlobal("document", { createElement: fakeElement });
  vi.stubGlobal("window", {
    addEventListener: (type: string, handler: () => void) => {
      const list = windowListeners.get(type) ?? [];
      list.push(handler);
      windowListeners.set(type, list);
    },
  });
  const parent = fakeElement();
  const pans: Array<[number, number]> = [];
  const toggles = { count: 0 };
  const controls = createTouchControls(parent as unknown as HTMLElement, {
    pan: (x, y) => pans.push([x, y]),
    toggleMenu: () => {
      toggles.count++;
    },
  });
  const knob = findById(parent, "touch-joystick-knob");
  const blur = () => {
    for (const handler of windowListeners.get("blur") ?? []) handler();
  };
  return { parent, pans, toggles, controls, knob, blur };
}

/** A pointer position at an offset from the base centre. */
function at(dx: number, dy: number, pointerId = 1): EventInit {
  return { pointerId, clientX: CENTER.x + dx, clientY: CENTER.y + dy };
}

describe("AC-08-18: touch joystick view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates the joystick, the knob and the menu button once", () => {
    const { parent, knob } = setup();
    const root = findById(parent, "touch-controls");
    const joystick = findById(root, "touch-joystick");
    expect(joystick.attributes.get("aria-label")).toBe("Joystick");
    expect(joystick.children).toContain(knob);
    const menu = findById(root, "touch-menu");
    expect(menu.tagName).toBe("button");
    expect(menu.attributes.get("aria-label")).toBe("Menu");
    expect(tryFind(root, "touch-dpad")).toBeNull();
    expect(tryFind(root, "touch-up")).toBeNull();
  });

  it("pressing the knob captures the pointer and grows the knob", () => {
    const { knob, pans } = setup();
    knob.fire("pointerdown", at(0, 0));
    expect(knob.classes.has("pressed")).toBe(true);
    expect(knob.captured).toEqual([1]);
    expect(pans).toEqual([]);
  });

  it("moving reports the vector proportionally and moves the knob", () => {
    const { knob, pans } = setup();
    knob.fire("pointerdown", at(0, 0));
    knob.fire("pointermove", at(30, 0));
    expect(pans).toEqual([[0.5, 0]]);
    expect(knob.style.transform).toBe("translate(30px, 0px)");
    knob.fire("pointermove", at(0, -30));
    expect(pans[pans.length - 1]).toEqual([0, -0.5]);
    expect(knob.style.transform).toBe("translate(0px, -30px)");
  });

  it("clamps the knob and the vector to the base radius", () => {
    const { knob, pans } = setup();
    knob.fire("pointerdown", at(0, 0));
    knob.fire("pointermove", at(300, 0));
    expect(pans[pans.length - 1]).toEqual([1, 0]);
    expect(knob.style.transform).toBe("translate(60px, 0px)");
    knob.fire("pointermove", at(300, 300));
    const [x, y] = pans[pans.length - 1] ?? [0, 0];
    expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
    expect(x).toBeCloseTo(y, 6);
  });

  it("a press outside the knob but moved later keeps working", () => {
    const { knob, pans } = setup();
    knob.fire("pointerdown", at(24, -24));
    expect(pans[pans.length - 1]?.[0]).toBeCloseTo(0.4, 6);
    expect(pans[pans.length - 1]?.[1]).toBeCloseTo(-0.4, 6);
  });

  it("inside the dead zone it reports (0, 0) and only on change", () => {
    const { knob, pans } = setup();
    knob.fire("pointerdown", at(0, 0));
    knob.fire("pointermove", at(5, 5));
    knob.fire("pointermove", at(8, 0));
    expect(pans).toEqual([]);
    knob.fire("pointermove", at(30, 0));
    knob.fire("pointermove", at(30, 0));
    expect(pans).toEqual([[0.5, 0]]);
    knob.fire("pointermove", at(5, 0));
    expect(pans).toEqual([
      [0.5, 0],
      [0, 0],
    ]);
  });

  it("pointerup resets the knob and reports (0, 0) once", () => {
    const { knob, pans } = setup();
    knob.fire("pointerdown", at(0, 0));
    knob.fire("pointermove", at(40, 0));
    knob.fire("pointerup", at(40, 0));
    expect(pans[pans.length - 1]).toEqual([0, 0]);
    expect(pans).toHaveLength(2);
    expect(knob.classes.has("pressed")).toBe(false);
    expect(knob.style.transform).toBe("translate(0px, 0px)");
    knob.fire("pointerup", at(40, 0));
    knob.fire("pointercancel", at(40, 0));
    expect(pans).toHaveLength(2);
  });

  it("pointercancel and a window blur reset like a release", () => {
    const { knob, pans, blur } = setup();
    knob.fire("pointerdown", at(0, 0));
    knob.fire("pointermove", at(0, 40));
    knob.fire("pointercancel", at(0, 40));
    expect(pans[pans.length - 1]).toEqual([0, 0]);
    expect(knob.classes.has("pressed")).toBe(false);
    knob.fire("pointerdown", at(0, 0));
    knob.fire("pointermove", at(-40, 0));
    blur();
    expect(pans[pans.length - 1]).toEqual([0, 0]);
    expect(knob.classes.has("pressed")).toBe(false);
    expect(knob.style.transform).toBe("translate(0px, 0px)");
  });

  it("a release without a press calls nothing and moves are ignored", () => {
    const { knob, pans } = setup();
    knob.fire("pointerup", at(0, 0));
    knob.fire("pointermove", at(40, 0));
    expect(pans).toEqual([]);
    knob.fire("pointerdown", at(0, 0, 1));
    knob.fire("pointermove", at(40, 0, 2));
    knob.fire("pointerup", at(40, 0, 2));
    expect(pans).toEqual([]);
    expect(knob.classes.has("pressed")).toBe(true);
  });

  it("the menu button toggles the menu once per click", () => {
    const { parent, toggles } = setup();
    findById(parent, "touch-menu").fire("click");
    expect(toggles.count).toBe(1);
  });

  it("control events do not propagate to the map", () => {
    const { parent } = setup();
    for (const type of ["pointerdown", "pointerup", "click"]) {
      expect(findById(parent, "touch-joystick").fire(type).stopped).toBe(true);
      expect(findById(parent, "touch-menu").fire(type).stopped).toBe(true);
    }
  });

  it("an open menu hides the joystick, releases and keeps the menu button", () => {
    const { parent, pans, knob, controls } = setup();
    knob.fire("pointerdown", at(0, 0));
    knob.fire("pointermove", at(60, 0));
    controls.render({ menuOpen: true });
    expect(findById(parent, "touch-joystick").hidden).toBe(true);
    expect(findById(parent, "touch-menu").hidden).toBe(false);
    expect(pans[pans.length - 1]).toEqual([0, 0]);
    expect(knob.classes.has("pressed")).toBe(false);
    controls.render({ menuOpen: false });
    expect(findById(parent, "touch-joystick").hidden).toBe(false);
  });

  it("an equal view writes nothing", () => {
    const { parent, controls } = setup();
    controls.render({ menuOpen: true });
    const joystick = findById(parent, "touch-joystick");
    let writes = 0;
    let hidden = joystick.hidden;
    Object.defineProperty(joystick, "hidden", {
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
