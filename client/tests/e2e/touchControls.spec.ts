import { expect, type Page, test } from "@playwright/test";

interface Point {
  x: number;
  y: number;
}

interface TouchDebugView {
  isReady(): boolean;
  paused(): boolean;
  cameraTarget(): Point;
}

type DebugWindow = Window & { __redline?: TouchDebugView };

async function boot(page: Page): Promise<void> {
  await page.goto("/?debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
  );
}

function cameraTarget(page: Page): Promise<Point> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.cameraTarget() ?? { x: -1, y: -1 },
  );
}

function paused(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.paused() ?? false,
  );
}

test.describe("touch device", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("AC-08-16: touch controls in the skirmish", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await boot(page);

    for (const id of [
      "touch-up",
      "touch-down",
      "touch-left",
      "touch-right",
      "touch-menu",
    ]) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box?.width ?? 0, id).toBeGreaterThanOrEqual(48);
      expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(48);
    }
    const dpad = await page.locator("#touch-dpad").boundingBox();
    const hud = await page.locator("#hud").boundingBox();
    expect(dpad).not.toBeNull();
    expect(hud).not.toBeNull();
    if (dpad !== null && hud !== null) {
      const overlap =
        dpad.x < hud.x + hud.width &&
        hud.x < dpad.x + dpad.width &&
        dpad.y < hud.y + hud.height &&
        hud.y < dpad.y + dpad.height;
      expect(overlap).toBe(false);
    }

    // Hold the right button: the camera pans like ArrowRight (+x, -y).
    const before = await cameraTarget(page);
    const right = await page.locator("#touch-right").boundingBox();
    if (right === null) throw new Error("no #touch-right");
    const cx = right.x + right.width / 2;
    const cy = right.y + right.height / 2;
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: cx, y: cy }],
    });
    await page.waitForTimeout(500);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const after = await cameraTarget(page);
    expect(after.x - before.x).toBeGreaterThan(1);
    expect(after.y - before.y).toBeLessThan(-1);
    await page.waitForTimeout(300);
    const settled = await cameraTarget(page);
    expect(settled.x).toBeCloseTo(after.x, 5);
    expect(settled.y).toBeCloseTo(after.y, 5);

    // The menu button opens and closes the Esc menu.
    await page.locator("#touch-menu").tap();
    await expect(page.locator("#game-menu")).toBeVisible();
    expect(await paused(page)).toBe(true);
    await expect(page.locator("#touch-dpad")).toBeHidden();
    await page.locator("#touch-menu").tap();
    await expect(page.locator("#game-menu")).toBeHidden();
    expect(await paused(page)).toBe(false);
    await expect(page.locator("#touch-dpad")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test("AC-08-17: no touch controls without touch", async ({ page }) => {
  await boot(page);
  await expect(page.locator("#touch-controls")).toHaveCount(0);
  const before = await cameraTarget(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowRight");
  const after = await cameraTarget(page);
  expect(after.x).toBeGreaterThan(before.x + 1);
});
