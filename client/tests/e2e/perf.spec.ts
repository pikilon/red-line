import { expect, test } from "@playwright/test";

interface RedlinePerfView {
  isReady(): boolean;
  unitCount(): number;
  commandMove(ids: number[], x: number, y: number): void;
  resetFrameStats(): void;
  frameStats(): { frames: number; p95FrameMs: number };
}

type DebugWindow = Window & { __redline?: RedlinePerfView };

const MEASURED_FRAMES = 300;

test("AC-02-44: keeps 60 fps with 500 moving units @perf", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?mode=tech-slice&debug=1");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as RedlinePerfView;
    const ids = Array.from({ length: api.unitCount() }, (_, id) => id);
    api.commandMove(ids, 100.5, 100.5);
    api.resetFrameStats();
  });
  await page.waitForFunction(
    (frames) =>
      ((window as DebugWindow).__redline as RedlinePerfView).frameStats()
        .frames >= frames,
    MEASURED_FRAMES,
    { timeout: 30_000 },
  );
  const stats = await page.evaluate(() =>
    ((window as DebugWindow).__redline as RedlinePerfView).frameStats(),
  );
  console.log(
    `AC-02-44 frames=${stats.frames} p95FrameMs=${stats.p95FrameMs.toFixed(2)}`,
  );
  expect(stats.frames).toBeGreaterThanOrEqual(MEASURED_FRAMES);
  expect(stats.p95FrameMs).toBeLessThanOrEqual(19);
});
