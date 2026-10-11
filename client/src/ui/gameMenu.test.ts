import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameMenu, type GameMenuActions } from "./gameMenu";

/** Minimal fake DOM, same approach as `perfPanel.test.ts`: the unit test runs
 *  in the node environment, so `document` is stubbed. */
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

interface FakeDom {
  element(tagName?: string): FakeElement;
  readonly writes: number;
}

function createFakeDom(): FakeDom {
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

/** The three `<button>` children of the menu panel, in document order. */
function buttonsOf(root: HTMLElement): FakeElement[] {
  const panel = (root as unknown as FakeElement).children[0];
  if (panel === undefined) throw new Error("missing menu panel");
  return panel.children.filter((child) => child.tagName === "button");
}

describe("game menu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-08-04: game menu view", () => {
    const dom = createFakeDom();
    vi.stubGlobal("document", {
      createElement: (tagName: string) => dom.element(tagName),
    });
    const parent = dom.element();
    const actions: GameMenuActions = {
      resume: vi.fn(),
      toggleGore: vi.fn(),
      restart: vi.fn(),
    };
    const menu = createGameMenu(parent as unknown as HTMLElement, actions);
    expect(menu.root.id).toBe("game-menu");
    expect(menu.root.hidden).toBe(true);

    // Three buttons in the §3.1 order.
    let buttons = buttonsOf(menu.root);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Resume",
      "Gore: off",
      "Restart match",
    ]);

    // The first render establishes the view; an equal view does not touch the
    // DOM: same button elements and no text/hidden writes.
    menu.render({ open: true, gore: false });
    expect(menu.root.hidden).toBe(false);
    buttons = buttonsOf(menu.root);
    const writes = dom.writes;
    menu.render({ open: true, gore: false });
    expect(dom.writes).toBe(writes);
    const same = buttonsOf(menu.root);
    expect(same.length).toBe(buttons.length);
    for (let i = 0; i < buttons.length; i++) {
      expect(same[i]).toBe(buttons[i]);
    }

    // The gore label follows the view.
    menu.render({ open: true, gore: true });
    expect(buttonsOf(menu.root)[1]?.textContent).toBe("Gore: on");
    menu.render({ open: true, gore: false });
    expect(buttonsOf(menu.root)[1]?.textContent).toBe("Gore: off");

    // Clicking each button calls its action once.
    buttons = buttonsOf(menu.root);
    buttons[0]?.click();
    buttons[1]?.click();
    buttons[2]?.click();
    expect(actions.resume).toHaveBeenCalledTimes(1);
    expect(actions.toggleGore).toHaveBeenCalledTimes(1);
    expect(actions.restart).toHaveBeenCalledTimes(1);

    // `open: false` sets `hidden`.
    menu.render({ open: false, gore: false });
    expect(menu.root.hidden).toBe(true);
  });
});
