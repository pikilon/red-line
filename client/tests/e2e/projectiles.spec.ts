import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

const FIXED = 65536;

// A smaller canvas renders faster under the software WebGL of a busy CI run,
// so a short-lived projectile still gets drawn in the five-second window.
test.use({ viewport: { width: 960, height: 600 } });

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
  target: number | null;
}

interface SkirmishProjectileDebugView {
  isReady(): boolean;
  typeIndex(id: string): number;
  entities(): EntityView[];
  entity(id: number): EntityView | null;
  selectedIds(): number[];
  worldToScreen(x: number, y: number): Point;
  cameraTarget(): Point;
  setCameraTarget(x: number, y: number): void;
  command(command: Record<string, unknown>): void;
  effectCounts(): Record<string, number>;
  projectileCounts(): Record<string, number>;
  projectileSamples(): { model: string; z: number; t: number }[];
}

type DebugWindow = Window & { __redline?: SkirmishProjectileDebugView };

async function boot(page: Page): Promise<void> {
  await page.goto("/?debug=1&seed=1");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );
}

function kindOf(page: Page, id: string): Promise<number> {
  return page.evaluate(
    (type: string) => (window as DebugWindow).__redline?.typeIndex(type) ?? -1,
    id,
  );
}

/** Sends a `debugSpawn` command at (x, y) tiles (spec §5.8, §5.16). */
function spawnAt(
  page: Page,
  owner: number,
  kind: number,
  x: number,
  y: number,
): Promise<void> {
  return page.evaluate(
    (args: { owner: number; kind: number; xRaw: number; yRaw: number }) => {
      (window as DebugWindow).__redline?.command({
        kind: "debugSpawn",
        player: args.owner,
        typeIndex: args.kind,
        xRaw: args.xRaw,
        yRaw: args.yRaw,
      });
    },
    { owner, kind, xRaw: Math.round(x * FIXED), yRaw: Math.round(y * FIXED) },
  );
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

test("AC-17-16: projectiles in the skirmish", async ({ page }) => {
  test.setTimeout(ms(90_000));
  await boot(page);

  // An RPG gunner and a tank four tiles apart: the gunner fires, and its
  // launcher leaves dust on the ground.
  const rpg = await kindOf(page, "ru-rpg-gunner");
  const leopard = await kindOf(page, "ua-leopard-2a4");
  await page.evaluate(() =>
    (window as DebugWindow).__redline?.setCameraTarget(22.5, 62.5),
  );
  await spawnAt(page, 0, rpg, 20.5, 62.5);
  await spawnAt(page, 1, leopard, 24.5, 62.5);
  // Sampled every animation frame: the flight lasts under half a second, so a
  // polling gap could miss the only frame that draws it.
  const launched = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const started = performance.now();
        const check = (): void => {
          const api = (window as DebugWindow).__redline;
          if (
            (api?.projectileCounts().rpg ?? 0) > 0 &&
            (api?.effectCounts().dust ?? 0) > 0
          ) {
            resolve(true);
            return;
          }
          if (performance.now() - started > 5000) {
            resolve(false);
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      }),
  );
  expect(launched).toBe(true);

  // A HIMARS over 20 tiles from a building, kept visible by a scout, goes
  // through its top-attack arc after a real-mouse attack order.
  const himars = await kindOf(page, "ua-himars");
  const scout = await kindOf(page, "ua-kozak-scout");
  const plant = await kindOf(page, "ru-power-plant");
  await spawnAt(page, 0, himars, 20.5, 53.5);
  await spawnAt(page, 0, scout, 43.5, 54.5);
  await spawnAt(page, 1, plant, 38, 53);
  await expect
    .poll(
      () =>
        page.evaluate((kind: number) => {
          const api = (window as DebugWindow).__redline;
          return (
            api?.entities().filter((entity) => entity.kind === kind).length ?? 0
          );
        }, plant),
      { timeout: ms(5000), intervals: [100] },
    )
    .toBe(1);

  const launcher = await page.evaluate((kind: number) => {
    const api = (window as DebugWindow).__redline;
    const unit = api?.entities().find((entity) => entity.kind === kind);
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

  // The camera settles before a click: a slow runner may still be drawing the
  // frame that moved it.
  async function centreOn(x: number, y: number): Promise<void> {
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

  // A click selects the launcher; a right click orders the attack. Both are
  // real mouse input and are retried once if a slow frame swallows them.
  let selected = false;
  for (let attempt = 0; attempt < 3 && !selected; attempt++) {
    await centreOn(launcher.x, launcher.y);
    await clickTiles(page, launcher.x, launcher.y);
    await page.waitForTimeout(ms(300));
    selected = await page.evaluate(
      (id: number) =>
        (window as DebugWindow).__redline?.selectedIds().includes(id) ?? false,
      launcher.id,
    );
  }
  expect(selected).toBe(true);

  await centreOn(building.x, building.y);
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
          if (performance.now() - started > 25_000) {
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
