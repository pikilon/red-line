import { expect, type Page, test } from "@playwright/test";

const FX_ONE = 65536;

interface EntityView {
  id: number;
  owner: number;
  kind: number;
  x: number;
  y: number;
  hp: number;
  flags: number;
}

interface SkirmishEffectsDebugView {
  isReady(): boolean;
  typeIndex(id: string): number;
  entities(): EntityView[];
  viewer(): number;
  command(command: Record<string, unknown>): void;
  effectCounts(): Record<string, number>;
  gore(): boolean;
}

type DebugWindow = Window & { __redline?: SkirmishEffectsDebugView };

async function boot(page: Page): Promise<void> {
  await page.goto("/?debug=1&seed=1");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
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
      const api = (window as DebugWindow).__redline as SkirmishEffectsDebugView;
      api.command({
        kind: "debugSpawn",
        player: args.owner,
        typeIndex: args.kind,
        xRaw: args.xRaw,
        yRaw: args.yRaw,
      });
    },
    { owner, kind, xRaw: Math.round(x * FX_ONE), yRaw: Math.round(y * FX_ONE) },
  );
}

/** Visible effect mesh counts of the last frame. */
function effectCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(
    () =>
      (window as DebugWindow).__redline?.effectCounts() ??
      ({} as Record<string, number>),
  );
}

/** Muzzle flashes currently on screen. */
async function muzzleCount(page: Page): Promise<number> {
  return (await effectCounts(page)).muzzle ?? 0;
}

test("AC-07-06: effects in the skirmish", async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page);

  const uaRifleman = await page.evaluate(
    () => (window as DebugWindow).__redline?.typeIndex("ua-rifleman") ?? -1,
  );
  const ruRifleman = await page.evaluate(
    () => (window as DebugWindow).__redline?.typeIndex("ru-rifleman") ?? -1,
  );
  // Two enemies three tiles apart: both are inside each other's range, so both
  // fire and the snapshot carries the `fired` flag.
  await spawnAt(page, 0, uaRifleman, 20.5, 62.5);
  await spawnAt(page, 1, ruRifleman, 23.5, 62.5);

  // The 80 ms muzzle lives between shots; poll fast enough to catch one.
  await expect
    .poll(() => muzzleCount(page), { timeout: 10_000, intervals: [50] })
    .toBeGreaterThan(0);

  // The acceptance criterion samples after three seconds.
  await page.waitForTimeout(3000);
  await expect
    .poll(() => muzzleCount(page), { timeout: 10_000, intervals: [50] })
    .toBeGreaterThan(0);

  // `G` toggles the gore filter and shows a toast (spec 07 §5).
  expect(
    await page.evaluate(() => (window as DebugWindow).__redline?.gore()),
  ).toBe(true);
  await page.keyboard.press("G");
  await expect(page.locator("#toast")).toHaveClass(/visible/);
  await expect(page.locator("#toast")).toHaveText("Gore off");
  await expect
    .poll(() => page.evaluate(() => (window as DebugWindow).__redline?.gore()))
    .toBe(false);
  await page.keyboard.press("G");
  await expect(page.locator("#toast")).toHaveText("Gore on");
});
