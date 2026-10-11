import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

/** Screenshot of the Phase 2 box rendering, captured before the models landed. */
const BOX_BASELINE = readFileSync(
  new URL("./fixtures/phase2-boxes.png", import.meta.url),
);

/** Fraction of differing pixels above which the model render counts as different. */
const DIFF_THRESHOLD = 0.05;

/** Screen rectangle of the starting base (1280 x 720, fixed isometric camera). */
const BASE_REGION = { x: 480, y: 160, width: 420, height: 320 } as const;

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EntityView {
  id: number;
  owner: number;
  kind: number;
  x: number;
  y: number;
}

interface SkirmishDebugView {
  isReady(): boolean;
  /** True once the model registry has been applied to the entity renderer. */
  modelsReady(): boolean;
  entities(): EntityView[];
  worldToScreen(x: number, y: number): { x: number; y: number };
  drawCalls(): number;
}

type DebugWindow = Window & { __redline?: SkirmishDebugView };

/** Fraction of pixels of `region` whose RGB differs by more than 12/255. */
function pixelDiff(
  page: Page,
  a: Buffer,
  b: Buffer,
  region: Region,
): Promise<number> {
  return page.evaluate(
    async ({
      left,
      right,
      region,
    }: {
      left: string;
      right: string;
      region: Region;
    }) => {
      async function imageData(dataUrl: string) {
        const blob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(region.width, region.height);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("missing 2d context");
        context.drawImage(
          bitmap,
          region.x,
          region.y,
          region.width,
          region.height,
          0,
          0,
          region.width,
          region.height,
        );
        return context.getImageData(0, 0, region.width, region.height).data;
      }
      const first = await imageData(left);
      const second = await imageData(right);
      let different = 0;
      for (let i = 0; i < first.length; i += 4) {
        if (
          Math.abs((first[i] ?? 0) - (second[i] ?? 0)) > 12 ||
          Math.abs((first[i + 1] ?? 0) - (second[i + 1] ?? 0)) > 12 ||
          Math.abs((first[i + 2] ?? 0) - (second[i + 2] ?? 0)) > 12
        ) {
          different++;
        }
      }
      return different / (region.width * region.height);
    },
    {
      left: `data:image/png;base64,${a.toString("base64")}`,
      right: `data:image/png;base64,${b.toString("base64")}`,
      region,
    },
  );
}

test("AC-06-06: models in the skirmish", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/?debug=1&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.modelsReady() === true,
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(500);

  const { drawCalls, types } = await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as SkirmishDebugView;
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
    return { drawCalls: api.drawCalls(), types: onScreen.size };
  });

  const live = await page.locator("canvas").screenshot();
  const diff = await pixelDiff(page, BOX_BASELINE, live, BASE_REGION);
  console.log(
    `AC-06-06 types=${types} drawCalls=${drawCalls} diff=${diff.toFixed(4)}`,
  );

  expect(errors).toEqual([]);
  expect(drawCalls).toBeGreaterThanOrEqual(1);
  expect(drawCalls).toBeLessThanOrEqual(2 * types + 6);
  expect(diff).toBeGreaterThan(DIFF_THRESHOLD);
});
