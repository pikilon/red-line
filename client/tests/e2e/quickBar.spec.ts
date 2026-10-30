import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface EntityView {
  id: number;
  owner: number;
  kind: number;
}

interface DebugView {
  isReady(): boolean;
  entities(): EntityView[];
  typeIndex(id: string): number;
  select(ids: number[]): void;
  selectedIds(): number[];
  cameraTarget(): { x: number; y: number };
  setCameraTarget(x: number, y: number): void;
}

type DebugWindow = Window & { __redline?: DebugView };

async function boot(page: Page): Promise<void> {
  await page.goto("/?map=first-line&debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );
}

function selected(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.selectedIds() ?? [],
  );
}

function ownIds(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const redline = (window as DebugWindow).__redline;
    const kind = redline?.typeIndex("ua-dozer") ?? -1;
    return (
      redline
        ?.entities()
        .filter((e) => e.owner === 0 && e.kind === kind)
        .map((e) => e.id) ?? []
    );
  });
}

test("AC-41-06: Set + slot stores a group; tap and digit reselect it", async ({
  page,
}) => {
  await boot(page);
  const ids = await ownIds(page);
  expect(ids.length).toBeGreaterThan(0);
  await page.evaluate(
    (list) => (window as DebugWindow).__redline?.select(list),
    ids,
  );
  await page.click("#hud-tab-groups");
  await page.click("#group-set");
  await page.click("#group-1");
  await page.evaluate(() => (window as DebugWindow).__redline?.select([]));
  expect(await selected(page)).toEqual([]);
  await page.click("#group-1");
  expect(await selected(page)).toEqual(ids);

  await page.evaluate(() => (window as DebugWindow).__redline?.select([]));
  await page.keyboard.press("Digit1");
  expect(await selected(page)).toEqual(ids);

  // Ctrl+digit stores, Shift+digit adds.
  await page.keyboard.press("Control+Digit2");
  await page.evaluate(() => (window as DebugWindow).__redline?.select([]));
  await page.keyboard.press("Digit2");
  expect(await selected(page)).toEqual(ids);
});

test("AC-41-06: a second tap within 400 ms centres the camera", async ({
  page,
}) => {
  await boot(page);
  const ids = await ownIds(page);
  await page.evaluate(
    (list) => (window as DebugWindow).__redline?.select(list),
    ids,
  );
  await page.keyboard.press("Control+Digit3");
  await page.evaluate(() =>
    (window as DebugWindow).__redline?.setCameraTarget(2, 2),
  );
  // Both taps in one browser turn: on a slow runner two separate Playwright
  // presses can land more than DOUBLE_TAP_MS apart.
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3" }));
    }
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as DebugWindow).__redline?.cameraTarget()),
    )
    .not.toEqual({ x: 2, y: 2 });
});

test("AC-42-06/07/08: the bar folds, docks left and fits a phone", async ({
  page,
}) => {
  await boot(page);
  const bar = page.locator("#hud-bar");
  await page.click("#hud-size");
  await expect(page.locator("#hud-content")).toBeHidden();
  await page.click("#hud-dock");
  await expect(bar).toHaveAttribute("data-dock", "left");
  await page.reload();
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
  );
  await expect(page.locator("#hud-content")).toBeHidden();
  await expect(bar).toHaveAttribute("data-dock", "left");
  await page.click("#hud-size");
  await expect(page.locator("#hud-content")).toBeVisible();
  const column = await bar.boundingBox();
  expect(column?.height).toBeGreaterThan(column?.width ?? 0);
  await page.click("#hud-dock");
  await page.setViewportSize({ width: 844, height: 390 });
  const phone = await bar.boundingBox();
  expect(phone?.height).toBeLessThanOrEqual(110);
});

test("AC-42-09: tapping and dragging the minimap moves the camera", async ({
  page,
}) => {
  await boot(page);
  const camera = (): Promise<{ x: number; y: number } | undefined> =>
    page.evaluate(() => (window as DebugWindow).__redline?.cameraTarget());
  const map = page.locator("#minimap");
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  if (box === null) throw new Error("no minimap box");
  const start = await camera();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await expect.poll(camera).not.toEqual(start);
  const tapped = await camera();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3, {
    steps: 4,
  });
  await page.mouse.up();
  await expect.poll(camera).not.toEqual(tapped);
  await page.click("#hud-size");
  await expect(map).toBeHidden();
});
