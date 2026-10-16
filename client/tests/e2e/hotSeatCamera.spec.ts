import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface Point {
  x: number;
  y: number;
}

interface EntityView {
  owner: number;
  kind: number;
  x: number;
  y: number;
}

interface HotSeatDebugView {
  isReady(): boolean;
  controlledPlayer(): number;
  viewer(): number;
  typeIndex(id: string): number;
  entities(): EntityView[];
  cameraTarget(): Point;
  setCameraTarget(x: number, y: number): void;
}

type DebugWindow = Window & { __redline?: HotSeatDebugView };

function cameraTarget(page: Page): Promise<Point> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.cameraTarget() ?? { x: -1, y: -1 },
  );
}

function setCameraTarget(page: Page, x: number, y: number): Promise<void> {
  return page.evaluate(
    ([px, py]) => (window as DebugWindow).__redline?.setCameraTarget(px, py),
    [x, y] as const,
  );
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test("AC-08-06: hot-seat camera", async ({ page }) => {
  await page.goto("/?debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );

  // Reveal to read the owner-1 HQ position, then hide again.
  await page.keyboard.press("F3");
  await expect
    .poll(() =>
      page.evaluate(() => (window as DebugWindow).__redline?.viewer()),
    )
    .toBe(255);
  const ruHq = await page.evaluate(() => {
    const redline = (window as DebugWindow).__redline;
    const kind = redline?.typeIndex("ru-hq");
    return (
      redline?.entities().find((e) => e.owner === 1 && e.kind === kind) ?? null
    );
  });
  expect(ruHq).not.toBeNull();
  await page.keyboard.press("F3");
  await expect
    .poll(() =>
      page.evaluate(() => (window as DebugWindow).__redline?.viewer()),
    )
    .toBe(0);

  await setCameraTarget(page, 10, 10);
  await page.keyboard.press("F2");
  await expect
    .poll(async () => distance(await cameraTarget(page), ruHq as Point))
    .toBeLessThan(0.5);

  await setCameraTarget(page, 100, 20);
  await page.keyboard.press("F2");
  await expect
    .poll(async () => distance(await cameraTarget(page), { x: 10, y: 10 }))
    .toBeLessThan(0.01);

  await page.keyboard.press("F2");
  await expect
    .poll(async () => distance(await cameraTarget(page), { x: 100, y: 20 }))
    .toBeLessThan(0.01);
});
