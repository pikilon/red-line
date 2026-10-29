import { expect, type Page, test } from "@playwright/test";
import { ms } from "./timeouts";

interface RepairDebug {
  isReady(): boolean;
  entities(): {
    id: number;
    owner: number;
    kind: number;
    x: number;
    y: number;
    hp: number;
  }[];
  entity(id: number): { hp: number } | null;
  typeIndex(id: string): number;
  selectedIds(): number[];
  worldToScreen(x: number, y: number): { x: number; y: number };
}

type DebugWindow = Window & { __redline?: RepairDebug };

async function call<T, A = undefined>(
  page: Page,
  body: (api: RepairDebug, arg: A) => T,
  arg?: A,
): Promise<T> {
  const api = await page.evaluateHandle(
    () => (window as DebugWindow).__redline as RepairDebug,
  );
  const run = body as (api: RepairDebug, arg: unknown) => T;
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

test("AC-38-05: dozers repair a damaged building through left click", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?load=building-repair&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );
  await page.keyboard.press("Control+A");
  await expect
    .poll(() => call(page, (api) => api.selectedIds().length))
    .toBe(2);
  const building = await call(page, (api) => {
    const kind = api.typeIndex("ua-power-plant");
    return api
      .entities()
      .find((entity) => entity.owner === 0 && entity.kind === kind);
  });
  if (building === undefined) throw new Error("missing damaged power plant");
  const before = building.hp;
  await clickTiles(page, building.x, building.y);
  await expect
    .poll(
      () =>
        call(page, (api, id: number) => api.entity(id)?.hp ?? 0, building.id),
      {
        timeout: ms(15_000),
      },
    )
    .toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
