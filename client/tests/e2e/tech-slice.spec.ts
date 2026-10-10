import { expect, type Page, test } from "@playwright/test";

interface Point {
  x: number;
  y: number;
}

interface RedlineDebugView {
  isReady(): boolean;
  tick(): number;
  unitCount(): number;
  unitPosition(id: number): Point | null;
  isMoving(id: number): boolean;
  selectedIds(): number[];
  worldToScreen(x: number, y: number): Point;
  cameraTarget(): Point;
  commandMove(ids: number[], x: number, y: number): void;
  stateHash(): Promise<string>;
  drawCalls(): number;
}

type DebugWindow = Window & { __redline?: RedlineDebugView };

async function bootDebug(page: Page, query: string): Promise<void> {
  await page.goto(`/?mode=tech-slice&debug=1${query}`);
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
  );
}

async function debugCall<T, A = undefined>(
  page: Page,
  body: (api: RedlineDebugView, arg: A) => T,
  arg?: A,
): Promise<Awaited<T>> {
  const api = await page.evaluateHandle(
    () => (window as DebugWindow).__redline as RedlineDebugView,
  );
  const run = body as (api: RedlineDebugView, arg: unknown) => T;
  return (await api.evaluate(run, arg)) as Awaited<T>;
}

function screenOf(page: Page, x: number, y: number): Promise<Point> {
  return debugCall(
    page,
    (api, [px, py]: [number, number]) => api.worldToScreen(px, py),
    [x, y],
  );
}

test("AC-02-38: boots the simulation in a worker", async ({ page }) => {
  await bootDebug(page, "");
  expect(await debugCall(page, (api) => api.unitCount())).toBe(500);
  expect(page.workers().some((w) => w.url().includes("sim.worker"))).toBe(true);
  const before = await debugCall(page, (api) => api.tick());
  await page.waitForTimeout(2000);
  const after = await debugCall(page, (api) => api.tick());
  expect(after - before).toBeGreaterThanOrEqual(10);
});

test("AC-02-39: selects a unit by clicking", async ({ page }) => {
  await bootDebug(page, "&units=1");
  const unit = await debugCall(page, (api) => api.unitPosition(0));
  expect(unit).not.toBeNull();
  const point = await screenOf(page, unit?.x ?? 0, unit?.y ?? 0);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => debugCall(page, (api) => api.selectedIds()))
    .toEqual([0]);
  await expect(page.locator("#hud-selected")).toHaveText("Selected: 1");

  const empty = await screenOf(page, 10.5, 10.5);
  await page.mouse.click(empty.x, empty.y);
  await expect
    .poll(() => debugCall(page, (api) => api.selectedIds()))
    .toEqual([]);
  await expect(page.locator("#hud-selected")).toHaveText("Selected: 0");
});

test("AC-02-40: selects units with a box", async ({ page }) => {
  await bootDebug(page, "&units=20");
  const a = await screenOf(page, 4, 4);
  const b = await screenOf(page, 24, 5);
  const start = { x: a.x - 20, y: a.y - 20 };
  const end = { x: b.x + 20, y: b.y + 20 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();

  const expected = await debugCall(
    page,
    (api, rect: { start: Point; end: Point }) => {
      const minX = Math.min(rect.start.x, rect.end.x);
      const maxX = Math.max(rect.start.x, rect.end.x);
      const minY = Math.min(rect.start.y, rect.end.y);
      const maxY = Math.max(rect.start.y, rect.end.y);
      const ids: number[] = [];
      for (let id = 0; id < api.unitCount(); id++) {
        const p = api.unitPosition(id);
        if (p === null) continue;
        const s = api.worldToScreen(p.x, p.y);
        if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) {
          ids.push(id);
        }
      }
      return ids;
    },
    { start, end },
  );
  const selected = await debugCall(page, (api) => api.selectedIds());
  expect(expected.length).toBeGreaterThanOrEqual(2);
  expect(selected.length).toBeGreaterThanOrEqual(2);
  for (const id of expected) {
    expect(selected).toContain(id);
  }
});

