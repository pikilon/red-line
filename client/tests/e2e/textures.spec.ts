import { expect, test } from "@playwright/test";
import { ms } from "./timeouts";

interface TexturesDebug {
  isReady(): boolean;
  paused(): boolean;
  tick(): number;
}

type DebugWindow = Window & { __redline?: TexturesDebug };

// A fresh browser profile: no saved settings, so the default (generated) applies.
test.use({ storageState: { cookies: [], origins: [] } });

test("AC-12-04: textures toggle in the game menu", async ({ page }) => {
  test.setTimeout(ms(60_000));
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?map=first-line&debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );
  const menu = page.locator("#game-menu");
  const button = page.locator("#game-menu-textures");

  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  // Generated textures are the default (owner decision 2026-10-13).
  await expect(button).toHaveText("Textures: generated");
  await button.click();
  await expect(button).toHaveText("Textures: procedural");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            JSON.parse(localStorage.getItem("redline.settings.v1") ?? "{}") as {
              generatedTextures?: boolean;
            }
          ).generatedTextures === false,
      ),
    )
    .toBe(true);

  await button.click();
  await expect(button).toHaveText("Textures: generated");

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(menu).toBeHidden();
  const before = await page.evaluate(
    () => (window as DebugWindow).__redline?.tick() ?? 0,
  );
  await expect
    .poll(
      () => page.evaluate(() => (window as DebugWindow).__redline?.tick() ?? 0),
      { timeout: ms(5000) },
    )
    .toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
