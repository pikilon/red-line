import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameMenu, type GameMenuActions } from "./gameMenu";

/** Minimal fake DOM, same approach as `gameMenu.test.ts`. */
interface FakeElement {
  tagName: string;
  id: string;
  hidden: boolean;
  textContent: string;
  children: FakeElement[];
  appendChild(child: FakeElement): FakeElement;
  addEventListener(type: string, handler: () => void): void;
  click(): void;
}

function createFakeDom(): {
  element(tagName?: string): FakeElement;
  readonly writes: number;
} {
  const stats = { writes: 0 };
  function element(tagName = "div"): FakeElement {
    let hidden = false;
    let text = "";
    const listeners: Array<() => void> = [];
    const node = {
      tagName,
      id: "",
      children: [] as FakeElement[],
      appendChild(child: FakeElement): FakeElement {
        stats.writes++;
        node.children.push(child);
        return child;
      },
      addEventListener(type: string, handler: () => void): void {
        if (type === "click") listeners.push(handler);
      },
      click(): void {
        for (const handler of listeners) handler();
      },
    };
    Object.defineProperty(node, "hidden", {
      get: () => hidden,
      set: (value: boolean) => {
        stats.writes++;
        hidden = value;
      },
    });
    Object.defineProperty(node, "textContent", {
      get: () => text,
      set: (value: string) => {
        stats.writes++;
        text = value;
      },
    });
    return node as unknown as FakeElement;
  }
  return {
    element,
    get writes() {
      return stats.writes;
    },
  };
}

function buttonsOf(root: HTMLElement): FakeElement[] {
  const panel = (root as unknown as FakeElement).children[0];
  if (panel === undefined) throw new Error("missing menu panel");
  return panel.children.filter((child) => child.tagName === "button");
}

function labels(root: HTMLElement): (string | undefined)[] {
  return buttonsOf(root).map((button) => button.textContent);
}

describe("game menu debug buttons", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-08-12: debug buttons in the menu view", () => {
    const dom = createFakeDom();
    vi.stubGlobal("document", {
      createElement: (tagName: string) => dom.element(tagName),
    });
    const actions: GameMenuActions = {
      resume: vi.fn(),
      toggleGore: vi.fn(),
      toggleAi: vi.fn(),
      toggleTextures: vi.fn(),
      switchSide: vi.fn(),
      toggleReveal: vi.fn(),
      toggleFpsPanel: vi.fn(),
      restart: vi.fn(),
    };
    const menu = createGameMenu(
      dom.element() as unknown as HTMLElement,
      actions,
    );

    expect(labels(menu.root)).toEqual([
      "Resume",
      "Gore: off",
      "AI: on",
      "Textures: procedural",
      "Switch side",
      "Reveal map: off",
      "FPS panel: off",
      "Restart match",
    ]);

    menu.render({ open: true, gore: false, ai: true });
    const writes = dom.writes;
    menu.render({ open: true, gore: false, ai: true });
    expect(dom.writes).toBe(writes);

    menu.render({
      open: true,
      gore: false,
      ai: true,
      revealed: true,
      fpsPanel: true,
    });
    expect(labels(menu.root).slice(4, 7)).toEqual([
      "Switch side",
      "Reveal map: on",
      "FPS panel: on",
    ]);

    const buttons = buttonsOf(menu.root);
    for (const button of buttons.slice(4, 7)) button.click();
    expect(actions.switchSide).toHaveBeenCalledTimes(1);
    expect(actions.toggleReveal).toHaveBeenCalledTimes(1);
    expect(actions.toggleFpsPanel).toHaveBeenCalledTimes(1);

    // Without the actions the buttons do not exist.
    const plain = createGameMenu(dom.element() as unknown as HTMLElement, {
      resume: vi.fn(),
      toggleGore: vi.fn(),
      toggleAi: vi.fn(),
      restart: vi.fn(),
    });
    expect(labels(plain.root)).toEqual([
      "Resume",
      "Gore: off",
      "AI: on",
      "Restart match",
    ]);
  });
});
