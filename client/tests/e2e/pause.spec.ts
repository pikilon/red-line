import { expect, type Page, test } from "@playwright/test";

interface Point {
  x: number;
  y: number;
}

interface EntityView {
  id: number;
  owner: number;
  kind: number;
  x: number;
  y: number;
}

interface SkirmishMenuDebugView {
  isReady(): boolean;
  tick(): number;
  paused(): boolean;
  menuOpen(): boolean;
  gore(): boolean;
  aiActive(): boolean | null;
  typeIndex(id: string): number;
  entities(): EntityView[];
  worldToScreen(x: number, y: number): Point;
}

type DebugWindow = Window & { __redline?: SkirmishMenuDebugView };

async function boot(page: Page, query = "?debug=1&seed=1&ai=off"): Promise<void> {
  await page.goto(`/${query}`);
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

function menuOpen(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.menuOpen() ?? false,
  );
}

function gore(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.gore() ?? false,
  );
}

function aiActive(page: Page): Promise<boolean | null> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.aiActive() ?? null,
  );
}

/** The first own entity of a type id, or null. */
function entityOf(page: Page, typeId: string): Promise<EntityView | null> {
  return page.evaluate((id: string) => {
    const api = (window as DebugWindow).__redline;
    if (api === undefined) return null;
    const kind = api.typeIndex(id);
    return (
      api
        .entities()
        .find((entity) => entity.owner === 0 && entity.kind === kind) ?? null
    );
  }, typeId);
}

/** Left click on the page position of a tile point. */
async function clickTiles(page: Page, x: number, y: number): Promise<void> {
  const point = await page.evaluate(
    (tiles: Point) =>
      (window as DebugWindow).__redline?.worldToScreen(tiles.x, tiles.y) ?? {
        x: 0,
        y: 0,
      },
    { x, y },
  );
  await page.mouse.click(point.x, point.y);
}

test("AC-08-03: game menu in the skirmish", async ({ page }) => {
  // Many real-mouse steps; CI's software WebGL needs more than the default 30 s.
  test.setTimeout(60_000);
  await boot(page);
  const menu = page.locator("#game-menu");
  const goreButton = page.locator("#game-menu button", { hasText: "Gore" });
  await expect(menu).toBeHidden();

  // Esc opens the menu and pauses.
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  await expect.poll(() => paused(page)).toBe(true);
  await expect.poll(() => menuOpen(page)).toBe(true);

  // Let the worker process the message before sampling the frozen tick.
  await page.waitForTimeout(200);
  const frozen = await tick(page);
  await page.waitForTimeout(1000);
  expect(await tick(page)).toBe(frozen);

  // A real mouse click on Resume closes the menu and resumes.
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => paused(page)).toBe(false);
  await expect.poll(() => menuOpen(page)).toBe(false);
  await expect
    .poll(() => tick(page), { timeout: 5000 })
    .toBeGreaterThan(frozen);

  // Esc twice opens and closes it.
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // The gore button toggles the setting and its label.
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  const goreOn = await gore(page);
  await expect(goreButton).toHaveText(goreOn ? "Gore: on" : "Gore: off");
  await goreButton.click();
  await expect.poll(() => gore(page)).toBe(!goreOn);
  await expect(goreButton).toHaveText(!goreOn ? "Gore: on" : "Gore: off");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Neither P nor Pause pauses anymore.
  await page.keyboard.press("p");
  await page.keyboard.press("Pause");
  await expect(menu).toBeHidden();
  await expect.poll(() => paused(page)).toBe(false);
  await expect.poll(() => menuOpen(page)).toBe(false);

  // With a placement mode active Esc cancels it and leaves the menu closed.
  const dozer = await entityOf(page, "ua-dozer");
  if (dozer === null) throw new Error("missing ua-dozer");
  await clickTiles(page, dozer.x, dozer.y);
  const plantButton = page.locator(
    '#command-panel button[data-type="ua-power-plant"]',
  );
  await expect(plantButton).toBeEnabled();
  await plantButton.click();
  const hint = page.locator("#placement-hint");
  await expect(hint).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(hint).toBeHidden();
  await expect(menu).toBeHidden();
  await expect.poll(() => paused(page)).toBe(false);
});

test("AC-08-07: AI toggle in the skirmish", async ({ page }) => {
  await boot(page, "?debug=1&seed=1");
  expect(await aiActive(page)).toBe(true);
  const aiButton = page.locator("#game-menu-ai");

  // A real mouse click toggles the AI off and back on.
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeVisible();
  await expect(aiButton).toHaveText("AI: on");
  await page.getByRole("button", { name: "AI: on" }).click();
  await expect(aiButton).toHaveText("AI: off");
  await expect.poll(() => aiActive(page)).toBe(false);
  await page.getByRole("button", { name: "AI: off" }).click();
  await expect(aiButton).toHaveText("AI: on");
  await expect.poll(() => aiActive(page)).toBe(true);

  // Without an AI the button is hidden.
  await boot(page, "?debug=1&seed=1&ai=off");
  expect(await aiActive(page)).toBeNull();
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeVisible();
  await expect(aiButton).toBeHidden();
});
