import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface SellingDebug {
  isReady(): boolean;
  entities(): {
    id: number;
    owner: number;
    kind: number;
    x: number;
    y: number;
  }[];
  entity(id: number): unknown;
  typeIndex(id: string): number;
  selectedIds(): number[];
  worldToScreen(x: number, y: number): { x: number; y: number };
  credits(): number;
  setSimPaused(paused: boolean): void;
}

type DebugWindow = Window & { __redline?: SellingDebug };

async function call<T, A = undefined>(
  page: Page,
  body: (api: SellingDebug, arg: A) => T,
  arg?: A,
): Promise<T> {
  const api = await page.evaluateHandle(
    () => (window as DebugWindow).__redline as SellingDebug,
  );
  const run = body as (api: SellingDebug, arg: unknown) => T;
  return (await api.evaluate(run, arg)) as T;
}

async function clickTiles(page: Page, x: number, y: number): Promise<void> {
  const point = await call(
    page,
    (api, tiles: { x: number; y: number }) =>
      api.worldToScreen(tiles.x, tiles.y),
    { x, y },
  );
  await page.mouse.click(point.x, point.y);
}

test("AC-37-05: sells a producer and refunds its building and queue", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?load=selling&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );
  const barracks = await call(page, (api) => {
    const kind = api.typeIndex("ua-barracks");
    return api
      .entities()
      .find((entity) => entity.owner === 0 && entity.kind === kind);
  });
  if (barracks === undefined) throw new Error("missing barracks");
  await clickTiles(page, barracks.x, barracks.y);
  await expect
    .poll(() => call(page, (api) => api.selectedIds()))
    .toEqual([barracks.id]);

  const rifle = page.locator('#command-panel button[data-type="ua-rifleman"]');
  await expect(rifle).toBeVisible();
  // Queue both units in one browser turn: on a slow runner each separate
  // Playwright click can take several seconds, long enough for the first
  // rifleman to finish and change what the sell must refund.
  await rifle.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect.poll(() => call(page, (api) => api.credits())).toBe(4800);
  // Pause before the DOM assertions for the same reason.
  await call(page, (api) => api.setSimPaused(true));
  await expect(
    page.locator("#command-panel .tile .qn:not([hidden])"),
  ).toHaveText("2");
  const sell = page.locator('#command-panel button[data-type="sell"]');
  await expect(sell).toHaveText("Sell (250)");
  // Arm and confirm in one browser turn: on a slow runner two Playwright
  // clicks can land more than SELL_CONFIRM_MS apart and the second re-arms.
  const armedLabel = await page.evaluate(() => {
    const button = (): HTMLButtonElement | null =>
      document.querySelector('#command-panel button[data-type="sell"]');
    button()?.click();
    const label = button()?.textContent ?? null;
    button()?.click();
    return label;
  });
  expect(armedLabel).toBe("Confirm (250)");
  await call(page, (api) => api.setSimPaused(false));

  await expect
    .poll(() => call(page, (api, id: number) => api.entity(id), barracks.id))
    .toBeNull();
  await expect.poll(() => call(page, (api) => api.credits())).toBe(5250);
  await expect(
    page.locator("#command-panel .tile .qn:not([hidden])"),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
