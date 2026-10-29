import { describe, expect, it, vi } from "vitest";

import { createCameoStore, type IdleScheduler } from "./cameos";

function manualIdle(): { queue: (() => void)[]; idle: IdleScheduler } {
  const queue: (() => void)[] = [];
  return { queue, idle: (run) => queue.push(run) };
}

describe("cameo store", () => {
  it("waits for idle, then caches and shares one render", async () => {
    const { queue, idle } = manualIdle();
    const rasterize = vi.fn(async (typeId: string) => `url:${typeId}`);
    const store = createCameoStore(rasterize, idle);

    const first = store.request("ua-barracks");
    expect(store.request("ua-barracks")).toBe(first);
    await Promise.resolve();
    expect(rasterize).not.toHaveBeenCalled();
    expect(queue).toHaveLength(1);

    queue.shift()?.();
    await expect(first).resolves.toBe("url:ua-barracks");
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(store.peek("ua-barracks")).toBe("url:ua-barracks");
  });

  it("renders one cameo per idle callback", async () => {
    const { queue, idle } = manualIdle();
    const rasterize = vi.fn(async (typeId: string) => typeId);
    const store = createCameoStore(rasterize, idle);

    const first = store.request("a");
    const second = store.request("b");
    await Promise.resolve();
    expect(queue).toHaveLength(1);

    queue.shift()?.();
    await expect(first).resolves.toBe("a");
    await Promise.resolve();
    expect(queue).toHaveLength(1);
    expect(rasterize.mock.calls).toEqual([["a"]]);

    queue.shift()?.();
    await expect(second).resolves.toBe("b");
    expect(rasterize.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("caches a failed render as no picture", async () => {
    const { queue, idle } = manualIdle();
    const rasterize = vi.fn(async () => {
      throw new Error("no model");
    });
    const store = createCameoStore(rasterize, idle);

    const first = store.request("missing");
    await Promise.resolve();
    queue.shift()?.();
    await expect(first).resolves.toBeNull();
    expect(store.peek("missing")).toBeNull();
    expect(store.request("missing")).toBe(first);
    expect(queue).toHaveLength(0);
  });
});
