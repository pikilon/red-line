import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SaveFile } from "./saveFile";
import { createMemorySaveStore } from "./store";

const world = JSON.parse(
  readFileSync(new URL("./fixtures/world.json", import.meta.url), "utf8"),
) as SaveFile;

const save = (name: string, tick: number): SaveFile => ({
  ...world,
  name,
  tick,
});

describe("save store", () => {
  it("AC-19-11: memory store", async () => {
    const store = createMemorySaveStore();
    expect(await store.list()).toEqual([]);
    expect(await store.get("slot-1")).toBeNull();

    await store.put("slot-3", save("Third", 300));
    await store.put("slot-1", save("First", 100));
    expect(await store.list()).toEqual([
      {
        id: "slot-1",
        name: "First",
        mapId: "first-line",
        savedAt: world.savedAt,
        tick: 100,
      },
      {
        id: "slot-3",
        name: "Third",
        mapId: "first-line",
        savedAt: world.savedAt,
        tick: 300,
      },
    ]);

    await store.rename("slot-3", "  Renamed ");
    expect(await store.get("slot-3")).toEqual({
      ...save("Third", 300),
      name: "Renamed",
    });

    await store.put("slot-1", save("Overwritten", 150));
    expect((await store.get("slot-1"))?.name).toBe("Overwritten");

    await store.remove("slot-1");
    expect(await store.get("slot-1")).toBeNull();
    expect((await store.list()).map((summary) => summary.id)).toEqual([
      "slot-3",
    ]);

    // Stored saves are copies: changing one after `put` does not change the store.
    const original = save("Copy", 1);
    await store.put("slot-2", original);
    original.name = "Changed";
    expect((await store.get("slot-2"))?.name).toBe("Copy");
  });
});
