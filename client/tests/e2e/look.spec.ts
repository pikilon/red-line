import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface Point {
  x: number;
  y: number;
}

interface EntityView {
  id: number;
  owner: number;
  kind: number;
  x: number;
  y: number;
}

interface RenderInfo {
  shadowMap: boolean;
  sunCastsShadow: boolean;
  toneMapping: string;
}

interface LookDebugView {
  isReady(): boolean;
  entities(): EntityView[];
  worldToScreen(x: number, y: number): Point;
  drawCalls(): number;
  renderInfo(): RenderInfo;
}

type DebugWindow = Window & { __redline?: LookDebugView };

async function boot(page: Page): Promise<void> {
  await page.goto("/?map=first-line&debug=1&seed=1");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(15_000) },
  );
  // Let a few frames render so `drawCalls()` reflects the composed scene.
  await page.waitForTimeout(500);
}

test("AC-10-03: shadows and lighting", async ({ page }) => {
  test.setTimeout(ms(60_000));
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await boot(page);

  const { renderInfo, drawCalls, types } = await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as LookDebugView;
    const rect = document.querySelector("canvas")?.getBoundingClientRect();
    const onScreen = new Set<number>();
    for (const entity of api.entities()) {
      const point = api.worldToScreen(entity.x, entity.y);
      if (
        rect !== undefined &&
        point.x >= rect.left &&
        point.x < rect.left + rect.width &&
        point.y >= rect.top &&
        point.y < rect.top + rect.height
      ) {
        onScreen.add(entity.kind);
      }
    }
    return {
      renderInfo: api.renderInfo(),
      drawCalls: api.drawCalls(),
      types: onScreen.size,
    };
  });

  console.log(
    `AC-10-03 shadowMap=${renderInfo.shadowMap} sunCastsShadow=${renderInfo.sunCastsShadow} ` +
      `toneMapping=${renderInfo.toneMapping} types=${types} drawCalls=${drawCalls}`,
  );

  expect(errors).toEqual([]);
  expect(renderInfo.shadowMap).toBe(true);
  expect(renderInfo.sunCastsShadow).toBe(true);
  expect(renderInfo.toneMapping).toBe("ACESFilmic");
  expect(drawCalls).toBeGreaterThanOrEqual(1);
  expect(drawCalls).toBeLessThanOrEqual(4 * types + 10);
});
