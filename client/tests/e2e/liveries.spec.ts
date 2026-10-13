import { expect, test } from "@playwright/test";

interface LiveriesDebug {
  isReady(): boolean;
  modelsReady(): boolean;
  tick(): number;
  entities(): { kind: number }[];
}

type DebugWindow = Window & { __redline?: LiveriesDebug };

test("AC-13-06: vehicle liveries render without errors", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () => {
      const debug = (window as DebugWindow).__redline;
      return debug?.isReady() === true && debug.modelsReady();
    },
    undefined,
    { timeout: 10_000 },
  );
  // Both dozers (Ukrainian and Russian) wear a livery: the game keeps ticking
  // with the livery shader compiled.
  const before = await page.evaluate(
    () => (window as DebugWindow).__redline?.tick() ?? 0,
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as DebugWindow).__redline?.tick() ?? 0),
    )
    .toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
