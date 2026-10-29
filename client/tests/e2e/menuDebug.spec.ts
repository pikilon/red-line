import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface Point {
  x: number;
  y: number;
}

interface MenuDebugView {
  isReady(): boolean;
  tick(): number;
  controlledPlayer(): number;
  selectedIds(): number[];
  cameraTarget(): Point;
}

type DebugWindow = Window & { __redline?: MenuDebugView };

/** Console errors of the page, collected from the start. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function boot(page: Page, query: string, debug: boolean): Promise<void> {
  await page.goto(`/${query}&map=first-line`);
  if (debug) {
    await page.waitForFunction(
      () => (window as DebugWindow).__redline?.isReady() === true,
      undefined,
      { timeout: ms(10_000) },
    );
  } else {
    await expect(page.locator("#res-player")).toHaveText(/^Player 1/, {
      timeout: ms(10_000),
    });
    // Let the first snapshot and the scene settle.
    await page.waitForTimeout(500);
  }
}

test("AC-08-13: switch side in the skirmish", async ({ page }) => {
  test.setTimeout(ms(60_000));
  const errors = collectErrors(page);

  // (a) Without debug: the HUD follows the switch, there is no debug API.
  await boot(page, "?seed=1&ai=off", false);
  expect(
    await page.evaluate(() => (window as DebugWindow).__redline === undefined),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch side" }).click();
  await expect(page.locator("#res-player")).toHaveText("Player 2: Russia");
  await page.getByRole("button", { name: "Switch side" }).click();
  await expect(page.locator("#res-player")).toHaveText("Player 1: Ukraine");

  // (b) With debug: selection cleared, camera moved, the game keeps running.
  await boot(page, "?debug=1&seed=1&ai=off", true);
  await page.keyboard.press("Control+a");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as DebugWindow).__redline?.selectedIds().length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  const before = await page.evaluate(
    () => (window as DebugWindow).__redline?.cameraTarget() ?? { x: 0, y: 0 },
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch side" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as DebugWindow).__redline?.controlledPlayer() ?? -1,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () => (window as DebugWindow).__redline?.selectedIds().length ?? -1,
    ),
  ).toBe(0);
  await expect
    .poll(async () => {
      const after = await page.evaluate(
        () => (window as DebugWindow).__redline?.cameraTarget() ?? before,
      );
      return Math.hypot(after.x - before.x, after.y - before.y);
    })
    .toBeGreaterThan(10);
  await page.getByRole("button", { name: "Resume" }).click();
  const tick = await page.evaluate(
    () => (window as DebugWindow).__redline?.tick() ?? 0,
  );
  await expect
    .poll(
      () => page.evaluate(() => (window as DebugWindow).__redline?.tick() ?? 0),
      { timeout: ms(5000) },
    )
    .toBeGreaterThan(tick);
  expect(errors).toEqual([]);
});

test("AC-08-14: reveal and FPS panel in the skirmish", async ({ page }) => {
  test.setTimeout(ms(60_000));
  const errors = collectErrors(page);
  await boot(page, "?seed=1&ai=off", false);
  const panel = page.locator("#perf-panel");
  await expect(panel).toBeHidden();

  await page.keyboard.press("Escape");
  const fps = page.getByRole("button", { name: /^FPS panel/ });
  await expect(fps).toHaveText("FPS panel: off");
  await fps.click();
  await expect(fps).toHaveText("FPS panel: on");
  await expect(panel).toBeVisible();
  // The tick reads with the FPS and the same switch hides it (spec 03 §6.7).
  await expect(page.locator("#perf-tick")).toHaveText(/^Tick \d+$/);
  await fps.click();
  await expect(fps).toHaveText("FPS panel: off");
  await expect(panel).toBeHidden();

  const reveal = page.getByRole("button", { name: /^Reveal map/ });
  await expect(reveal).toHaveText("Reveal map: off");
  await reveal.click();
  await expect(reveal).toHaveText("Reveal map: on");
  await reveal.click();
  await expect(reveal).toHaveText("Reveal map: off");
  expect(errors).toEqual([]);

  // With debug the panel starts on.
  await boot(page, "?debug=1&seed=1&ai=off", true);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^FPS panel/ })).toHaveText(
    "FPS panel: on",
  );
});
