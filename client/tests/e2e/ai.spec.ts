import { expect, type Page, test } from "@playwright/test";

interface EntityView {
  id: number;
  owner: number;
  kind: number;
}

interface SkirmishDebugView {
  isReady(): boolean;
  tick(): number;
  viewer(): number;
  entities(): EntityView[];
  typeIndex(id: string): number;
}

type DebugWindow = Window & { __redline?: SkirmishDebugView };

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
  );
}

async function debugCall<T, A = undefined>(
  page: Page,
  body: (api: SkirmishDebugView, arg: A) => T,
  arg?: A,
): Promise<Awaited<T>> {
  const api = await page.evaluateHandle(
    () => (window as DebugWindow).__redline as SkirmishDebugView,
  );
  const run = body as (api: SkirmishDebugView, arg: unknown) => T;
  return (await api.evaluate(run, arg)) as Awaited<T>;
}

/** Russia building type ids (`data/factions/russia.yaml`). */
const RUSSIA_BUILDINGS = [
  "ru-hq",
  "ru-power-plant",
  "ru-supply-center",
  "ru-barracks",
  "ru-vehicle-factory",
  "ru-defense",
] as const;

/** Ticks the criterion advances before reading the enemy base (AC-05-21). */
const ADVANCE_TICKS = 1800;

/** Advances to `ticks`, reveals the map and counts player 1's buildings. */
async function player1Buildings(page: Page, ticks: number): Promise<number> {
  await expect
    .poll(() => debugCall(page, (api) => api.tick()), { timeout: 120_000 })
    .toBeGreaterThanOrEqual(ticks);
  // Reveal makes the observer snapshot list player 1's entities (AC-05-21).
  await page.keyboard.press("F3");
  await expect.poll(() => debugCall(page, (api) => api.viewer())).toBe(255);
  return debugCall(
    page,
    (api, ids: readonly string[]) => {
      const kinds = new Set(ids.map((id) => api.typeIndex(id)));
      return api
        .entities()
        .filter((entity) => entity.owner === 1 && kinds.has(entity.kind))
        .length;
    },
    RUSSIA_BUILDINGS,
  );
}

test("AC-05-21: skirmish against the AI", async ({ page }) => {
  test.setTimeout(180_000);

  await boot(page, "debug=1&seed=1&speed=8");
  expect(await player1Buildings(page, ADVANCE_TICKS)).toBeGreaterThanOrEqual(2);

  await boot(page, "debug=1&seed=1&speed=8&ai=off");
  expect(await player1Buildings(page, ADVANCE_TICKS)).toBe(1);
});
