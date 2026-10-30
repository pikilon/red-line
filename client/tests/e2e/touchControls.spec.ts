import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

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
  await page.goto("/?map=first-line&debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
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

interface EntityView {
  owner: number;
  kind: number;
  x: number;
  y: number;
}

interface TouchWorldView extends TouchDebugView {
  setCameraTarget(x: number, y: number): void;
  typeIndex(id: string): number;
  entities(): EntityView[];
  worldToScreen(x: number, y: number): Point;
}

type WorldWindow = Window & { __redline?: TouchWorldView };

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).boundingBox();
  if (found === null) throw new Error(`no box for ${selector}`);
  return found;
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

test.describe("touch device", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 844, height: 390 },
  });

  test("AC-08-19: touch menu button and two-finger pan in the skirmish", async ({
    page,
  }) => {
    test.setTimeout(ms(60_000));
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await boot(page);
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("no viewport");
    // Landscape is the only playable orientation (spec 08 §3.8).
    await expect(page.locator("#rotate-device")).toBeHidden();

    // Select the dozer so the command panel shows.
    const dozer = await page.evaluate(() => {
      const api = (window as WorldWindow).__redline;
      if (api === undefined) return null;
      const kind = api.typeIndex("ua-dozer");
      const own = api
        .entities()
        .find((entity) => entity.owner === 0 && entity.kind === kind);
      return own === undefined ? null : api.worldToScreen(own.x, own.y);
    });
    if (dozer === null) throw new Error("missing ua-dozer");
    await page.mouse.click(dozer.x, dozer.y);
    await expect(page.locator("#command-panel")).toBeVisible();
    // Cameo renders wait for idle callbacks; let the visible ones finish so a
    // late offscreen render cannot stall a frame inside the pan-rate sample.
    await expect
      .poll(
        () =>
          page
            .locator("#command-panel .cameo")
            .evaluateAll(
              (nodes) =>
                nodes.filter((node) => !node.classList.contains("has-image"))
                  .length,
            ),
        { timeout: ms(15_000) },
      )
      .toBe(0);

    // Layout: the bar sits at the bottom, menu button big enough, no overlap.
    const panel = await box(page, "#hud-bar");
    const hud = await box(page, "#hud");
    const menu = await box(page, "#touch-menu");
    expect(await page.locator("#touch-joystick").count()).toBe(0);
    expect(panel.y + panel.height / 2).toBeGreaterThan(viewport.height / 2);
    expect(menu.width).toBeGreaterThanOrEqual(40);
    expect(menu.height).toBeGreaterThanOrEqual(40);
    expect(overlaps(panel, hud)).toBe(false);

    // Two fingers sliding together pan the map (spec 08 §3.9 D6).
    await page.evaluate(() =>
      (window as WorldWindow).__redline?.setCameraTarget(40, 40),
    );
    const before = await cameraTarget(page);
    const client = await page.context().newCDPSession(page);
    // On the map, away from the HUD panels: the command panel names the
    // selection now (spec 14 §5), so it reaches a little higher than the
    // pinch test's point, which starts without a panel on screen.
    const mid = { x: viewport.width * 0.4, y: viewport.height * 0.25 };
    const fingers = (dx: number) => [
      { x: mid.x - 50 + dx, y: mid.y, id: 1 },
      { x: mid.x + 50 + dx, y: mid.y, id: 2 },
    ];
    expect(
      overlaps({ x: mid.x - 50, y: mid.y - 4, width: 100, height: 8 }, panel),
    ).toBe(false);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: fingers(0),
    });
    for (const dx of [30, 60, 90]) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: fingers(dx),
      });
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const after = await cameraTarget(page);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(
      1,
    );

    // The menu button opens the Esc menu; Resume closes it.
    await page.locator("#touch-menu").tap();
    await expect(page.locator("#game-menu")).toBeVisible();
    expect(await paused(page)).toBe(true);
    await expect(page.locator("#touch-menu")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.locator("#game-menu-resume").tap();
    await expect(page.locator("#game-menu")).toBeHidden();
    expect(await paused(page)).toBe(false);
    await expect(page.locator("#touch-menu")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(errors).toEqual([]);
  });
});

test("AC-08-17: the mouse gets the same menu button in the bar", async ({
  page,
}) => {
  await boot(page);
  await expect(page.locator("#hud-bar #touch-menu")).toBeVisible();
  const before = await cameraTarget(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowRight");
  const after = await cameraTarget(page);
  expect(after.x).toBeGreaterThan(before.x + 1);
});