test("AC-02-41: moves selected units with right click", async ({ page }) => {
  await bootDebug(page, "&units=1");
  const unit = await debugCall(page, (api) => api.unitPosition(0));
  const point = await screenOf(page, unit?.x ?? 0, unit?.y ?? 0);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => debugCall(page, (api) => api.selectedIds()))
    .toEqual([0]);

  const target = await screenOf(page, 10.5, 10.5);
  await page.mouse.click(target.x, target.y, { button: "right" });
  await expect
    .poll(() => debugCall(page, (api) => api.isMoving(0)), { timeout: 10_000 })
    .toBe(true);
  await expect
    .poll(() => debugCall(page, (api) => api.isMoving(0)), { timeout: 10_000 })
    .toBe(false);
  const final = await debugCall(page, (api) => api.unitPosition(0));
  expect(final).not.toBeNull();
  expect(Math.abs((final?.x ?? 0) - 10.5)).toBeLessThanOrEqual(0.01);
  expect(Math.abs((final?.y ?? 0) - 10.5)).toBeLessThanOrEqual(0.01);
});

test("AC-02-42: renders 500 units in at most 4 draw calls", async ({
  page,
}) => {
  await bootDebug(page, "");
  await expect
    .poll(() => debugCall(page, (api) => api.drawCalls()))
    .toBeGreaterThanOrEqual(1);
  const calls = await debugCall(page, (api) => api.drawCalls());
  expect(calls).toBeGreaterThanOrEqual(1);
  expect(calls).toBeLessThanOrEqual(4);
});

test("AC-02-43: pans the camera with arrow keys", async ({ page }) => {
  await bootDebug(page, "");
  const before = await debugCall(page, (api) => api.cameraTarget());
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowRight");
  const after = await debugCall(page, (api) => api.cameraTarget());
  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBeLessThan(before.y);
});

test("AC-02-45: selects all units with Ctrl+A", async ({ page }) => {
  await bootDebug(page, "&units=20");
  expect(await debugCall(page, (api) => api.selectedIds())).toEqual([]);
  const before = await debugCall(page, (api) => api.cameraTarget());
  await page.keyboard.press("ControlOrMeta+A");
  await expect
    .poll(() => debugCall(page, (api) => api.selectedIds()))
    .toEqual(Array.from({ length: 20 }, (_, i) => i));
  await expect(page.locator("#hud-selected")).toHaveText("Selected: 20");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await page.waitForTimeout(300);
  expect(await debugCall(page, (api) => api.cameraTarget())).toEqual(before);
});

test("AC-02-46: shows a performance panel only in debug mode", async ({
  page,
}) => {
  type PerfDebug = RedlineDebugView & {
    injectFrameTimes(frameTimesMs: number[]): void;
    resumeFrameTimes(): void;
  };
  await bootDebug(page, "");
  const panel = page.locator("#perf-panel");
  await expect(panel).toBeVisible();
  const viewport = page.viewportSize();
  const box = await panel.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  if (viewport === null || box === null) return;
  expect(box.y).toBeLessThanOrEqual(16);
  expect(viewport.width - (box.x + box.width)).toBeLessThanOrEqual(16);
  for (const id of ["#hud-selected", "#hud-tick"]) {
    const other = await page.locator(id).boundingBox();
    expect(other).not.toBeNull();
    if (other === null) continue;
    const apart =
      box.x >= other.x + other.width ||
      other.x >= box.x + box.width ||
      box.y >= other.y + other.height ||
      other.y >= box.y + box.height;
    expect(apart).toBe(true);
  }
  await expect(page.locator("#perf-fps")).not.toHaveText("FPS 0", {
    timeout: 2000,
  });
  await page.evaluate(() =>
    (window as unknown as { __redline: PerfDebug }).__redline.injectFrameTimes(
      Array.from({ length: 120 }, () => 40),
    ),
  );
  await expect(panel).toHaveClass(/perf-bad/);
  await expect(page.locator("#perf-fps")).toHaveText("FPS 25");
  await expect(page.locator("#perf-p95")).toHaveText("p95 40.0 ms");
  await page.evaluate(() =>
    (window as unknown as { __redline: PerfDebug }).__redline.injectFrameTimes(
      Array.from({ length: 120 }, () => 10),
    ),
  );
  await expect(panel).not.toHaveClass(/perf-bad/);
  await expect(page.locator("#perf-fps")).toHaveText("FPS 100");
  await expect(page.locator("#perf-p95")).toHaveText("p95 10.0 ms");

  await page.goto("/?mode=tech-slice");
  await expect(page.locator("#hud-tick")).toHaveText(/\S/, { timeout: 10_000 });
  await expect(page.locator("#perf-panel")).toHaveCount(0);
});
