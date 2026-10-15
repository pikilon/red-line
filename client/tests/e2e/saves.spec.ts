import { expect, type Page, test } from "@playwright/test";

interface SavesDebug {
  isReady(): boolean;
  tick(): number;
  gore(): boolean;
  selectedIds(): number[];
  setCameraTarget(x: number, y: number): void;
  command(command: unknown): void;
  initialSnapshot(): {
    tick: number;
    entities: { id: number; x: number; y: number }[];
  } | null;
  entities(): {
    id: number;
    owner: number;
    kind: number;
    x: number;
    y: number;
  }[];
  worldToScreen(x: number, y: number): { x: number; y: number };
  typeIndex(id: string): number;
  viewer(): number;
  controlledPlayer(): number;
  cameraTarget(): { x: number; y: number };
  zoom(): number;
  loadedSave(): string | null;
  saveState(): Promise<string>;
}

type DebugWindow = Window & { __redline?: SavesDebug };

const OBSERVER = 255;

/** Collects console errors and page errors of `page`. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 15_000 },
  );
}

test("AC-19-17: example saves and load errors", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);

  // The showcase example: every building and unit of both sides, revealed.
  await page.goto("/?load=showcase");
  await waitReady(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as DebugWindow).__redline?.entities().length ?? 0,
      ),
    )
    .toBe(28);
  const state = await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as SavesDebug;
    return {
      viewer: api.viewer(),
      loaded: api.loadedSave(),
      zoom: api.zoom(),
      camera: api.cameraTarget(),
    };
  });
  expect(state.viewer).toBe(OBSERVER);
  expect(state.loaded).toBe("showcase");
  expect(state.zoom).toBe(1);
  expect(state.camera).toEqual({ x: 18, y: 12 });

  // A real click on the M2 Bradley (unit slot 3 of the Ukrainian rows) names it.
  const bradley = await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as SavesDebug;
    const kind = api.typeIndex("ua-bradley");
    const entity = api.entities().find((entry) => entry.kind === kind);
    return entity === undefined ? null : api.worldToScreen(entity.x, entity.y);
  });
  expect(bradley).not.toBeNull();
  await page.mouse.move((bradley?.x ?? 0) - 40, (bradley?.y ?? 0) - 40);
  await page.mouse.move(bradley?.x ?? 0, (bradley?.y ?? 0) - 4, { steps: 5 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator("#hud-selected-type")).toHaveText("M2 Bradley");

  // The close-up example restores its own camera and zoom.
  await page.goto("/?load=showcase-units");
  await waitReady(page);
  const closeUp = await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as SavesDebug;
    return { zoom: api.zoom(), camera: api.cameraTarget() };
  });
  expect(closeUp).toEqual({ zoom: 2, camera: { x: 13.5, y: 18.5 } });

  // An empty slot shows the load error and runs the default skirmish.
  await page.goto("/?load=slot-9&debug=1");
  await expect(page.locator("#load-error")).toBeVisible();
  await expect(page.locator("#hud-tick")).not.toHaveText("Tick 0", {
    timeout: 15_000,
  });

  // The showcase mode is gone: `?showcase=1` is a plain skirmish.
  await page.goto("/?showcase=1&debug=1&ai=off");
  await waitReady(page);
  await page.waitForTimeout(1000);
  // Fog hides most of the map, so count player 0's own entities: the start
  // HQ and dozer only, no formation.
  const own = await page.evaluate(
    () =>
      (window as DebugWindow).__redline
        ?.entities()
        .filter((entity) => entity.owner === 0).length ?? 0,
  );
  expect(own).toBe(2);

  expect(errors).toEqual([]);
});

interface StoredSave {
  name: string;
  tick: number;
  client: {
    controlled: number;
    gore: boolean;
    camera: { x: number; y: number; zoom: number };
    selected: number[];
  };
  world: { tick: number; entities: { id: number; pos: [number, number] }[] };
}

/** The save in IndexedDB slot `id` (spec 19 §5.2), read inside the page. */
async function readSlot(page: Page, id: string): Promise<StoredSave | null> {
  return page.evaluate(
    (slot) =>
      new Promise<StoredSave | null>((resolve, reject) => {
        const open = indexedDB.open("redline", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("saves", "readonly")
            .objectStore("saves")
            .get(slot);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve((request.result?.save as StoredSave | undefined) ?? null);
          };
        };
      }),
    id,
  );
}

const slot = (page: Page, id: string) =>
  page.locator(`.save-slot[data-slot="${id}"]`);

/** Opens the save manager from the game menu with real clicks. */
async function openSaves(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeVisible();
  await page.locator("#game-menu-saves").click();
  await expect(page.locator("#save-manager")).toBeVisible();
}

/** Saves into `id` with `name` through the dialog. */
async function saveTo(page: Page, id: string, name: string): Promise<void> {
  await slot(page, id).locator(".save-slot-save").click();
  await expect(page.locator("#save-dialog")).toBeVisible();
  await page.locator("#save-dialog-name").fill(name);
  await page.locator("#save-dialog-ok").click();
  await expect(slot(page, id).locator(".save-slot-name")).toHaveText(name);
}

