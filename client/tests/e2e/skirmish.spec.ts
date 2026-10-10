import { expect, type Page, test } from "@playwright/test";

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
  hp: number;
  flags: number;
  progress: number;
  target: number | null;
}

interface SkirmishDebugView {
  isReady(): boolean;
  mode(): "skirmish";
  tick(): number;
  controlledPlayer(): number;
  viewer(): number;
  entities(): EntityView[];
  entity(id: number): EntityView | null;
  typeIndex(id: string): number;
  fogAt(x: number, y: number): number;
  credits(): number;
  power(): { produced: number; consumed: number };
  outcome(): { outcome: "ongoing" | "winner" | "draw"; winner: number | null };
  selectedIds(): number[];
  worldToScreen(x: number, y: number): Point;
  cameraTarget(): Point;
  setCameraTarget(x: number, y: number): void;
  command(command: Record<string, unknown>): void;
  stateHash(): Promise<string>;
  drawCalls(): number;
  resetFrameStats(): void;
  frameStats(): { frames: number; p95FrameMs: number };
  injectFrameTimes(frameTimesMs: number[]): void;
  resumeFrameTimes(): void;
}

type DebugWindow = Window & { __redline?: SkirmishDebugView };

async function bootDebug(page: Page, query: string): Promise<void> {
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

/** Type index of a type id, resolved through the debug API (no ruleset in the test). */
function kindOf(page: Page, id: string): Promise<number> {
  return debugCall(page, (api, typeId: string) => api.typeIndex(typeId), id);
}

test("AC-03-55: boots a skirmish with fog", async ({ page }) => {
  await bootDebug(page, "debug=1");

  expect(await debugCall(page, (api) => api.mode())).toBe("skirmish");
  const hq = await kindOf(page, "ua-hq");
  const dozer = await kindOf(page, "ua-dozer");
  const entities = await debugCall(page, (api) => api.entities());
  expect(entities.some((e) => e.owner === 0 && e.kind === hq)).toBe(true);
  expect(entities.some((e) => e.owner === 0 && e.kind === dozer)).toBe(true);
  expect(entities.some((e) => e.owner === 1)).toBe(false);

  expect(await debugCall(page, (api) => api.fogAt(14, 62))).toBe(2);
  expect(await debugCall(page, (api) => api.fogAt(113, 65))).toBe(0);

  await expect(page.locator("#res-credits")).toHaveText("Credits 5000");
  await expect(page.locator("#res-power")).toHaveText("Power 0/0");
  await expect(page.locator("#hud-player")).toHaveText("Player 1: Ukraine");

  const before = await debugCall(page, (api) => api.tick());
  await page.waitForTimeout(1000);
  const after = await debugCall(page, (api) => api.tick());
  expect(after).toBeGreaterThan(before);
});

test("AC-03-60: switches player and reveals the map", async ({ page }) => {
  await bootDebug(page, "debug=1");

  await page.keyboard.press("F2");
  await expect
    .poll(() => debugCall(page, (api) => api.controlledPlayer()))
    .toBe(1);
  await expect(page.locator("#hud-player")).toHaveText("Player 2: Russia");
  await expect(page.locator("#res-credits")).toHaveText("Credits 5000");
  const russia = await debugCall(
    page,
    async (api) => {
      const hq = api.typeIndex("ru-hq");
      return api.entities().some((e) => e.owner === 1 && e.kind === hq);
    },
    undefined,
  );
  expect(russia).toBe(true);
  expect(
    await debugCall(page, (api) => api.entities().some((e) => e.owner === 0)),
  ).toBe(false);

  await page.keyboard.press("F3");
  await expect.poll(() => debugCall(page, (api) => api.viewer())).toBe(255);
  const both = await debugCall(
    page,
    async (api) => {
      const uaHq = api.typeIndex("ua-hq");
      const ruHq = api.typeIndex("ru-hq");
      const entities = api.entities();
      return [
        entities.some((e) => e.owner === 0 && e.kind === uaHq),
        entities.some((e) => e.owner === 1 && e.kind === ruHq),
      ];
    },
    undefined,
  );
  expect(both).toEqual([true, true]);

  await page.keyboard.press("F3");
  await expect.poll(() => debugCall(page, (api) => api.viewer())).toBe(1);
});

test("AC-03-60: ignores F2 without debug", async ({ page }) => {
  // Without debug=1 the skirmish app still boots (default mode) but installs no
  // debug API; F2 must stay inert, which the debug API's absence proves.
  await page.goto("/?mode=skirmish");
  await expect(page.locator("#res-credits")).toHaveText("Credits 5000", {
    timeout: 10_000,
  });
  await page.keyboard.press("F2");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => "__redline" in window)).toBe(false);
});

test("AC-03-61: shows victory and defeat", async ({ page }) => {
  await bootDebug(page, "debug=1");

  await debugCall(page, (api) =>
    api.command({ kind: "debugSetHp", entity: 8, hp: 0 }),
  );
  await expect(page.locator("#outcome")).toHaveText("Victory", {
    timeout: 5000,
  });

  await page.keyboard.press("F2");
  await expect
    .poll(() => debugCall(page, (api) => api.controlledPlayer()))
    .toBe(1);
  await expect(page.locator("#outcome")).toHaveText("Defeat");
});
