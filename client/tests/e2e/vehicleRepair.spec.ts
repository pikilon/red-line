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

test("AC-39-05: a damaged vehicle repairs at its factory through right click", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?load=vehicle-repair&ai=off");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(10_000) },
  );
  const actors = await call(page, (api) => {
    const tankKind = api.typeIndex("ua-leopard-2a4");
    const factoryKind = api.typeIndex("ua-vehicle-factory");
    return {
      tank: api
        .entities()
        .find((entity) => entity.owner === 0 && entity.kind === tankKind),
      factory: api
        .entities()
        .find((entity) => entity.owner === 0 && entity.kind === factoryKind),
    };
  });
  const { tank, factory } = actors;
  if (tank === undefined || factory === undefined) {
    throw new Error("missing vehicle or factory");
  }
  await clickTiles(page, tank.x, tank.y);
  await expect
    .poll(() => call(page, (api) => api.selectedIds()))
    .toEqual([tank.id]);
  await clickTiles(page, factory.x, factory.y, "right");
  await expect
    .poll(
      () => call(page, (api, id: number) => api.entity(id)?.hp ?? 0, tank.id),
      {
        timeout: ms(15_000),
      },
    )
    .toBeGreaterThan(tank.hp);
  expect(errors).toEqual([]);
});
