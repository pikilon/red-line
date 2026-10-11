import { expect, type Page, test } from "@playwright/test";

const PAUSE_OVERLAY_TEXT = "Paused — press P to resume";

interface SkirmishPauseDebugView {
  isReady(): boolean;
  tick(): number;
  paused(): boolean;
}

type DebugWindow = Window & { __redline?: SkirmishPauseDebugView };

async function boot(page: Page): Promise<void> {
  await page.goto("/?debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
  );
}

function tick(page: Page): Promise<number> {
  return page.evaluate(() => (window as DebugWindow).__redline?.tick() ?? 0);
}

function paused(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.paused() ?? false,
  );
}

test("AC-08-03: pause in the skirmish", async ({ page }) => {
  await boot(page);
  const overlay = page.locator("#pause-overlay");
  await expect(overlay).toBeHidden();

  await page.keyboard.press("p");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveText(PAUSE_OVERLAY_TEXT);
  await expect.poll(() => paused(page)).toBe(true);

  // Let the worker process the message before sampling the frozen tick.
  await page.waitForTimeout(200);
  const frozen = await tick(page);
  await page.waitForTimeout(1000);
  expect(await tick(page)).toBe(frozen);

  await page.keyboard.press("p");
  await expect(overlay).toBeHidden();
  await expect.poll(() => paused(page)).toBe(false);
  await expect
    .poll(() => tick(page), { timeout: 5000 })
    .toBeGreaterThan(frozen);

  // `Pause` behaves like `P`.
  await page.keyboard.press("Pause");
  await expect(overlay).toBeVisible();
  await expect.poll(() => paused(page)).toBe(true);
  await page.waitForTimeout(200);
  const frozenAgain = await tick(page);
  await page.waitForTimeout(1000);
  expect(await tick(page)).toBe(frozenAgain);

  await page.keyboard.press("Pause");
  await expect(overlay).toBeHidden();
  await expect.poll(() => paused(page)).toBe(false);
  await expect
    .poll(() => tick(page), { timeout: 5000 })
    .toBeGreaterThan(frozenAgain);
});
