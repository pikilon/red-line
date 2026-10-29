import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface RallyDebug {
  isReady(): boolean;
  entities(): {
    id: number;
    owner: number;
    kind: number;
    x: number;
    y: number;
  }[];
  typeIndex(id: string): number;
  selectedIds(): number[];
  worldToScreen(x: number, y: number): { x: number; y: number };
  rallyMarkerCount(): number;
  rallyPoints(): { building: number; x: number; y: number }[];
}

type DebugWindow = Window & { __redline?: RallyDebug };

async function call<T, A = undefined>(
  page: Page,
  body: (api: RallyDebug, arg: A) => T,
  arg?: A,
): Promise<T> {
  const api = await page.evaluateHandle(
    () => (window as DebugWindow).__redline as RallyDebug,
  );
  const run = body as (api: RallyDebug, arg: unknown) => T;
  return (await api.evaluate(run, arg)) as T;
}

async function clickTiles(
  page: Page,
  x: number,
  y: number,
  button: "left" | "right" = "left",
): Promise<void> {
  const point = await call(
    page,
    (api, tiles: { x: number; y: number }) =>
      api.worldToScreen(tiles.x, tiles.y),
    { x, y },
  );
  await page.mouse.click(point.x, point.y, { button });
}

async function rallyPoint(page: Page, building: number) {
  return call(
    page,
    (api, id: number) =>
      api.rallyPoints().find((point) => point.building === id),
    building,
  );
}

test("AC-33-08: sets, replaces and displays rally points for both producers", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?load=rally-points&ai=off");
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
  const initial = { building: barracks.id, x: 4, y: 75 };
  await clickTiles(page, barracks.x, barracks.y);
  await expect
    .poll(() => call(page, (api) => api.selectedIds()))
    .toEqual([barracks.id]);
  await expect.poll(() => call(page, (api) => api.rallyMarkerCount())).toBe(1);
  expect(await rallyPoint(page, barracks.id)).toEqual(initial);

  // Spec 08 §3.9 D2 (revised): a ground click with a lone producer sets it.
  await clickTiles(page, 18, 72);
  await expect
    .poll(() => rallyPoint(page, barracks.id))
    .toEqual({ building: barracks.id, x: 18, y: 72 });
  expect(await call(page, (api) => api.rallyMarkerCount())).toBe(1);

  // The Rally button arms the next left click.
  const panel = page.locator("#command-panel");
  const rally = panel.locator('button[data-type="rally"]');
  await rally.click();
  await expect(rally).toHaveClass(/active/);
  await clickTiles(page, 20, 70);
  await expect
    .poll(() => rallyPoint(page, barracks.id))
    .toEqual({ building: barracks.id, x: 20, y: 70 });
  await expect(rally).not.toHaveClass(/active/);

  // Selecting something else hides the marker but keeps the stored point.
  const plant = await call(page, (api) => {
    const kind = api.typeIndex("ua-power-plant");
    return api
      .entities()
      .find((entity) => entity.owner === 0 && entity.kind === kind);
  });
  if (plant === undefined) throw new Error("missing power plant");
  await clickTiles(page, plant.x, plant.y);
  await expect
    .poll(() => call(page, (api) => api.selectedIds()))
    .toEqual([plant.id]);
  await expect.poll(() => call(page, (api) => api.rallyMarkerCount())).toBe(0);
  expect(await rallyPoint(page, barracks.id)).toEqual({
    building: barracks.id,
    x: 20,
    y: 70,
  });

  const factory = await call(page, (api) => {
    const kind = api.typeIndex("ua-vehicle-factory");
    return api
      .entities()
      .find((entity) => entity.owner === 0 && entity.kind === kind);
  });
  if (factory === undefined) throw new Error("missing vehicle factory");
  await clickTiles(page, factory.x, factory.y);
  await expect
    .poll(() => call(page, (api) => api.selectedIds()))
    .toEqual([factory.id]);
  await expect.poll(() => call(page, (api) => api.rallyMarkerCount())).toBe(1);
  expect(await rallyPoint(page, factory.id)).toEqual({
    building: factory.id,
    x: 24,
    y: 74,
  });

  await rally.click();
  await clickTiles(page, 30, 70);
  await expect
    .poll(() => rallyPoint(page, factory.id))
    .toEqual({ building: factory.id, x: 30, y: 70 });
  expect(errors).toEqual([]);
});
