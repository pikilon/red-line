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

interface SkirmishProjectileDebugView {
  isReady(): boolean;
  typeIndex(id: string): number;
  entities(): EntityView[];
  selectedIds(): number[];
  worldToScreen(x: number, y: number): Point;
  cameraTarget(): Point;
  setCameraTarget(x: number, y: number): void;
  effectCounts(): Record<string, number>;
  projectileCounts(): Record<string, number>;
  projectileSamples(): { model: string; z: number; t: number }[];
}

type DebugWindow = Window & { __redline?: SkirmishProjectileDebugView };

async function boot(page: Page, save: string): Promise<void> {
  await page.goto(`/?load=${save}&debug=1`);
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(20_000) },
  );
}

async function kindOf(page: Page, id: string): Promise<number> {
  return page.evaluate(
    (type: string) => (window as DebugWindow).__redline?.typeIndex(type) ?? -1,
    id,
  );
}

async function centreOn(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([px, py]: [number, number]) =>
      (window as DebugWindow).__redline?.setCameraTarget(px, py),
    [x, y] as [number, number],
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          ([px, py]: [number, number]) => {
            const target = (window as DebugWindow).__redline?.cameraTarget();
            return (
              target !== undefined &&
              Math.hypot(target.x - px, target.y - py) < 0.5
            );
          },
          [x, y] as [number, number],
        ),
      { timeout: ms(5000), intervals: [100] },
    )
    .toBe(true);
  await page.waitForTimeout(ms(150));
}

async function clickTiles(
  page: Page,
  x: number,
  y: number,
  button: "left" | "right" = "left",
): Promise<void> {
  const point = await page.evaluate(
    (tiles: [number, number]) =>
      (window as DebugWindow).__redline?.worldToScreen(tiles[0], tiles[1]) ?? {
        x: -1,
        y: -1,
      },
    [x, y] as [number, number],
  );
  await page.mouse.click(point.x, point.y, { button });
}

test("AC-17-16: RPG launch effects in the skirmish", async ({ page }) => {
  test.setTimeout(ms(60_000));
  // Six RPG gunners ambush four Bradleys: the launchers fire over and over,
  // so a slow software renderer still catches one of them in flight.
  await boot(page, "rpg-ambush");
  const launched = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const started = performance.now();
        const check = (): void => {
          const api = (window as DebugWindow).__redline;
          if (
            (api?.projectileCounts().rpg ?? 0) > 0 &&
            (api?.effectCounts().dust ?? 0) >= 1
          ) {
            resolve(true);
            return;
          }
          if (performance.now() - started > 30_000) {
            resolve(false);
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      }),
  );
  expect(launched).toBe(true);
});

test("AC-17-16: HIMARS rockets in the skirmish", async ({ page }) => {
  test.setTimeout(ms(90_000));
  // The save already has two HIMARS and two TOS-1A firing at visible enemy
  // buildings; the test still gives a real-mouse order of its own.
  await boot(page, "artillery-range");
  const himars = await kindOf(page, "ua-himars");
  const plant = await kindOf(page, "ru-power-plant");
  const launcher = await page.evaluate((kind: number) => {
    const api = (window as DebugWindow).__redline;
    const unit = api
      ?.entities()
      .find((entity) => entity.kind === kind && entity.owner === 0);
    return unit === undefined ? null : { id: unit.id, x: unit.x, y: unit.y };
  }, himars);
  const building = await page.evaluate((kind: number) => {
    const api = (window as DebugWindow).__redline;
    const unit = api
      ?.entities()
      .find((entity) => entity.kind === kind && entity.owner === 1);
    return unit === undefined ? null : { id: unit.id, x: unit.x, y: unit.y };
  }, plant);
  if (launcher === null || building === null) {
    throw new Error("missing HIMARS or target building");
  }

  await centreOn(page, launcher.x, launcher.y);
  await clickTiles(page, launcher.x, launcher.y);
  await expect
    .poll(
      () =>
        page.evaluate(
          (id: number) =>
            (window as DebugWindow).__redline?.selectedIds().includes(id) ??
            false,
          launcher.id,
        ),
      { timeout: ms(5000), intervals: [100] },
    )
    .toBe(true);

  await centreOn(page, building.x, building.y);
  await clickTiles(page, building.x, building.y, "right");

  const flew = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const started = performance.now();
        const check = (): void => {
          const api = (window as DebugWindow).__redline;
          if (
            (api?.projectileSamples() ?? []).some(
              (sample) => sample.model === "rocket" && sample.z > 4,
            )
          ) {
            resolve(true);
            return;
          }
          if (performance.now() - started > 30_000) {
            resolve(false);
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      }),
  );
  expect(flew).toBe(true);
});
