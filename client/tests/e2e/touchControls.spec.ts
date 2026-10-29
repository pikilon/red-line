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

  test("AC-08-19: touch joystick in the skirmish", async ({ page }) => {
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

    // Layout: joystick bottom right, command panel bottom left, no overlap.
    const joystick = await box(page, "#touch-joystick");
    const panel = await box(page, "#command-panel");
    const hud = await box(page, "#hud");
    const menu = await box(page, "#touch-menu");
    expect(joystick.x).toBeGreaterThan(viewport.width / 2);
    expect(joystick.y).toBeGreaterThan(viewport.height / 2);
    expect(panel.x + panel.width / 2).toBeLessThan(viewport.width / 2);
    expect(panel.y + panel.height / 2).toBeGreaterThan(viewport.height / 2);
    expect(menu.width).toBeGreaterThanOrEqual(48);
    expect(menu.height).toBeGreaterThanOrEqual(48);
    for (const other of [panel, hud, menu]) {
      expect(overlaps(joystick, other)).toBe(false);
    }
    expect(overlaps(panel, menu)).toBe(false);
    expect(overlaps(panel, hud)).toBe(false);

    // Drag the knob with real touch events: proportional panning.
    await page.evaluate(() =>
      (window as WorldWindow).__redline?.setCameraTarget(40, 40),
    );
    const knob = await box(page, "#touch-joystick-knob");
    const cx = knob.x + knob.width / 2;
    const cy = knob.y + knob.height / 2;
    const radius = joystick.width / 2;
    const client = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", dy: number) =>
      client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: cx, y: cy + dy }],
      });
    const hasPressed = () =>
      page
        .locator("#touch-joystick-knob")
        .evaluate((element) => element.classList.contains("pressed"));

    // Tiles per second the camera moves over at least 400 ms. Both samples are
    // taken inside animation frames and timed with the frame timestamp, so the
    // result does not depend on how slow the runner renders: the game's own
    // frame callback (registered earlier) has already advanced the camera to
    // that same timestamp.
    const speed = (): Promise<{ rate: number; dx: number; dy: number }> =>
      page.evaluate(
        () =>
          new Promise<{ rate: number; dx: number; dy: number }>((resolve) => {
            const api = (window as WorldWindow).__redline;
            if (api === undefined) throw new Error("no debug api");
            let start: { t: number; x: number; y: number } | null = null;
            const sample = (now: number): void => {
              const at = api.cameraTarget();
              if (start === null) {
                start = { t: now, x: at.x, y: at.y };
              } else if (now - start.t >= 400) {
                const seconds = (now - start.t) / 1000;
                const dx = at.x - start.x;
                const dy = at.y - start.y;
                resolve({ rate: Math.hypot(dx, dy) / seconds, dx, dy });
                return;
              }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          }),
      );

    await touch("touchStart", 0);
    await touch("touchMove", -radius / 2);
    expect(await hasPressed()).toBe(true);
    const half = await speed();
    await touch("touchMove", -radius * 2);
    const full = await speed();
    await touch("touchEnd", 0);
    // Up is the ArrowUp direction (-x, -y); a full push is the keyboard speed
    // (20 tiles/s) and a half push about half of it.
    expect(half.dx).toBeLessThan(-1);
    expect(half.dy).toBeLessThan(-1);
    expect(full.rate).toBeGreaterThan(14);
    expect(full.rate).toBeLessThan(26);
    expect(half.rate / full.rate).toBeGreaterThan(0.35);
    expect(half.rate / full.rate).toBeLessThan(0.65);
    expect(await hasPressed()).toBe(false);

    // After release the camera stays put and the knob is back at the centre.
    await page.waitForTimeout(300);
    const settled = await cameraTarget(page);
    await page.waitForTimeout(300);
    const later = await cameraTarget(page);
    expect(later.x).toBeCloseTo(settled.x, 5);
    expect(later.y).toBeCloseTo(settled.y, 5);
    const rest = await box(page, "#touch-joystick-knob");
    expect(rest.x).toBeCloseTo(knob.x, 0);
    expect(rest.y).toBeCloseTo(knob.y, 0);

    // The menu button opens and closes the Esc menu.
    await page.locator("#touch-menu").tap();
    await expect(page.locator("#game-menu")).toBeVisible();
    expect(await paused(page)).toBe(true);
    await expect(page.locator("#touch-menu")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.locator("#touch-joystick")).toBeHidden();
    await page.locator("#touch-menu").tap();
    await expect(page.locator("#game-menu")).toBeHidden();
    expect(await paused(page)).toBe(false);
    await expect(page.locator("#touch-menu")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.locator("#touch-joystick")).toBeVisible();
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
