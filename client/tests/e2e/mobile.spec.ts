import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface Point {
  x: number;
  y: number;
}

interface MobileDebugView {
  isReady(): boolean;
  zoom(): number;
  cameraTarget(): Point;
  selectedIds(): number[];
  setCameraTarget(x: number, y: number): void;
}

type DebugWindow = Window & { __redline?: MobileDebugView };

async function boot(page: Page): Promise<void> {
  await page.goto("/?map=first-line&debug=1&seed=1&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );
}

function zoom(page: Page): Promise<number> {
  return page.evaluate(() => (window as DebugWindow).__redline?.zoom() ?? -1);
}

function cameraTarget(page: Page): Promise<Point> {
  return page.evaluate(
    () => (window as DebugWindow).__redline?.cameraTarget() ?? { x: -1, y: -1 },
  );
}

/** Layout facts of the page: no scrollbars, no native page zoom. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overlay = document.getElementById("rotate-device");
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scale: window.visualViewport?.scale ?? 1,
      overlay: overlay === null ? "missing" : getComputedStyle(overlay).display,
    };
  });
}

type TouchType = "touchStart" | "touchMove" | "touchEnd";
type CdpSession = Awaited<ReturnType<BrowserContext["newCDPSession"]>>;

/** Sends two real touch points, `spread` px left and right of the centre.
 *  The same CDP session must keep the touch sequence alive. */
async function pinch(
  client: CdpSession,
  type: TouchType,
  centre: Point,
  spread: number,
): Promise<void> {
  await client.send("Input.dispatchTouchEvent", {
    type,
    touchPoints:
      type === "touchEnd"
        ? []
        : [
            { x: centre.x - spread, y: centre.y, id: 1 },
            { x: centre.x + spread, y: centre.y, id: 2 },
          ],
  });
}

test.describe("mobile web app", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 844, height: 390 },
  });

  test("AC-08-23: pinch zooms the 3D camera, not the page", async ({
    page,
  }) => {
    test.setTimeout(ms(60_000));
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await boot(page);

    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("no viewport");
    const centre = { x: viewport.width / 2, y: viewport.height / 2 };
    await page.evaluate(() =>
      (window as DebugWindow).__redline?.setCameraTarget(40, 40),
    );
    const target = await cameraTarget(page);
    expect(await zoom(page)).toBe(1);
    // A later listener verifies that the two-finger touchstart was cancelled
    // before the browser could zoom the page natively.
    await page.evaluate(() => {
      const state = { seen: 0, prevented: false };
      (window as unknown as { __touchGuard: typeof state }).__touchGuard =
        state;
      document.addEventListener("touchstart", (event) => {
        if (event.touches.length < 2) return;
        state.seen += 1;
        state.prevented = event.defaultPrevented;
      });
    });

    const client = await page.context().newCDPSession(page);
    try {
      // Spreading the fingers doubles the camera zoom around a fixed target.
      await pinch(client, "touchStart", centre, 80);
      await pinch(client, "touchMove", centre, 160);
      await expect.poll(() => zoom(page)).toBeCloseTo(2, 2);
      const afterZoom = await cameraTarget(page);
      expect(Math.abs(afterZoom.x - target.x)).toBeLessThan(0.01);
      expect(Math.abs(afterZoom.y - target.y)).toBeLessThan(0.01);

      // Farther apart clamps at the wheel's maximum.
      await pinch(client, "touchMove", centre, 400);
      await expect.poll(() => zoom(page)).toBe(3);
      await pinch(client, "touchEnd", centre, 0);

      // Pinching together clamps at the wheel's minimum.
      await pinch(client, "touchStart", centre, 300);
      await pinch(client, "touchMove", centre, 10);
      await expect.poll(() => zoom(page)).toBe(0.6);
      await pinch(client, "touchEnd", centre, 0);
    } finally {
      await client.detach();
    }

    // The page itself never zoomed or scrolled, and the pinch never selected.
    const layoutAfter = await layout(page);
    expect(layoutAfter.scale).toBe(1);
    expect(layoutAfter.scrollX).toBe(0);
    expect(layoutAfter.scrollY).toBe(0);
    expect(
      await page.evaluate(
        () => (window as DebugWindow).__redline?.selectedIds() ?? [-1],
      ),
    ).toEqual([]);
    await expect(page.locator("#selection-box")).toBeHidden();
    const guard = await page.evaluate(() => {
      const state = (
        window as unknown as {
          __touchGuard?: { seen: number; prevented: boolean };
        }
      ).__touchGuard;
      return state ?? { seen: 0, prevented: false };
    });
    expect(guard.seen).toBeGreaterThan(0);
    expect(guard.prevented).toBe(true);
    expect(errors).toEqual([]);
  });

  test("AC-08-24: landscape-only installable web app without overflow", async ({
    page,
    request,
  }) => {
    test.setTimeout(ms(60_000));
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await boot(page);

    // The manifest makes the game installable and asks for landscape.
    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.status()).toBe(200);
    const manifest = (await manifestResponse.json()) as {
      name?: string;
      short_name?: string;
      display?: string;
      orientation?: string;
      icons?: { src?: string; sizes?: string }[];
    };
    expect(manifest.name).toBe("Modern Conquest: Red Line");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("landscape");
    const iconSizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(iconSizes).toContain("192x192");
    expect(iconSizes).toContain("512x512");
    for (const icon of ["/icons/icon-192.png", "/icons/icon-512.png"]) {
      const response = await request.get(icon);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
    }

    // Installable means a registered service worker with a fetch handler.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration =
              await navigator.serviceWorker.getRegistration();
            return registration !== undefined;
          }),
        { timeout: ms(10_000) },
      )
      .toBe(true);

    // The viewport never allows native pinch zoom, and the portrait guard is
    // off while the device is landscape.
    const viewportMeta = await page.evaluate(
      () =>
        document
          .querySelector('meta[name="viewport"]')
          ?.getAttribute("content") ?? "",
    );
    expect(viewportMeta).toContain("user-scalable=no");
    expect(viewportMeta).toContain("viewport-fit=cover");
    const landscape = await layout(page);
    expect(landscape.overlay).toBe("none");
    expect(landscape.scrollWidth).toBeLessThanOrEqual(landscape.clientWidth);
    expect(landscape.scrollHeight).toBeLessThanOrEqual(landscape.clientHeight);
    expect(landscape.scrollY).toBe(0);

    // The hamburger opens the game menu inside the viewport.
    await page.locator("#touch-menu").tap();
    await expect(page.locator("#game-menu")).toBeVisible();
    const panel = await page.locator("#game-menu-panel").boundingBox();
    if (panel === null) throw new Error("no game menu panel");
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(
      landscape.clientHeight + 1,
    );
    const menuLayout = await layout(page);
    expect(menuLayout.scrollWidth).toBeLessThanOrEqual(menuLayout.clientWidth);
    expect(menuLayout.scrollHeight).toBeLessThanOrEqual(
      menuLayout.clientHeight,
    );
    await page.locator("#touch-menu").tap();
    await expect(page.locator("#game-menu")).toBeHidden();

    // Rotating to portrait shows the landscape-only guard instead.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#rotate-device")).toBeVisible();
    await expect(page.locator("#rotate-device h2")).toHaveText(
      "Rotate your device",
    );
    const portrait = await layout(page);
    expect(portrait.overlay).toBe("flex");
    expect(portrait.scrollWidth).toBeLessThanOrEqual(portrait.clientWidth);
    expect(portrait.scrollHeight).toBeLessThanOrEqual(portrait.clientHeight);
    expect(portrait.scrollY).toBe(0);
    expect(errors).toEqual([]);
  });
});
