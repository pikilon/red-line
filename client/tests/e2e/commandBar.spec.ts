import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface BarDebug {
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
  rallyPoints(): { building: number; x: number; y: number }[];
}
type DebugWindow = Window & { __redline?: BarDebug };

async function call<T, A = undefined>(
  page: Page,
  body: (api: BarDebug, arg: A) => T,
  arg?: A,
): Promise<T> {
  const api = await page.evaluateHandle(
    () => (window as DebugWindow).__redline as BarDebug,
  );
  return (await api.evaluate(
    body as (api: BarDebug, arg: unknown) => T,
    arg,
  )) as T;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );
}

async function selectOwn(page: Page, typeId: string) {
  const own = await call(
    page,
    (api, id: string) => {
      const kind = api.typeIndex(id);
      return api.entities().find((e) => e.owner === 0 && e.kind === kind);
    },
    typeId,
  );
  if (own === undefined) throw new Error(`missing ${typeId}`);
  const point = await call(
    page,
    (api, at: { x: number; y: number }) => api.worldToScreen(at.x, at.y),
    { x: own.x, y: own.y },
  );
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => call(page, (api) => api.selectedIds()))
    .toContain(own.id);
  return own;
}

test("AC-41-01/05/10: a unit shows its sections, cameos, and panel taps stay off the map", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, "/?map=first-line&debug=1&seed=1&ai=off");
  const dozer = await selectOwn(page, "ua-dozer");
  const panel = page.locator("#command-panel");
  await expect(panel).toBeVisible();
  for (const key of ["stop", "force-fire", "same-screen", "same-map"]) {
    await expect(panel.locator(`button[data-type="${key}"]`)).toBeVisible();
  }
  await expect(panel.locator('.chip[data-type="ua-dozer"]')).toBeVisible();
  // Every build tile gets a picture of its type (AC-41-05).
  await expect(panel.locator(".tile .cameo.has-image").first()).toBeVisible({
    timeout: ms(15_000),
  });
  // Force fire lights up and a panel tap never clears the selection (AC-41-10).
  const force = panel.locator('button[data-type="force-fire"]');
  await force.click();
  await expect(force).toHaveClass(/active/);
  await expect
    .poll(() => call(page, (api) => api.selectedIds()))
    .toContain(dozer.id);
  // The next map tap uses it up (AC-41-02 arming; the order itself shares the
  // Ctrl+click path).
  const away = await call(
    page,
    (api, at: { x: number; y: number }) =>
      api.worldToScreen(at.x + 3, at.y + 3),
    { x: dozer.x, y: dozer.y },
  );
  await page.mouse.click(away.x, away.y);
  await expect(force).not.toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test("AC-41-03/04: rally point by tap, and sell needs two taps", async ({
  page,
}) => {
  await open(page, "/?load=rally-points&ai=off");
  const barracks = await selectOwn(page, "ua-barracks");
  const panel = page.locator("#command-panel");
  const rally = panel.locator('button[data-type="rally"]');
  await rally.click();
  await expect(rally).toHaveClass(/active/);
  const spot = await call(
    page,
    (api, at: { x: number; y: number }) =>
      api.worldToScreen(at.x + 4, at.y + 4),
    { x: barracks.x, y: barracks.y },
  );
  await page.mouse.click(spot.x, spot.y);
  await expect
    .poll(() =>
      call(
        page,
        (api, id: number) => api.rallyPoints().some((p) => p.building === id),
        barracks.id,
      ),
    )
    .toBe(true);

  const sell = panel.locator('button[data-type="sell"]');
  await sell.click();
  await expect(sell).toHaveText(/Confirm/);
  await page.waitForTimeout(ms(3_300));
  await expect(sell).toHaveText(/^Sell/);
  expect(
    await call(page, (api, id: number) => api.entity(id), barracks.id),
  ).not.toBeNull();
});

test("AC-41-09: the panel folds and stays folded after a reload", async ({
  page,
}) => {
  await open(page, "/?map=first-line&debug=1&seed=1&ai=off");
  await selectOwn(page, "ua-dozer");
  const panel = page.locator("#command-panel");
  await panel.locator(".fold-tab").click();
  await expect(panel).toHaveClass(/folded/);
  await expect(panel.locator(".cb-body")).toBeHidden();
  await page.reload();
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
  );
  await selectOwn(page, "ua-dozer");
  await expect(panel).toHaveClass(/folded/);
  await panel.locator(".fold-tab").click();
  await expect(panel.locator(".cb-body")).toBeVisible();
});
