import { expect, test } from "@playwright/test";

interface ShowcaseDebug {
  isReady(): boolean;
  entities(): { id: number; owner: number; kind: number }[];
  worldToScreen(x: number, y: number): { x: number; y: number };
  typeIndex(id: string): number;
}

type DebugWindow = Window & { __redline?: ShowcaseDebug };

test("AC-14-04: showcase lays out both sides and names the selection", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?showcase=1");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
  );
  // 6 buildings and 8 units per side: 28 entities once the spawns are applied.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as DebugWindow).__redline?.entities().length ?? 0,
      ),
    )
    .toBe(28);

  // The M2 Bradley stands at slot 3 of the Ukrainian unit rows: (4 + 3.5 + 4 * 3, 16.5).
  const bradley = await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as ShowcaseDebug;
    const kind = api.typeIndex("ua-bradley");
    const entity = api.entities().find((entry) => entry.kind === kind);
    return entity === undefined ? null : api.worldToScreen(19.5, 16.5);
  });
  expect(bradley).not.toBeNull();
  await page.mouse.click(bradley?.x ?? 0, (bradley?.y ?? 0) - 4);
  await expect(page.locator("#hud-selected-type")).toHaveText("M2 Bradley");
  expect(errors).toEqual([]);
});
