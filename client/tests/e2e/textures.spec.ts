import { expect, test } from "@playwright/test";

interface TexturesDebug {
  isReady(): boolean;
  paused(): boolean;
  tick(): number;
}

type DebugWindow = Window & { __redline?: TexturesDebug };

test("AC-12-04: textures toggle in the game menu", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
  );
  const menu = page.locator("#game-menu");
  const button = page.locator("#game-menu-textures");

  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  await expect(button).toHaveText("Textures: procedural");
  await button.click();
  await expect(button).toHaveText("Textures: generated");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            JSON.parse(localStorage.getItem("redline.settings.v1") ?? "{}") as {
              generatedTextures?: boolean;
            }
          ).generatedTextures === true,
      ),
    )
    .toBe(true);

  await button.click();
  await expect(button).toHaveText("Textures: procedural");

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(menu).toBeHidden();
  const before = await page.evaluate(
    () => (window as DebugWindow).__redline?.tick() ?? 0,
  );
  await expect
    .poll(
      () => page.evaluate(() => (window as DebugWindow).__redline?.tick() ?? 0),
      { timeout: 5000 },
    )
    .toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
