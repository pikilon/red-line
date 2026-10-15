import { expect, type Page, test } from "@playwright/test";

interface SavesDebug {
  isReady(): boolean;
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
  const plain = await page.evaluate(
    () => (window as DebugWindow).__redline?.entities().length ?? 0,
  );
  expect(plain).toBe(10);

  expect(errors).toEqual([]);
});