test("AC-19-15: save and load a slot", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto("/?ai=off&debug=1");
  await waitReady(page);

  // A second own unit next to the start dozer, then select both with Ctrl+A.
  await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as SavesDebug;
    api.command({
      kind: "debugSpawn",
      player: 0,
      typeIndex: api.typeIndex("ua-rifleman"),
      xRaw: Math.round(20.5 * 65536),
      yRaw: Math.round(63.5 * 65536),
    });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as DebugWindow).__redline
            ?.entities()
            .filter((e) => e.owner === 0 && e.kind !== 0).length ?? 0,
      ),
    )
    .toBeGreaterThanOrEqual(3);
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  const centre = {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.press("Control+a");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as DebugWindow).__redline?.selectedIds().length ?? 0,
      ),
    )
    .toBe(2);

  // Pan, zoom with the wheel and switch gore off with G.
  await page.evaluate(() =>
    (window as DebugWindow).__redline?.setCameraTarget(25, 64),
  );
  await page.mouse.wheel(0, -300);
  await page.keyboard.press("g");
  await expect
    .poll(() => page.evaluate(() => (window as DebugWindow).__redline?.gore()))
    .toBe(false);

  await openSaves(page);
  await saveTo(page, "slot-1", "Before the river");
  const saved = await readSlot(page, "slot-1");
  expect(saved).not.toBeNull();
  const live = await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as SavesDebug;
    return {
      zoom: api.zoom(),
      camera: api.cameraTarget(),
      selected: api.selectedIds(),
    };
  });
  expect(saved?.client.camera).toEqual({ ...live.camera, zoom: live.zoom });
  expect(saved?.client.gore).toBe(false);
  expect(saved?.client.selected).toEqual(live.selected);
  expect(saved?.tick).toBe(saved?.world.tick);

  // Load warns about the lost progress, then reloads with ?load=slot-1.
  await slot(page, "slot-1").locator(".save-slot-load").click();
  await expect(page.locator("#save-dialog-text")).toHaveText(
    "Unsaved progress in the current match will be lost.",
  );
  await page.locator("#save-dialog-ok").click();
  await page.waitForURL(/\?load=slot-1$/);
  await waitReady(page);

  const restored = await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as SavesDebug;
    return {
      first: api.initialSnapshot(),
      zoom: api.zoom(),
      camera: api.cameraTarget(),
      gore: api.gore(),
      controlled: api.controlledPlayer(),
      selected: api.selectedIds(),
      loaded: api.loadedSave(),
    };
  });
  expect(restored.loaded).toBe("slot-1");
  expect(restored.first?.tick).toBe(saved?.world.tick);
  const positions = (saved?.world.entities ?? []).map((e) => [
    e.id,
    e.pos[0],
    e.pos[1],
  ]);
  const shown = (restored.first?.entities ?? []).map((e) => [
    e.id,
    Math.round(e.x * 65536),
    Math.round(e.y * 65536),
  ]);
  expect(shown).toEqual(
    positions.filter(([id]) => shown.some(([seen]) => seen === id)),
  );
  expect(shown.length).toBeGreaterThanOrEqual(5);
  expect(restored.zoom).toBe(saved?.client.camera.zoom);
  expect(restored.camera.x).toBeCloseTo(saved?.client.camera.x ?? 0, 3);
  expect(restored.camera.y).toBeCloseTo(saved?.client.camera.y ?? 0, 3);
  expect(restored.gore).toBe(false);
  expect(restored.controlled).toBe(0);
  expect(restored.selected).toEqual(saved?.client.selected);
  expect(errors).toEqual([]);
});

test("AC-19-16: overwrite, rename, delete, copy", async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors = collectErrors(page);
  await page.goto("/?ai=off&debug=1");
  await waitReady(page);
  await openSaves(page);
  await saveTo(page, "slot-1", "First");
  const first = await readSlot(page, "slot-1");

  // Let the match run, then overwrite: the dialog shows the old name.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => (window as DebugWindow).__redline?.tick() ?? 0),
    )
    .toBeGreaterThan((first?.tick ?? 0) + 15);
  await openSaves(page);
  await slot(page, "slot-1").locator(".save-slot-save").click();
  await expect(page.locator("#save-dialog-text")).toHaveText(
    "Overwrite this save?",
  );
  await expect(page.locator("#save-dialog-name")).toHaveValue("First");
  await page.locator("#save-dialog-ok").click();
  await expect
    .poll(async () => (await readSlot(page, "slot-1"))?.tick ?? 0)
    .toBeGreaterThan(first?.tick ?? 0);

  // Rename.
  await slot(page, "slot-1").locator(".save-slot-rename").click();
  await page.locator("#save-dialog-name").fill("Renamed");
  await page.locator("#save-dialog-ok").click();
  await expect(slot(page, "slot-1").locator(".save-slot-name")).toHaveText(
    "Renamed",
  );

  // Copy puts the save file on the clipboard.
  await slot(page, "slot-1").locator(".save-slot-copy").click();
  await expect(page.locator("#toast")).toHaveText(
    "Save copied to the clipboard",
  );
  const copied = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  ) as StoredSave;
  const stored = await readSlot(page, "slot-1");
  expect(copied).toEqual(stored);

  // Delete after confirming.
  await slot(page, "slot-1").locator(".save-slot-delete").click();
  await expect(page.locator("#save-dialog-text")).toHaveText(
    "Delete “Renamed”?",
  );
  await page.locator("#save-dialog-ok").click();
  await expect(slot(page, "slot-1").locator(".save-slot-name")).toHaveText(
    "Empty slot",
  );
  expect(await readSlot(page, "slot-1")).toBeNull();
  expect(errors).toEqual([]);
});
