import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface HealingDebug {
  isReady(): boolean;
  entities(): {
    id: number;
    owner: number;
    kind: number;
    x: number;
    y: number;
    hp: number;
    flags: number;
  }[];
  entity(id: number): { hp: number; flags: number } | null;
  typeIndex(id: string): number;
  selectedIds(): number[];
  worldToScreen(x: number, y: number): { x: number; y: number };
}

type DebugWindow = Window & { __redline?: HealingDebug };

async function call<T, A = undefined>(
  page: Page,
  body: (api: HealingDebug, arg: A) => T,
  arg?: A,
): Promise<T> {
  const api = await page.evaluateHandle(
    () => (window as DebugWindow).__redline as HealingDebug,
  );
  const run = body as (api: HealingDebug, arg: unknown) => T;
  return (await api.evaluate(run, arg)) as T;
}

async function clickTiles(
  page: Page,
  x: number,
  y: number,
  button: "left" | "right" = "left",
): Promise<void> {
  const point = await call(
    page,
    (api, tiles: { x: number; y: number }) =>
      api.worldToScreen(tiles.x, tiles.y),
    { x, y },
  );
  await page.mouse.click(point.x, point.y, { button });
}

const INSIDE = 32;

test("AC-40-08: damaged infantry heal inside the barracks and walk out", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?load=infantry-healing&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );
  const actors = await call(page, (api) => {
    const rifleKind = api.typeIndex("ua-rifleman");
    const barracksKind = api.typeIndex("ua-barracks");
    return {
      patient: api
        .entities()
        .find(
          (entity) =>
            entity.owner === 0 && entity.kind === rifleKind && entity.hp < 100,
        ),
      barracks: api
        .entities()
        .find((entity) => entity.owner === 0 && entity.kind === barracksKind),
    };
  });
  const { patient, barracks } = actors;
  if (patient === undefined || barracks === undefined) {
    throw new Error("missing rifleman or barracks");
  }
  const before = patient.hp;
  await clickTiles(page, patient.x, patient.y);
  await expect
    .poll(() => call(page, (api) => api.selectedIds()))
    .toEqual([patient.id]);
  await clickTiles(page, barracks.x, barracks.y);
  await expect
    .poll(
      () =>
        call(page, (api, id: number) => api.entity(id)?.hp ?? 0, patient.id),
      { timeout: ms(15_000) },
    )
    .toBeGreaterThan(before);
  await expect
    .poll(
      () =>
        call(page, (api, id: number) => api.entity(id)?.hp ?? 0, patient.id),
      { timeout: ms(15_000) },
    )
    .toBe(100);
  const flags = await call(
    page,
    (api, id: number) => api.entity(id)?.flags ?? 0,
    patient.id,
  );
  expect(flags & INSIDE).toBe(0);
  expect(errors).toEqual([]);
});
