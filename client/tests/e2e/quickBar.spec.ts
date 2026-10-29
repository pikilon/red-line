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
  zoom(): number;
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

test("AC-41-08: zoom + / - / slider / reset change the camera zoom", async ({
  page,
}) => {
  await boot(page);
  const zoom = (): Promise<number> =>
    page.evaluate(() => (window as DebugWindow).__redline?.zoom() ?? -1);
  await page.click("#zoom-in");
  expect(await zoom()).toBeCloseTo(1.15, 2);
  await page.click("#zoom-reset");
  expect(await zoom()).toBe(1);
  await page.click("#zoom-out");
  expect(await zoom()).toBeCloseTo(1 / 1.15, 2);
  await page.locator("#zoom-slider").fill("1000");
  expect(await zoom()).toBeCloseTo(3, 2);
  for (let i = 0; i < 3; i++) await page.click("#zoom-in");
  expect(await zoom()).toBeCloseTo(3, 2);
  await page.locator("#zoom-slider").fill("0");
  expect(await zoom()).toBeCloseTo(0.6, 2);
});

test("AC-41-09: the quick and zoom panels fold and stay folded after a reload", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator("#quick-bar-body")).toBeVisible();
  await page.click("#quick-bar-tab");
  await page.click("#zoom-bar-tab");
  await expect(page.locator("#quick-bar-body")).toBeHidden();
  await expect(page.locator("#zoom-bar-body")).toBeHidden();
  await page.reload();
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
  );
  await expect(page.locator("#quick-bar-body")).toBeHidden();
  await expect(page.locator("#zoom-bar-body")).toBeHidden();
  await page.click("#quick-bar-tab");
  await expect(page.locator("#quick-bar-body")).toBeVisible();
});
