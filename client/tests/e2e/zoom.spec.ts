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

interface ZoomDebugView {
  isReady(): boolean;
  modelsReady(): boolean;
  zoom?(): number;
  typeIndex(id: string): number;
  entities(): EntityView[];
  selectedIds(): number[];
  cameraTarget(): Point;
  worldToScreen(x: number, y: number): Point;
}

type DebugWindow = Window & { __redline?: ZoomDebugView };

/** ZOOM_MIN of spec 08 §3.4. */
const ZOOM_MIN = 0.6;
const ZOOM_STEP = 1.15;

function zoom(page: Page): Promise<number> {
  return page.evaluate(() => (window as DebugWindow).__redline?.zoom?.() ?? -1);
}

function cameraTarget(page: Page): Promise<Point> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.cameraTarget() ?? { x: -1, y: -1 },
  );
}

/** Screen distance between the ground points (x, y) and (x + 4, y). */
function spread(page: Page, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([px, py]) => {
      const redline = (window as DebugWindow).__redline;
      if (redline === undefined) return -1;
      const a = redline.worldToScreen(px, py);
      const b = redline.worldToScreen(px + 4, py);
      return Math.hypot(b.x - a.x, b.y - a.y);
    },
    [x, y] as const,
  );
}

/** The own dozer, read from the latest snapshot. */
function dozer(page: Page): Promise<EntityView | null> {
  return page.evaluate(() => {
    const redline = (window as DebugWindow).__redline;
    if (redline === undefined) return null;
    const kind = redline.typeIndex("ua-dozer");
    return (
      redline.entities().find((e) => e.owner === 0 && e.kind === kind) ?? null
    );
  });
}

test("AC-08-11: zoom in the skirmish", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () =>
      (window as DebugWindow).__redline?.isReady() === true &&
      (window as DebugWindow).__redline?.modelsReady() === true,
    undefined,
    { timeout: 10_000 },
  );
  expect(await zoom(page)).toBe(1);

  const target = await cameraTarget(page);
  const before = await spread(page, target.x, target.y);
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -100);
  }
  await expect.poll(() => zoom(page)).toBeCloseTo(ZOOM_STEP ** 3, 2);
  expect(await cameraTarget(page)).toEqual(target);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const after = await spread(page, target.x, target.y);
  expect(after / before).toBeGreaterThan(ZOOM_STEP ** 3 * 0.95);
  expect(after / before).toBeLessThan(ZOOM_STEP ** 3 * 1.05);

  // Picking follows the zoomed projection: a real click selects the dozer.
  const unit = await dozer(page);
  expect(unit).not.toBeNull();
  if (unit === null) return;
  const point = await page.evaluate(
    ([x, y]) =>
      (window as DebugWindow).__redline?.worldToScreen(x, y) ?? {
        x: -1,
        y: -1,
      },
    [unit.x, unit.y] as const,
  );
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(() => (window as DebugWindow).__redline?.selectedIds()),
    )
    .toEqual([unit.id]);

  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 100);
  }
  await expect.poll(() => zoom(page)).toBeCloseTo(ZOOM_MIN, 6);
  expect(errors).toEqual([]);
});
